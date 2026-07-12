# mlino_pgspc — Engineer Submission Repository

This is an **Engineer Submission Repository** for `PGSPC`, one of three
under the MLINO platform's engineering workflow.

- This is **NOT** the Main Repository. The product lives at
  [`mlino_platform`](https://github.com/aminansaricom-bot/mlino_platform).
- Engineers submit work **here only** — never directly to
  `mlino_platform`.
- Univestar (Chief Architect / Tech Lead / Integrator / Release
  Manager) reviews submissions here and integrates approved work into
  `mlino_platform`.

## How to submit work

One folder per task under `submissions/`:

```
submissions/
└── TASK-XXX/
    ├── REPORT.md          what changed, why, how it was verified locally
    └── <modified files>   only the files that changed, at their real
                            project path relative to mlino_platform's root
```

Full convention: `mlino_platform`'s `.ai/SUBMISSION_WORKFLOW.md`.

## Review outcome

Univestar writes `REVIEW_RESULT.md` at this repo's root after reviewing
a submission — **APPROVED** or **CHANGES REQUESTED**, with full
explanation either way. This is the only file Univestar writes here.

## Structure

```
mlino_pgspc/
├── README.md            this file
├── PROJECT_STATE.md      PGSPC's own running status (not mlino_platform's)
├── REVIEW_RESULT.md      Univestar's latest verdict (present once reviewed)
├── submissions/          one folder per task, per the convention above
├── reports/              historical per-task reports (superseded by
│                         submissions/TASK-XXX/REPORT.md going forward)
└── docs/                 any supporting docs a submission needs (e.g. an ADR draft)
```
