# KUVACB delivery QA — 11 November 2026

- รายงานหลัก: [PDF ภาษาไทย](รายงาน-QA-ก่อนส่งมอบ.pdf), [HTML](report.html)
- คะแนนเชิงคุณภาพ: **78/100** เฉพาะขอบเขตที่ทดสอบ ไม่ใช่ pass percentage หรือ security certification
- ข้อสรุป: ใช้เปิด UAT รอบแก้ไขได้ ยังไม่รับรอง production-ready
- พบ product/UX findings 5 รายการ (QA-01, 02, 03, 05, 06) และ dependency/toolchain risk 1 รายการ (QA-04)

## Environment and scope

Built the primary repository working tree on `feat/import-v5-templates`, base commit `bd1b29e355bcbabeb463e60a8fb463f7e3a2ef79`, using `docker compose up -d --build`. Existing user edits were included and preserved; application source was not changed for QA. Compose created a new PostgreSQL volume, then the repository demo profile seeded synthetic research data. Browser target: `http://localhost:5173` (Chromium 145).

Created three dedicated `qa-handover-20261111-{admin,member,guest}@example.com` accounts and authenticated sessions through the existing authentication repository, as authorized. No authorization checks were disabled in application code. This bypass intentionally excludes real email delivery and password onboarding from acceptance. All test sessions are revoked at closeout; test accounts and synthetic records remain for investigation. No real account passwords were changed.

## Evidence interpretation

| Evidence | Meaning |
| --- | --- |
| `survey.json` | Route/layout survey. Some later requests hit the per-IP limiter. Do not count those as feature failures or successful business flows. Errors/failures are accumulated within each role, not reset per route. |
| `flows.json` | First interaction attempts and 24 HTTP authorization checks. Locator failures and missing required input are harness errors, not product defects. |
| `deep.json` | Successful admin operator/batch creation, Clean Excel, PDF print, plus exploratory attempts. |
| `finalflows.json` | Member/operator link; offline queue/sync/reload; empty import draft; dashboard tabs and CSS print repeat. |
| `memberflow.json` | Successful member batch creation, fish registration, correction submission. Initial embryo selector attempt failed. |
| `closeout.json` | Corrected embryo interaction succeeded; import empty-state navigation; timing CSV; English/Thai switch; 320px layout check. |
| `approval.json` | Admin approval and persisted batch note readback (`notesCorrect: true`). |
| `frontend-tests.log` | 35 files / 267 existing frontend tests passed. |
| `dependency-audit*.json` | 9 development dependency findings; production-only audit reports 0. Not an exploit assessment. |

PNG files are browser evidence. The two `application-meeting-report*.pdf` files reproduce the application's three-page output despite its two-page label. `รายงาน-QA-ก่อนส่งมอบ.pdf` is the separate nine-page QA report.

Successful UI actions were performed on synthetic demo/QA data. Some screenshots capture intermediate asynchronous loading states; final readbacks and later snapshots take precedence. Tests were paced sequentially after the initial survey hit the 120 requests/minute/IP limit.

## Explicit remaining acceptance gaps

Real SMTP/OTP/reset/login; successful promotion with eligible embryos; complete lot/control/specimen lifecycle; valid populated v5 import commit/rollback and malformed/duplicate imports; correction rejection/withdrawal/conflicts; timing version pinning after mutation; multi-device offline conflicts; full scientific golden-dataset reconciliation; Safari/Firefox/screen-reader verification; production TLS, monitoring, load and backup/restore. These are not reported as passed.

## Rebuild the report

Run `python -X utf8 docs/qa/handover-20261111/build_report.py` with Python Playwright/Chromium installed. It embeds the project's local fonts and brand logo in HTML and renders the PDF. Screenshots are linked from this folder. No server is needed to open the report.
