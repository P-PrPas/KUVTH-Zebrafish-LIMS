# QA remediation ? 11 November 2026

This is a remediation record, not a replacement score or production sign-off.

## PR 47 review follow-up

- P1: Removed trust of `172.16.0.0/12`. Default frontend configuration trusts no
  TCP forwarding headers (`TRUSTED_PROXY_IP=unix:`); VPS explicitly trusts only
  its edge at `172.20.10.1`.
- `python scripts/test_proxy_trust.py` passed four live nginx cases in disposable
  containers: both peers ignored with default trust, only the configured edge's
  header accepted with explicit trust, and the other peer's forged header ignored.
  Tests use the actual nginx template in an isolated network. No live application
  containers, accounts or volumes were changed.
- P3: Empty issues now show zero issues, alongside the records fix. Added Thai and
  English regression cases checking both empty pagers and disabled navigation.
  Import suite: 27 passed. Biome, TypeScript and build passed.
- Full browser/PDF acceptance remains pending.

| Finding | Implementation | Remaining acceptance |
| --- | --- | --- |
| QA-01 | Removed the fixed two-page promise in both languages; footer identifies sections rather than physical pages. | Reprint A4 with long Thai/English data and confirm no clipped rows. |
| QA-02 | Validation summary clones labels and excludes embedded controls/options; retains target IDs. Added select-label regression test. | Browser focus retest. |
| QA-03 | Master-data forms clear stale queued feedback when their resource finishes syncing; rejection retains error handling. | Online/offline/rejection UI retest. |
| QA-04 | Updated lockfile dependencies and happy-dom; aligned Vitest/coverage 4.1.12. npm audit reports zero findings. | Release image vulnerability scan remains separate. |
| QA-05 | Observation history, draft timestamps, confirmation and member session dates use the shared Bangkok formatter rather than browser defaults. Explicit timezone suffix. | Cross-timezone browser retest. |
| QA-06 | Empty record pagination displays zero and an empty-data message. | Populated/empty import UI retest; existing commit gates preserved. |

## Verification

- Frontend: 35 files / 268 tests passed with `npm test -- --maxWorkers=2 --testTimeout=20000`.
- Default parallel run while backend tests were running hit three 5-second timeouts; bounded-worker rerun passed. No assertion failures were hidden.
- TypeScript, production build and Biome passed. Existing bundle-size warning remains.
- npm audit: zero vulnerabilities including development dependencies after update.
- Backend: `python -m pytest backend/tests -q` completed with exit code 0; conditional skips remain and do not certify external database/deployment behavior.
- Existing user changes to CI and nginx were preserved; no containers, volumes or accounts were changed.

## Deployment and scientific acceptance

`deploy/vps/README.md` identifies VPS 158.108.225.112 and intended hostname kuvacb-aqlims.vet.ku.ac.th. It lists inbound port 80, outbound HTTPS/SMTP and TLS as open items. The checked-in proxy listens on HTTP port 80. These documents do not prove current server state. An external web fetch could not access the HTTPS URL during this review; this is not a conclusive network diagnosis.

`docs/testing/PHASE_9_UAT.md` has blank environment, artifact, owner, acceptance evidence and sign-off fields. No customer-approved golden dataset was identified in the inspected repository documentation. Synthetic fixtures and demo exports do not substitute for customer approval.

Outstanding: real SMTP/onboarding/reset, deployed end-to-end lifecycle/import/correction/offline-conflict acceptance, independent scientific reconciliation, Safari/Firefox/screen-reader checks, TLS/monitoring/load and isolated backup-restore rehearsal. Do not claim 100/100 or production readiness until evidence closes these gates.
