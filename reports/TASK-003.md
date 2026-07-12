# TASK-003: Minimal automated test coverage (auth + org-scoping)

**Engineer:** PGSPC
**GitHub Issue:** #3
**Patch:** `patches/TASK-003-test-coverage.patch`
**Branch patch was generated from:** `test/3-auth-org-coverage`, rebased onto `mlino_platform@main` (commit `3267b73`)

## What this does

Adds the first automated tests to `mlino_platform` — unit tests for
the two highest-risk paths named in the task: `AuthService` and
`OrganizationsService.assertMember` (the multi-tenancy boundary every
other module depends on).

## Files changed

```
apps/api/package.json                                     (modified — jest/ts-jest devDeps, "test" script, jest config block)
apps/api/src/auth/auth.service.spec.ts                     (new)
apps/api/src/organizations/organizations.service.spec.ts   (new)
.ai/PROJECT_STATE.md                                       (modified — note the test suite now exists)
package-lock.json                                          (modified — lockfile for the above)
```

`organizations.service.ts` itself was **not modified** — read-only per
`PGSPC.md`'s Files To Modify. These are characterization tests against
existing behavior, not a rewrite.

## Acceptance criteria (from TASK-003-test-coverage.md)

- [x] `npm test --workspace=apps/api` runs and passes
- [x] `AuthService.register`: happy path creates a user and returns a
      token; duplicate email throws `ConflictException`
- [x] `AuthService.login`: happy path returns a token; wrong password
      and non-existent email both throw `UnauthorizedException`
- [x] `OrganizationsService.assertMember`: existing member resolves
      without throwing; non-member throws `ForbiddenException`;
      non-existent organization throws `NotFoundException`
- [x] Tests use a mocked/stubbed `PrismaService`, not a real database
      connection

## Verified locally

```
$ npm test --workspace=apps/api
PASS src/organizations/organizations.service.spec.ts
PASS src/auth/auth.service.spec.ts
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total

$ npm run build --workspace=apps/api
> nest build
(0 errors)

$ npm run lint
> eslint "apps/*/src/**/*.{ts,tsx}"
(clean)
```

Environment note: full end-to-end verification against a live Postgres
was not possible from my sandbox (`binaries.prisma.sh` is outside my
network allowlist, so `@prisma/client` has no query engine here — see
prior session notes). Not relevant to this specific task though, since
TASK-003's acceptance criteria explicitly require mocked `PrismaService`
rather than a real DB connection, and that part is fully verified above.

## Anything the reviewer should know

- This patch was generated against `main` at commit `3267b73` (after
  the Inbox-repository workflow docs landed). If `main` has moved
  further by review time, a clean rebase should still apply — the only
  files touched are new spec files plus two isolated edits
  (`package.json`, `.ai/PROJECT_STATE.md`) that don't overlap with the
  `.ai/`-doc-only commits `main` has received since.
- Per `PGSPC.md`'s Files To Modify, `apps/api/test/**` was listed as an
  expected new path for "test config" — I did not create anything
  there. NestJS's e2e test scaffold (`test/jest-e2e.json` etc.) is for
  end-to-end tests, which TASK-003 explicitly marks out of scope. The
  jest config lives inline in `package.json` instead (standard,
  minimal, and is where `ts-jest`/NestJS docs put it for a
  unit-test-only setup). Flagging this explicitly in case the empty
  `test/` directory was intentionally wanted for a reason not stated in
  the task file — happy to add it if so.
- Per the one-task-at-a-time rule, I'm stopping here and not starting
  `TASK-005` until this one clears review.
