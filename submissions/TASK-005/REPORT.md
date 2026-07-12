# TASK-005: Auth hardening (backend only)

**Engineer:** PGSPC
**GitHub Issue:** #5
**Generated from:** `feat/5-auth-hardening`, rebased onto `mlino_platform@main` commit `9937415` (after TASK-003 merged)
**Status:** READY — staged, not yet pushed to `mlino_pgspc`, per instruction to hold submission until Univestar returns.

## What this does

Backend-only auth hardening: refresh tokens with rotation, rate
limiting on login/register, and a password reset flow. Includes a
self-review quality pass (race-condition fix, configurability, DTO
test coverage) done before staging, plus a repair of TASK-003's test
file that this task's `AuthService` signature change broke on rebase
— see "Integration fix" below.

## Files changed

```
apps/api/prisma/schema.prisma                                    (modified — RefreshToken, PasswordResetToken models)
apps/api/prisma/migrations/20260711150000_refresh_and_reset_tokens/migration.sql  (new)
apps/api/src/auth/auth.service.ts                                (modified)
apps/api/src/auth/auth.controller.ts                             (modified)
apps/api/src/auth/auth.module.ts                                 (modified — ThrottlerModule)
apps/api/src/auth/dto.ts                                         (modified — new DTOs)
apps/api/src/auth/auth-hardening.spec.ts                         (new — 15 tests)
apps/api/src/auth/auth-hardening-dto.spec.ts                     (new — 4 tests)
apps/api/src/auth/auth.service.spec.ts                           (modified — see "Integration fix")
apps/api/package.json                                            (modified — @nestjs/throttler only; jest/ts-jest already in main via TASK-003)
.env.example                                                     (modified — new optional env vars documented)
package-lock.json                                                (modified)
```

No changes under `apps/web/`. No changes to `.ai/PROJECT_STATE.md` or
`.ai/ROADMAP.md` in this submission — those are updated by Univestar on
merge per `SUBMISSION_WORKFLOW.md`, not by the submitting engineer (an
earlier draft of this submission incorrectly touched both; caught and
reverted before staging — see git history on `feat/5-auth-hardening` if
useful context).

## Acceptance criteria (from TASK-005-auth-hardening.md)

- [x] Login/register response includes both `accessToken` and `refreshToken`
- [x] `POST /auth/refresh` with a valid refresh token returns a new
      token pair; the old refresh token no longer works after rotation
- [x] More than 5 rapid requests (configurable via
      `AUTH_THROTTLE_LIMIT`/`AUTH_THROTTLE_TTL_MS`) to `/auth/login` or
      `/auth/register` return `429 Too Many Requests`
- [x] `POST /auth/password-reset/request` never reveals whether an
      email exists and logs a reset token server-side
- [x] `POST /auth/password-reset/confirm` with a valid, unexpired token
      updates the password hash; an expired or already-used token is
      rejected
- [x] No changes to any file under `apps/web/`

## Verified locally

```
$ npm test --workspace=apps/api
PASS src/auth/auth.service.spec.ts
PASS src/organizations/organizations.service.spec.ts
PASS src/auth/auth-hardening.spec.ts
PASS src/auth/auth-hardening-dto.spec.ts
Test Suites: 4 passed, 4 total
Tests:       26 passed, 26 total

$ npm run build --workspace=apps/api
> nest build
(0 errors)

$ npm run lint
(clean)
```

`binaries.prisma.sh` is outside my sandbox's network allowlist, so I
can't run a live NestJS app against a real Prisma engine here. As in
prior submissions, I verified the actual SQL behavior directly against
a live Postgres 16 instance instead:
- New migration applies cleanly (`\d RefreshToken`, `\d
  PasswordResetToken` confirmed).
- Full refresh-rotation and password-reset-transaction sequence,
  matching exactly what `auth.service.ts` executes.
- Atomic-claim race fix specifically: two back-to-back `UPDATE`s with
  the token-claim `WHERE` clause — first returns `UPDATE 1`, immediate
  second returns `UPDATE 0`.

## Integration fix (rebasing onto merged TASK-003)

Rebasing this branch onto `main` after TASK-003 merged surfaced two
real breaks in TASK-003's already-merged `auth.service.spec.ts`, both
caused by this task's changes to `AuthService`:

1. `AuthService` gained a third constructor parameter (`ConfigService`,
   for the configurable token TTLs below) — every `new AuthService(...)`
   call in that file needed a mock for it.
2. `register()`/`login()` now also call
   `prisma.refreshToken.create()` — that file's `PrismaService` mock
   didn't stub `refreshToken` at all, so every test in the file failed
   at that step, not just ones about refresh tokens specifically.

Fixed both mechanically (added `makeConfigMock()`, added a resolved
`refreshToken.create` stub) rather than restructuring anything else in
that file. This is a repair of another engineer's already-merged test
file, not new work under my own task — flagging explicitly per
"respect module ownership." Happy to have this specific fix reviewed
separately or reverted if you'd rather handle it a different way; the
alternative was leaving `main`'s test suite broken once this submission
is applied, which seemed clearly worse.

## Self-review (performed before staging, while working independently)

Found and fixed:

1. **Race condition in `refresh()`** — original implementation was
   read-then-write (`findUnique` to check validity, then a separate
   `update` to revoke). Two concurrent requests presenting the same
   still-valid refresh token could both pass the check before either
   revoked it, minting two token pairs from one token. Fixed with a
   single atomic conditional `updateMany` (`WHERE revokedAt IS NULL AND
   expiresAt > now()`) — only the request that actually flips the row
   wins. Verified against live Postgres (see above).
2. **DTO gap** — `RefreshDto.refreshToken` and
   `ConfirmPasswordResetDto.token` only had `@IsString()`, so an empty
   string passed validation (would still fail at the DB lookup, not an
   actual security hole, but inconsistent with this file's other DTOs
   using `@MinLength`). Added `@MinLength(1)`. Found by writing the DTO
   tests, not by inspection.
3. **Configurability** — `REFRESH_TOKEN_TTL_MS`, `RESET_TOKEN_TTL_MS`,
   `AUTH_THROTTLE_LIMIT`, `AUTH_THROTTLE_TTL_MS` are now env-overridable
   (same `ConfigService` pattern `JWT_SECRET`/`JWT_EXPIRES_IN` already
   use), defaults unchanged.

Flagged but **not** acted on (scope creep for this task):

1. `/auth/password-reset/request` has no rate limit — not required by
   this task's acceptance criteria, but worth a small follow-up task
   (mild email-enumeration-timing/spam vector).
2. No scheduled cleanup of expired/used token rows — harmless at MVP
   scale; a real fix needs a job runner (new infrastructure), out of
   scope for "do not create new architecture."

## Anything the reviewer should know

Per instruction, this was fully prepared and validated while working
independently, and is staged but **not pushed** — waiting for
confirmation before this goes to `mlino_pgspc`.
