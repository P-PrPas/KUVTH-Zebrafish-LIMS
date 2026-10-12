# Admin UI implementation

Implemented on `feat/kuvacb-redesign-v2`, 12 October 2026, following the approved [plan](./ADMIN_UI_PLAN.md).

## Delivered

- Admin home: pending-request feature card, existing icon system, complete shortcut descriptions, balanced responsive grid and research-workspace link.
- Admin/member requests: shared searchable list and selected detail panel, status filters including withdrawn, counts from loaded records, Bangkok timestamps, separate before/proposed fields, rejection form opened on demand. On smaller screens selecting a row moves focus to the details; the back action returns to the list.
- Request-entry forms: explicit record context, expanded-state announcement, contained form surface and preserved resource, pending-field and offline rules.
- Imports: source-file, mapping, issue-review, summary and result steps. Existing confirmation methods are selected rather than displayed together. Mapping warnings have a visible count and expand for final review. Original confirmation prerequisites and transactional endpoints remain in place.
- Import review: page-local issue filters, collapsible source/working JSON, summary of selected mappings and unresolved issues, readable job statuses, loading/empty states, shared success/error Toasts, retained source downloads, status review and guarded revert. Step changes scroll and focus the current step.
- Deferred fields: compact rows with expandable mapping forms; existing source values, row versions and mandatory reasons are retained.
- Members: invitation opened from the toolbar, closes after account creation, search of loaded accounts, separate lock-status layout, collapsible system sender settings. Existing role, session, sync, last-admin and disable safeguards are unchanged.
- Master/Timing: consistent row-action alignment; active timing version accent, safe name fallback and preview of changed HPA values before creating a version.
- Audit: readable changed-fields table, optional original JSON, preserved filters/deep links and main-workspace admin-only Logs navigation.
- No dependencies added. Shared fonts/palette and static login/dashboard artwork preserved. Small hover transitions respect reduced motion.

## Verification

- Frontend full suite: 256 passed across 33 files.
- Subsequent focused checks for final focus/navigation refinements: 28 passed; request/navigation checks also passed 27 cases, import/audit checks 26, timing/master/form checks 46.
- Lint, TypeScript and Vite production build pass through the frontend Docker build.
- Browser inspection: 42 fixture-backed views at 1440/768/375px, including English invitations, committed import results and member correction forms. No document horizontal overflow or uncontained visible controls found. Wide timing tables keep scrolling inside their table region.
- Real-browser final mobile checks: selecting a request focuses details, back returns focus to the list, and changing import steps focuses the active step.
- The sample mapping page decreased from about 4,800px for the old all-in-one draft to about 1,480px on desktop. Issue and summary steps retain required warnings rather than hiding their significance.
- Browser writes were intercepted, including automatic sync telemetry; no real invitations, approvals or import/revert transactions were performed.
- Rebuild/deploy affects only `vetku-pr43` frontend. Existing API/PostgreSQL containers, accounts and volumes are preserved.

## Limits

Search/counts use loaded records; issue filtering is explicitly page-local. Raw source editing remains available in advanced details. Large warning sets still require scrolling on final review. The existing Vite chunk-size warning remains (approximately 591KB JavaScript); this change adds no animation or UI framework dependency.

Backend behavior was not changed, and real email delivery/data-changing transactions were not exercised in browser QA. Those paths retain their existing integration tests and guards.

## Follow-up refinements from the approved review

- Members now start as compact native disclosure rows. Email, role/operator, account status, login locks and positive pending-offline counts remain visible before opening the account actions. Existing invitation, session, role and disable behavior is retained inside the details.
- Import readiness is a checklist with direct links to mapping, issues and acceptance reasons. Amber means action is still required; green means the selected method's existing requirements are complete. Confirmation buttons use the same readiness calculation, so status and disabled state cannot drift. Server validation and transaction endpoints are unchanged.
- On smaller screens requests show the list or details separately. Back restores the page position, internal list position and selected-row focus; filtering/search remains intact. Titles now identify the correction and record type.
- Import success messages appear once in the shared Toast. Failures use a short Toast with the concrete error retained in the page. Required warning counts remain visible; opening an acceptance-reason link reveals and focuses its input.
- Validation: 257 frontend tests pass across 33 files; Docker lint, TypeScript and production build pass. Fixture-backed browser checks at 1440/768/375px cover compact/open members, pending/ready import summaries, reason links and request navigation/scroll restoration. No document horizontal overflow or real business writes occurred.
- In the 24-account desktop fixture, the member page decreased from approximately 9,700px to 3,200px. The first closed row was approximately 89px tall; warning badges stayed visible.
- Frontend was rebuilt and deployed separately; API/PostgreSQL containers and existing data remain unchanged. Real email delivery, approvals and imports were not executed.

## Request creation and account operator follow-up

- Import file selection now has 24px between the file control and validation button.
- My Requests has a create action for record corrections and account operator changes. Record selection reuses the existing correction form for batches, injection lots, embryos, fish and fish observations; embryo-observation requests remain available from Due.
- Member operator selection is explicitly locked to the account assignment, with a direct link to the operator-request form. Members without an assignment can use the same request entry.
- Operator requests target only the requesting Member account and only its operator field. Admin approval applies the account assignment, request decision and audits in one transaction. Active-operator, unique-assignment and unchanged-source checks run again on approval; rejection leaves the assignment unchanged.
- No database migration or dependency was added. Existing account-management rules and sessions remain intact.
- Verification: 259 frontend tests, 269 backend tests (24 environment-dependent skips), and 10 PostgreSQL integration tests (1 MySQL-only skip) pass. Ruff, frontend lint, TypeScript and production build pass. PostgreSQL rollback testing confirms a forced persistence failure preserves both the account and pending request.
- Browser QA covers 12 fixture-backed views at 1440/768/375px: import spacing, operator request, submission result and record request. No document overflow; request payloads were verified with intercepted writes.
- API and frontend are rebuilt for the existing `vetku-pr43` deployment; PostgreSQL, real accounts and volumes are preserved. QA used a separate disposable PostgreSQL container; real email delivery and real account changes were not exercised, and MySQL was not run.

## Profile follow-up

- Member's disabled operator dropdown is removed. The account menu shows the linked operator name and opens My Profile; Admin operator selection appears only on recording pages.
- Profile separates account details, recording identity and security. Email and role remain managed by administrators, matching existing permissions. Member can submit, track and withdraw an operator-change request directly, using existing correction APIs and approval safeguards.
- Profile refreshes account identity on entry, window focus and every 30 seconds while open. Form drafts survive unchanged account refreshes; changed assignments reset stale drafts. Existing records retain their original recorded operator.
- Security lists non-revoked sessions, identifies the current session by the authenticated session ID, and allows confirmed revocation of other sessions through the existing own-session endpoint. Failed revocation retains the session and shows an error Toast; current-device logout keeps the existing offline-aware logout flow.
- Validation: full frontend suite passes 262 tests across 34 files; lint, TypeScript and production build pass. Focused tests cover direct request creation, draft preservation, pending-request withdrawal, session revocation success/failure, and profile navigation for Member/Admin. Browser QA covers 9 profile views at 1440/768/375px plus Admin selector visibility on profile/recording pages, with no horizontal overflow. Browser writes are intercepted.
- Frontend-only rebuild uses the existing `vetku-pr43` project. Backend, database, real sessions and accounts are preserved. No new profile-editing or password endpoint, dependency, schema migration, real approvals or real session revocations were added or performed.
