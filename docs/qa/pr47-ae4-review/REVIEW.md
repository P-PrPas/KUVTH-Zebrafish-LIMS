# PR #47 re-review and QA — ae4b4b7

Reviewed head: `ae4b4b787aa186cb145d3345bb4a42b301a84aaf`, incremental review from `a1c27ef` with surrounding import/persistence/UI code inspected.

**No blocker found in the reviewed change.** The v5 manifest rollback is transactional, checks stored row fingerprints and external FK consumers, and serializes with ordinary application writes. Existing imports without a manifest and imports modifying pre-existing records intentionally retain the older conservative behavior.

Executed again on this head:

- PostgreSQL 16 isolated database: **3 passed, 3 intentional memory-mode skips**. Experiment/registry/aggregate rollback, duplicate rejection, later edits and new dependent rows rejected with 409, existing batch/fish collections preserved.
- Backend v5 + lifecycle + actual local SMTP transport acceptance: **63 passed**. Lifecycle covers embryo promotion, fish/specimen/disposition and export readback. SMTP covers invitation/OTP/password login/logout against a local SMTP receiver, not production deliverability.
- Frontend: **270 tests / 35 files passed**.
- Fresh Compose api/frontend build; both healthy, original database volume retained, no reseed.
- Chromium UI smoke: **21 checkpoints**, admin navigation (7 pages), member navigation (7 pages), guest landing, and 375/320px dashboard/guest views. **15/15 expected role-access responses**, no JavaScript page exceptions and no document horizontal overflow. Sessions revoked after each completed/aborted run.
- CI snapshot for this exact head: app, contract, PostgreSQL and MySQL all successful in push/PR runs; publish skipped.

## Non-blocking visual QA finding UI-01

At 320/375px, the pending-work reminder/bird and its text crowd/overlap the first dashboard navigation item. Reproduce: sign in as the synthetic QA member, open the dashboard at either width and inspect the top navigation. Evidence: `member-mobile-375.png`, `member-mobile-320.png`. Place the reminder on its own mobile row or use a compact badge; verify element bounds/text wrapping as well as document overflow. Relevant existing styling: `frontend/src/workspaces.css:928`. This is outside the new rollback diff and is not a data-integrity blocker.

## Scope and handover

Branded report: `docs/qa/pr47-ae4-review/QA-PR47-ae4b4b7.pdf` and `report.html`; evidence and reproducible browser/report scripts are alongside them. Qualitative score retained at **85/100**; it is not a pass percentage or production sign-off.

Browser checks were navigation/render/access smoke, not every mutation end-to-end. Production SMTP/TLS/load/monitoring, multi-device offline conflicts, every correction/timing concurrency path, customer scientific golden data, and production restore/customer-browser acceptance still need explicit acceptance. No fresh restore test was run in this review. The previous report's detailed PDF/export/online-offline results remain historical evidence, not rerun claims.

Test harness issues (local host PostgreSQL collision, PowerShell npm entrypoint, hidden duplicate mobile navigation locators, and asynchronous sign-in rendering) were corrected before the final successful run. SQL assertions use the XML results; earlier interrupted local attempts are not counted. No application source changed, no real accounts altered, no merge or production deployment performed.
