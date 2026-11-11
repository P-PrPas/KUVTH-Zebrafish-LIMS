# Acceptance follow-up — 11 November 2026

The supplied retest found no remaining blocker in its reviewed scope. This follow-up
addresses its untested import rollback and expands reproducible acceptance evidence.
The original PDF and its 85/100 score are preserved; this is not a new score or production sign-off.

## Defect reproduced and fixed

New PostgreSQL acceptance tests confirmed two failures after a successful v5 commit:

- Experiment workbooks could not revert (`409 revert_unsupported`).
- Registry workbooks treated observations created by the same import as later work
  (`409 revert_dependency`).

Template commits now retain a rollback manifest in their audit entry: the exact
new canonical and historical rows, plus fingerprints of their stored values.
Rollback runs transactionally under the application write lock. It checks every
fingerprint, pending correction requests, and database foreign-key dependencies
before soft-deleting any owned rows. It removes only that import's specimen links.
Existing unrelated data is preserved. Later edits and new dependent rows cause a
409 without partial rollback. Aggregate-only v5 imports are included.

No migration is needed. Imports committed before this change have no manifest and
retain the existing conservative rollback behavior; this change does not infer
ownership of old data. Imports that modify pre-existing rows cannot use this new
rollback path. Reverting the code does not restore data already rolled back.

## Executed verification

- PostgreSQL import/auth recovery/SQL integration plus local SMTP: broad run had
  43 passed, 10 conditional skips and one failure in the new fixture (it assumed
  shared specimens had a direct fish link). Corrected that fixture to use the
  recorded specimen identity. Reran all new v5 scenarios: **3 passed**, 3 memory-only
  skips. These cover experiment and registry commit, duplicate rejection, later-edit
  protection, new-dependent protection, successful revert and preservation of
  existing data, plus aggregate rollback. No application assertion failure remains
  in these executions. The final targeted JUnit result is `acceptance-v5.xml`.
- Authentication, experiments/timing pinning, fish/promotion, corrections, analytics
  and clean-export suites: **96 passed** (`acceptance-core.xml`).
- Added continuous API lifecycle: eligible embryo → promotion → fish → fin specimen
  → death observation → Excel readback. Passed.
- Added actual localhost SMTP socket delivery: invitation → emailed OTP → password
  setup → logout → password login. Uses the real SMTPMailer, not a recording adapter
  for the member journey. Passed. This does not test KU SMTP, SMTP AUTH or TLS.
  Both new acceptance tests: **2 passed** (`acceptance-new.xml`).
- Offline/replay frontend suites: **17 passed**, including persistence, idempotent
  replay, uncertain responses, rejection, account separation and retry behavior.
- Ruff lint/format, source encoding and diff whitespace checks passed.
- Existing CI already runs import acceptance against PostgreSQL and MySQL. MySQL
  was not run locally in this follow-up; its CI result must be checked before merge.

## Isolated restore rehearsal

Created a task-only PostgreSQL 16 container with tmpfs data and a localhost-only
random port. Existing Compose containers, accounts and database volumes were not
changed. After acceptance testing, made a custom-format `pg_dump`, restored with
`pg_restore --exit-on-error` into a separate database, and compared row counts and
ordered content hashes for every public table: **42 tables / 4,156 rows matched**.
The task container and temporary dump were removed after verification.

This verifies logical backup/restore on the isolated test database. It does not
certify production backup scheduling, retention, recovery time, credentials or
application traffic after a production restore.

## Still requires deployment/customer acceptance

- KU SMTP/TLS, external inbox delivery, and password reset through that provider.
- Browser-driven full lifecycle and populated import/revert flows on the deployed
  build; two independent devices editing/reconnecting concurrently.
- Customer-approved scientific golden dataset reconciled with UI, CSV, XLSX and PDF.
- Production TLS, capacity, monitoring, restore rehearsal and supported client
  browsers/accessibility. The documented deployment network issues remain external.

The automated evidence above narrows these gaps; it does not turn untested external
conditions into passing acceptance results.
