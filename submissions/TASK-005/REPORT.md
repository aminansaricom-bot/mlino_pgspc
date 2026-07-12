# TASK-005: Auth hardening (backend only)

**Engineer:** PGSPC
**GitHub Issue:** #5
**Generated from:** `feat/5-auth-hardening`, based on `mlino_platform@main` commit `9937415`
**Status:** REVISED per Univestar review (CHANGES REQUESTED) — all three findings fixed, re-verified, ready for re-review.

## Review history

- **Round 1**: submitted, CHANGES REQUESTED. Three findings:
  1. Race condition in `confirmPasswordReset()` (same class of bug as
     `refresh()`'s pre-review-round-0 implementation, not fixed
     consistently).
  2. `.env.example` / `REPORT.md` accuracy.
  3. Direct `process.env` access in `auth.controller.ts` instead of
     `ConfigService`.
- **Round 2 (this revision)**: all three fixed in place, in
  `submissions/TASK-005/` — no new submission folder created, per
  instruction.

## What this does

Backend-only auth hardening: refresh tokens with rotation, rate
limiting on login/register, and a password reset flow — both
token-consuming endpoints (`refresh`, `confirmPasswordReset`) now use
the same atomic-claim pattern, and all configuration (TTLs, throttle
limits) flows through `ConfigService` with no direct `process.env`
access anywhere in `apps/api/src/auth/`.

## Files changed

```
apps/api/prisma/schema.prisma                                    (modified — RefreshToken, PasswordResetToken models)
apps/api/prisma/migrations/20260711150000_refresh_and_reset_tokens/migration.sql  (new)
apps/api/src/auth/auth.service.ts                                (modified)
apps/api/src/auth/auth.controller.ts                             (modified)
apps/api/src/auth/auth.module.ts                                 (modified — ThrottlerModule.forRootAsync + ConfigService)
apps/api/src/auth/dto.ts                                         (modified — new DTOs)
apps/api/src/auth/auth-hardening.spec.ts                         (new — 15 tests)
apps/api/src/auth/auth-hardening-dto.spec.ts                     (new — 4 tests)
apps/api/src/auth/auth.service.spec.ts                           (modified — repair for TASK-003 compatibility, see below)
apps/api/package.json                                            (modified — @nestjs/throttler only; jest/ts-jest already in main via TASK-003)
.env.example                                                     (modified — all 4 new env vars documented)
package-lock.json                                                (modified)
```

No changes under `apps/web/`. No changes to `mlino_platform`'s own
`.ai/PROJECT_STATE.md` or `.ai/ROADMAP.md` — those are Univestar's to
update on merge.

## Acceptance criteria (from TASK-005-auth-hardening.md)

- [x] Login/register response includes both `accessToken` and `refreshToken`
- [x] `POST /auth/refresh` with a valid refresh token returns a new
      token pair; the old refresh token no longer works after rotation
      (atomic claim)
- [x] More than 5 rapid requests (configurable via `ConfigService`-read
      `AUTH_THROTTLE_LIMIT`/`AUTH_THROTTLE_TTL_MS`) to `/auth/login` or
      `/auth/register` return `429 Too Many Requests`
- [x] `POST /auth/password-reset/request` never reveals whether an
      email exists and logs a reset token server-side
- [x] `POST /auth/password-reset/confirm` with a valid, unexpired token
      updates the password hash; an expired or already-used token is
      rejected (atomic claim, fixed this round)
- [x] No changes to any file under `apps/web/`

## This round's fixes, in detail

### 1. `confirmPasswordReset()` race condition

Was read-then-write: `findUnique()` to check `usedAt`/`expiresAt`, then
a separate `update` inside the `$transaction`. Two concurrent calls
presenting the same still-valid reset token could both pass the read
check before either had marked it used.

Fixed identically to `refresh()`: a single atomic conditional
`updateMany` (`WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt >
now()`) claims the token first; only a request that actually flips
zero-to-one rows proceeds to the password-update transaction.

**Concurrency test added** (`auth-hardening.spec.ts`): fires two
`confirmPasswordReset()` calls with the same token via
`Promise.allSettled`, with a mock that simulates the database's actual
atomic behavior (first call claims, second sees `count: 0`). Asserts
exactly one settles `fulfilled`, one `rejected`, and the password
transaction ran exactly once — not twice.

**Verified against a live Postgres 16 instance** (not just mocked):
two back-to-back conditional `UPDATE`s with the identical `WHERE`
clause on the same row — first returns `UPDATE 1`, immediate second
returns `UPDATE 0`.

### 2. `.env.example` / `REPORT.md` accuracy

Checked every `config.get()` / `process.env` reference in
`apps/api/src/auth/` (excluding spec files) against `.env.example`:
`REFRESH_TOKEN_TTL_MS`, `RESET_TOKEN_TTL_MS`, `AUTH_THROTTLE_LIMIT`,
`AUTH_THROTTLE_TTL_MS` — all 4 were already present and correctly
documented; no gap found, no change needed there. This `REPORT.md`
itself is the fix for the second half of this finding — rewritten from
scratch against the actual current diff rather than incrementally
patched, to guarantee it matches.

### 3. Direct `process.env` access in the controller

`auth.controller.ts` read `process.env.AUTH_THROTTLE_LIMIT` /
`process.env.AUTH_THROTTLE_TTL_MS` directly inside a per-route
`@Throttle()` override — the only place in the whole auth module that
didn't go through `ConfigService`.

Moved to `auth.module.ts`: `ThrottlerModule.forRootAsync({ imports:
[ConfigModule], inject: [ConfigService], useFactory: ... })`, the exact
same shape as the existing `JwtModule.registerAsync` two lines above
it. The controller now only says *which* routes are guarded
(`@UseGuards(ThrottlerGuard)` on `register`/`login`, none on
`refresh`/`password-reset/*`) — the limit itself lives in exactly one
place. `grep -rn 'process.env' apps/api/src/auth/*.ts` (excluding
`*.spec.ts`) now returns zero matches outside of comments explaining
this history.

## Verified locally

```
$ npm test --workspace=apps/api
PASS src/auth/auth.service.spec.ts
PASS src/organizations/organizations.service.spec.ts
PASS src/auth/auth-hardening.spec.ts
PASS src/auth/auth-hardening-dto.spec.ts
Test Suites: 4 passed, 4 total
Tests:       28 passed, 28 total

$ npm run build --workspace=apps/api
> nest build
(0 errors)

$ npm run lint
(clean)
```

## Integration fix carried over from round 1 (unchanged)

`auth.service.spec.ts` (TASK-003's, already merged into `main`) needed
a `ConfigService` mock and a `refreshToken.create` stub added — that
file predates both this task's `AuthService` constructor change and
its `register()`/`login()` change. Still in place this round, still
flagged explicitly since it touches another task's file.

## Self-review notes carried over from round 1 (still accurate)

Flagged but **not** acted on (scope creep for this task, unchanged
from round 1):
1. `/auth/password-reset/request` has no rate limit — not required by
   this task's acceptance criteria; worth a small follow-up task.
2. No scheduled cleanup of expired/used token rows — needs a job
   runner (new infrastructure), out of scope.

## Anything the reviewer should know

This is a revision of the existing `submissions/TASK-005/`, not a new
submission, per instruction. All three review findings addressed
in-place; nothing else changed beyond what was needed to fix them and
keep the two affected test files internally consistent.
