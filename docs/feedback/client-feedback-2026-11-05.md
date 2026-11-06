# Client feedback — 5 November 2026

Branch: `feat/client-feedback-2026-11-05`

## Implemented

- Membership is invitation-only across email domains. Admin, Member and existing Guest accounts can set/reset a password after verifying their invited email, then sign in with email/password. Public self-registration no longer creates accounts. The legacy `/auth/register` endpoint remains a deprecated alias for invited password setup.
- Sessions expire after 12 hours without activity. Automatic device sync and task reminders do not renew the session. Existing 90-day absolute session/cookie lifetime remains as a separate upper limit.
- Password hashing, lockout, verification-code expiry/reuse protection and session revocation on password reset remain. Password login now returns the session/device identifiers used by account session management.
- Added a separate required Sick note, independent of general notes. Enforced for new observations, corrections and manual fish entry. Existing historical notes remain intact.
- Abnormal means permanent disability. The first Abnormal observation automatically marks the embryo, carries Abnormal through subsequent observations and promotion into the fish registry, and cannot be cleared by a later Normal/Healthy/Sick record. There is no separate disability checkbox. Sick and its note remain independent of the permanent Abnormal condition. Existing Abnormal records are included in the migration backfill.
- Well Plate sizes: 6 (A–B, 1–3), 12 (A–C, 1–4), 24 (A–D, 1–6), 48 (A–F, 1–8), 96 (A–H, 1–12). Selected at experiment creation, defaulting to 96 for existing data. The observation map retains 96 positions. Positions outside the selected format are gray/read-only; unassigned embryos are shown separately. API validation covers lot creation, activation, adding embryos, assignment and plate-size changes.
- New embryo codes retain the existing prefix and append `_YYYY-MM-DD`, using the experiment date. Existing embryo codes are preserved. The date style follows `E4_2025-09-11` in the customer's `Experiment_Cloning_01_Raw data v1.xlsx`.
- Added sidebar reminders for overdue embryo checkpoints, fish not checked today and invalid required fields in the current form. Reminders link to the work or field. Task fetch errors are shown separately from completed work.
- Original 32px pixel bird, 4-frame sprite sheet: `frontend/public/brand/task-bird-sprite.svg`. Brick red, cream and teal match the workspace. Animation is limited to three brief cycles and disabled with reduced motion.
- Fish register/observation exports include Sick note and permanent disability.

## Email investigation ? Docker Compose confirmed

- The live-test flow was old self-registration on localhost through Docker Compose. The separate-process .env loading issue is unrelated to this Docker failure.
- The existing stopped API container has SMTP values, and they match the currently resolved Compose values. It was not restarted or reconfigured.
- Existing logs record STARTTLS certificate verification failures. The same image in a fresh disposable container reproduced OpenSSL error 19: self-signed certificate in certificate chain.
- Windows verified the SMTP certificate, whose issuer was AVG Web/Mail Shield. Its root CA is trusted by Windows but missing from the Linux container.
- The already Windows-verified root was exported only after its exact DER matched the Windows ROOT store with server-authentication trust. No private key was exported.
- With that CA mounted read-only and SSL_CERT_FILE configured, the same image passed STARTTLS with hostname checking/CERT_REQUIRED still enabled, authentication, MAIL FROM and RCPT TO (250). RSET was sent before DATA; no real email was sent.
- Added optional compose.smtp-ca.yaml and compose.mysql.smtp-ca.yaml. The approved local CA is prepared in ignored .cache/smtp-ca/local-smtp-root.pem. These overrides are opt-in and have not been applied to the real application containers or production.
- Added email_tls_verification_failed so the Admin mail test identifies this failure instead of the generic delivery error. Existing authentication/sender/recipient diagnostics remain.
- [Local SMTP TLS guide](../operations/SMTP_LOCAL_TLS.md) contains the configuration and verification procedure. Available old logs do not identify the exact registration request from the feedback, but the Docker transport failure and its local configuration fix are reproduced.

## Two-column embryo list (option A implemented)

Experiment -> lot details -> Manage embryos now shows two columns of cards on wider screens and one column at 640px and below. Each card retains the running number, full embryo code, well selector and existing correction/clear/delete actions. Long codes wrap inside the card. The lot-creation code preview and selected-well inspector retain their layouts.

The uncertain "connect from another one" item is excluded as requested.

## Deployment and verification

Back up the database before applying migration `000026_client_feedback`, and verify real inbox delivery on the intended production host before switching accounts to password login. Accounts without a password must use Invited / forgot password; existing password hashes remain valid. Apply the migration before running the updated API. PostgreSQL and MySQL variants add plate size, disability and Sick-note columns; existing embryos/fish with Abnormal history or the Disabled health status are backfilled. No deployment or real-account changes have been made.

