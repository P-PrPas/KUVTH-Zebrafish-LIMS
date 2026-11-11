# PR #47 re-review and QA — no blocker found in reviewed scope

Reviewed head: `a1c27efec04954c4db2e74c62424d4980c276669`.

The previous P1 is resolved: default forwarding trust is `unix:` (no TCP peers), the VPS supplies only its edge IP, and Docker's envsubst filter includes the new variable. Re-ran the live nginx test: all four trusted/untrusted cases passed. Also sent a spoofed `X-Real-IP` through the freshly built Compose frontend; the API logged the real Docker gateway rather than the injected IP.

The previous pagination finding is resolved for both issues and records. Empty drafts were retested through the browser in Thai and English; neither pager displays `1–0`.

## QA results

- Fresh Docker Compose build from this head: frontend lint/TypeScript/build completed and services started. Existing PostgreSQL volume/data retained; no reseeding.
- Existing frontend suite: **35 files / 270 tests passed**.
- `npm audit`: **0 findings**, including dev dependencies.
- API role checks: **24/24 expected status codes** for anonymous, guest, member and admin.
- Browser: validation labels; online save; offline queue/reconnect/reload persistence; Bangkok history with en-US browser in America/New_York; empty import drafts in both languages; Thai/English report previews/PDF; Clean Excel; 1440/375/320px layouts.
- No JavaScript page exceptions or harness errors in this browser run; all recorded automated acceptance checks in `verification.json` passed.
- Meeting PDFs remain **3 physical pages** for this dataset. This is accepted under the PR's chosen fix of removing the fixed two-page promise; the two screen sections are now explicitly labelled sections. This does not certify every long-data print layout.
- Clean workbook opened successfully (13 rows including header); this is a structural smoke check, not independent scientific reconciliation.

**Review conclusion:** no remaining blocker found in the reviewed changes. The historical 78/100 report is superseded for this retested scope by a qualitative **85/100** report. This is not a percentage of passing tests and not production sign-off.

CI snapshot at review: contract, PostgreSQL and MySQL checks passed; both app checks were still in progress. Required checks must pass before merge. No merge or deployment was performed.

## Remaining acceptance scope

Real SMTP/OTP/reset/login (sessions were bypassed as authorized); full promotion/lot/specimen lifecycle; populated import commit/rollback and invalid/duplicate/conflicting imports; correction reject/withdraw/concurrency; timing version pinning; multi-device offline conflicts; customer-approved scientific golden dataset; production TLS/load/monitoring/restore and customer browsers remain open. Earlier successful lifecycle tests are historical evidence, not a claim that every feature was retested in this round.

## Local artifacts

`docs/qa/pr47-retest/QA-PR47-retest.pdf`, `report.html`, `browser-results.json`, `verification.json`, `permissions.json`, `proxy-trust.log`, `deployed-proxy.log`, `frontend-tests.log`, `npm-audit.json`, `ci.json`, screenshots and downloaded files.

The report uses the existing KUVACB fonts, colors and logo. No application source was modified. Temporary QA sessions are revoked at closeout; test data is retained for inspection, and the running Compose services/volume are preserved.
