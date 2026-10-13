# Main integration and admin workspace

The redesign branch was created from `feat/client-feedback-experiments` at
`a76766d`, before the authentication and admin PRs. The current application was
checkpointed at `7bc5ab3` before merging `origin/main` at `c005a9b`.

The merge restores the correction-request API, permission policy, separate
administrator workspace, invitations, OTP account unlocking, and historical
imports. The redesigned fonts, colours, navigation, recording-operator menu,
notifications, static login artwork, dashboard and meeting reports are retained.
Aggregate comparison groups and the fish specimen tab remain removed.

## Entry points

- Research workspace: `/#my-requests`, labelled **คำร้องของฉัน**.
- Member records expose **ยื่นคำร้องแก้ไข** for supported fields.
- Account menu → **Admin** opens `/admin`.
- Administrator requests: `/admin#corrections`.
- Members and invitations: `/admin#members`.
- Historical imports: `/admin#imports`.
- Password login remains available; invited accounts can also use an email code.

## Validation

- Frontend: 253 tests across 33 files.
- Backend: 265 passed; database-specific tests skipped by the memory run.
- Isolated PostgreSQL suite: 35 passed, 4 skipped.
- OpenAPI: 100 paths and 124 operations; generated TypeScript refreshed.
- Ruff, source-encoding check, frontend lint, TypeScript and production build.
- Browser checks at 1440 px and 375 px: member submission, request list, admin
  review and approval, conflict blocking, member management, imports, member
  denial at `/admin`, and retained dashboard. No horizontal page overflow.
- A snapshot of the current database upgraded from schema 23 to 24 in an
  isolated PostgreSQL container. Account, session and principal domain-table
  fingerprints were unchanged, and the new SQLStore loaded the existing data.

Browser action checks use API fixtures. PostgreSQL checks exercise the real
backend. No real invitation emails or correction approvals were sent during QA.
MySQL migrations were regenerated; a MySQL server was not used for this run.