Browser visual verification could not run: the browser host returned “The browser access host is unavailable”. Frontend DOM tests cover the 96-position map/48 gray cells, reminders, navigation, password setup and error handling. Validation results are recorded below once the final runs finish.

References for plate formats: [Corning multiwell plate guide](https://www.corning.com/catalog/cls/documents/selection-guides/CLS-CC-010.pdf), [Opentrons labware library](https://labware.opentrons.com/). Pixel-art inspiration was inspected in the [Sprite-AI creature gallery](https://www.sprite-ai.art/gallery/creatures); no external sprite was copied.

### Final validation results

- Frontend: 265 tests passed. The subsequent correction-field UI addition passed its 8 affected tests. Full lint, TypeScript and production build passed. Vite retains its existing large-bundle warning.
- Backend: 300 non-database cases passed, including the additional correction-path plate-boundary regression; 28 optional database cases were skipped in that run and were exercised separately where applicable.
- PostgreSQL: 35 cases passed, 4 skipped, combining the full database run and the 3 corrected legacy-test reruns.
- MySQL: 36 cases passed, 3 skipped, combining the full database run and the same 3 corrected legacy-test reruns.
- Both databases exercised migration from v24, preservation of credentials/sessions, new field round trips, password/reset/lockout, concurrency, imports and rollback behavior. Databases ran only in disposable containers labeled for this task.
- Ruff formatting/lint, OpenAPI operation validation, source encoding and Git whitespace checks passed.

### Follow-up validation

The Abnormal semantics, two-column cards and migration backfill were revised after the user confirmed their intended meaning.

- Frontend: 266 tests passed; full lint, TypeScript and production build passed.
- Backend: 300 passed and 28 optional database cases skipped in the non-database run. The affected research cases were also rerun after consolidating the permanent-condition read logic.
- PostgreSQL: 3 affected migration/round-trip cases passed in a fresh isolated database, including legacy backfill.
- MySQL: the same 3 cases passed, including legacy backfill.
- All generated MySQL migrations match the canonical PostgreSQL migration generator.
- Separate-process startup reproduction: plain Python did not load SMTP from the root .env; explicit uv env-file loading did. No real email was sent. Docker Compose startup was subsequently confirmed; see the SMTP investigation above.

### Docker SMTP TLS follow-up

The TLS certificate regression was observed failing with the old generic error before the dedicated error mapping was added. SMTP configuration was validated for both Compose stacks: the CA mount is read-only, does not auto-create missing paths, and omitting SMTP_CA_FILE rejects the override. Full message delivery has not been tested; no existing application container, database volume, account credential or Windows trust setting was changed.

The final targeted authentication/mail run passed all 49 cases, including the new TLS certificate error regression.

## PR #45 review corrections

- B1: the PR contract contains 126 operations. The old 129 assertion counted three uncommitted import operations; it is corrected to 126. Earlier local suite totals above were run with the existing import work in the workspace and must not be interpreted as CI results for the PR commit.
- B2: observations retain the recorded condition. The current disability is derived from non-deleted Abnormal/Disabled evidence, not OR-ed with the previous cache. Correcting or cancelling the source observation recomputes the embryo and promoted fish, including removal of first-abnormal metadata; a later Normal entry alone still cannot erase valid earlier evidence. Independent later Abnormal observations still count. Direct and approved corrections are audited.
- Standalone fish may have disability recorded at registration without an observation. The new internal disability_at_registration source flag preserves that independent evidence instead of treating an observation-derived current flag as a source. The migration sets it only for standalone registry rows without observation history. Newly promoted fish always set this source flag false.
- M1: migration 000026 no longer overwrites any existing biological_condition value. It adds/backfills source/derived flags; read-time enrichment displays the effective condition. Back up the DB before migration; no deployment has been performed.
- M2: sick_note and is_disabled are appended to both fish sheets. All existing column positions remain unchanged, with regression assertions for the complete header order and existing values.
- SMTP test uses a public service method. smtplib already has a 15-second socket timeout for both SSL and STARTTLS; the synchronous FastAPI route runs in its worker thread and reports the SMTP result. No real message has been sent.
- Invitations and password setup share one email validator. Admin lockout remains intentional and can be recovered through verified password reset.
- Embryo codes are creation-time identifiers: the date is a snapshot, is not renamed when experimentDate is corrected, and only new embryos receive the date suffix as requested. Older and newer code formats can coexist in an existing lot.
- Sidebar wording now explicitly says overdue embryo checkpoints; upcoming checkpoints remain visible on the checkpoints page and are not counted as unfinished overdue work.

Verification for the new PR head is recorded in its CI checks. Local review regressions were first reproduced as four failures (embryo/fish source correction and cancellation) and passed after the fix. No worktree, stash, project copy, existing container change or user-file cleanup was used.
