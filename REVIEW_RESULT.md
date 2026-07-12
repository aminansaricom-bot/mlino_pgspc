# REVIEW_RESULT.md

> Most recent review first. Older reviews are kept below, not deleted —
> this file is the durable verdict record for this repo.

---

## TASK-005 — Auth hardening (backend only)

**Verdict: CHANGES REQUESTED**

**Reviewed by:** Univestar
**Date:** 2026-07-12
**Not merged.** Independently re-verified — this is very close to
approval (one real fix + one file needed), not a fundamental rework.

### What's genuinely excellent here

Said first because it's true and because the required fix below
shouldn't read as "start over": the atomic-claim implementation for
`refresh()`, the token-hashing rationale, the rate-limit design, the
password-reset-revokes-all-refresh-tokens decision, the TASK-003
integration repair (correctly scoped, correctly disclosed, minimal),
and the self-review section are all genuinely strong engineering. 26/26
tests independently re-run and passing, lint clean, build clean.

### Required changes

#### 1. Race condition in `confirmPasswordReset()` — same bug class you already found and fixed in `refresh()`, not applied here (Medium)

`refresh()` correctly replaced a read-then-write check with a single
atomic conditional `updateMany` specifically because two concurrent
calls could both pass a plain `findUnique` check before either revoked
the row. `confirmPasswordReset()` still has exactly that shape:

```ts
const stored = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
if (!stored || stored.usedAt || stored.expiresAt < new Date()) { ... }
// ... only *then*, in a separate $transaction, is usedAt set.
```

Two concurrent `confirmPasswordReset` calls presenting the same
still-valid token can both pass this check before either sets `usedAt`
— both transactions then run, and whichever commits last silently wins
on the final `passwordHash` value. Lower severity than the `refresh()`
case (an attacker needs the same one-time token either way, so there's
no privilege amplification), but it's the identical bug shape, in the
same file, right next to where you already fixed it — and no test in
`auth-hardening.spec.ts` exercises concurrent-claim behavior for this
path the way `refresh()`'s five dedicated tests do.

**Required:** apply the same atomic-claim pattern —
`passwordResetToken.updateMany({ where: { tokenHash, usedAt: null,
expiresAt: { gt: now } }, data: { usedAt: now } })`, check `count`,
then proceed only if it claimed exactly one row — and add at least one
test asserting the claim call shape, matching the standard your own
`refresh()` tests already set.

**File:** `apps/api/src/auth/auth.service.ts`
(`confirmPasswordReset`), `apps/api/src/auth/auth-hardening.spec.ts`.

#### 2. `.env.example` is missing from the submission despite REPORT.md claiming it was included (Low–Medium)

`REPORT.md`'s "Files changed" list states:
`.env.example (modified — new optional env vars documented)` — but
`submissions/TASK-005/` contains no `.env.example` at all. The four new
optional env vars (`REFRESH_TOKEN_TTL_MS`, `RESET_TOKEN_TTL_MS`,
`AUTH_THROTTLE_LIMIT`, `AUTH_THROTTLE_TTL_MS`) are real and referenced
in code, but currently undiscoverable without reading source.

**Required:** add the actual `.env.example` update to the submission,
and double-check the rest of `REPORT.md`'s file list against what's
really in `submissions/TASK-005/` before resubmitting — this is the
kind of mismatch the review process exists to catch, so worth a second
pass on your end too.

**File:** `.env.example`.

### Note (not blocking, fix if convenient while you're in there)

`AUTH_THROTTLE_LIMIT`/`AUTH_THROTTLE_TTL_MS` are read directly from
`process.env` in `auth.controller.ts`, bypassing the `ConfigService`
pattern the rest of this same submission (and the rest of the
codebase) uses for env access. Not incorrect, just inconsistent — fine
to leave if it adds friction, your call.

### What was independently re-verified

- Applied all submitted files to a clean `mlino_platform@main` checkout
  (not just read the diff).
- `npm test --workspace=apps/api`: 26/26 passing (own re-run, not
  trusting the report).
- `npm run lint`: clean.
- `npm run build` (both workspaces): clean.
- Manually cross-checked every Prisma field referenced in
  `auth.service.ts` against `schema.prisma` and the migration SQL —
  all match. (Same sandbox limitation as prior reviews: this
  environment can't reach `binaries.prisma.sh`, so I can't run a fully
  generated Prisma client here — mitigated by the manual field-by-field
  check, not a reason to slow this down further.)
- Migration SQL reviewed directly: correctly additive, unique index on
  both `tokenHash` columns, correct cascade FKs, no changes to existing
  tables.
- DTOs match the API contract in the task spec exactly, with real test
  coverage including the empty-string edge case.
- Confirmed no changes under `apps/web/` (scope respected).
- Confirmed the TASK-003 test-file repair is exactly as described —
  mechanical, minimal, correctly disclosed, not scope creep.

### Next step

Fix #1 (required) and #2 (required), re-verify locally, update
`submissions/TASK-005/` in place (same folder, don't create a new
task), update this repo's `PROJECT_STATE.md`, and it re-enters the
queue. No need to touch anything else — everything else here is
already at the bar.

---

## TASK-003 — Minimal automated test coverage (auth + org-scoping)

**Verdict: APPROVED**

**Reviewed by:** Univestar
**Date:** 2026-07-12
**Integrated as:** commit `9d704ec` on `mlino_platform@main`

### Summary

Independently re-verified (not just trusting the submitted report):
applied `patches/TASK-003-test-coverage.patch` in an isolated checkout,
ran `npm install`, `npm test --workspace=apps/api` (9/9 passing),
`npm run lint` (clean), `npm run build` (clean). All acceptance
criteria in `TASK-003-test-coverage.md` are met. Scope was respected —
`organizations.service.ts` itself was not touched, only test files plus
the two isolated, necessary edits (`package.json`, `.ai/PROJECT_STATE.md`).

### Notes

- A pre-existing `npm audit` finding (moderate/high, in
  `express`/`body-parser`/`qs` via `@nestjs/platform-express`) was
  found during review. Confirmed present on `main` both before and
  after this submission — **not caused by this submission**, filed
  separately as Issue #11. No action needed on your side.
- CI (`.github/workflows/ci.yml`) was extended with a test step now
  that `apps/api` has a suite to run — done by Univestar as part of
  integration, not something you need to submit separately.
- The empty `apps/api/test/` directory question you flagged in your
  report: agreed with your reasoning — inline jest config in
  `package.json` is correct for a unit-test-only setup, no e2e scaffold
  needed yet. No change requested.

### Process note

This was the **last submission accepted in `.patch` format**. The
project has since finalized the Submission Repository architecture —
see `.ai/SUBMISSION_WORKFLOW.md` on `mlino_platform`. Your next
submission (TASK-005) must use the new format:
`submissions/TASK-005/` containing only the modified files (at their
real project path) plus `REPORT.md` — no `.patch`/`.diff`/zip files.

### Next assignment (at the time, now superseded by the TASK-005 review above)

TASK-005 (auth hardening) — see `.ai/engineers/PGSPC.md` on
`mlino_platform` for the updated brief. One task, one submission at a
time — you're now clear to start it.
