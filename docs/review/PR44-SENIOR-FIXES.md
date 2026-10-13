# PR 44 Senior review fixes

## Reproduction and corrections

- Reproduced the unverified-registration invitation conflict (409) and password hashing on an invalid OTP with failing tests before editing.
- Migration 23 is superseded by 25. New databases, main schema 24 without password columns, and old redesign databases with those columns now converge on schema 25 without resetting credentials. The upgrade regression runs for PostgreSQL/MySQL, preserves account/session/domain data, and applies the DDL twice.
- Authentication rollback is restored to main: drop the audit actor FK before its index and let dropping the session table remove its indexes. Both generated MySQL rollback errors were reproduced in the isolated MySQL run.
- Policy decision: password login/reset is Guest-only. Admin/Member OTP lock/unlock and alert policy remains intact; even legacy privileged password hashes cannot authorize password login. Role checks occur inside OTP verification's account lock after a valid code, so invalid OTP requests do not expose the password policy of an account or perform a hash.
- Registration uses BackgroundTasks and catches delivery/cooldown failures, with an identical 202 body. Locked, unknown and privileged password accounts use the same 401 response and dummy password work.
- At most two derivations and two password-login operations run concurrently per process. Capacity is released after errors; excess work returns 503. Nginx additionally throttles public password-login/registration routes by client IP, without affecting OTP routes.
- Admin invitation upgrades an active, unverified Guest in the same transaction, preserves its ID, invalidates the registration challenge, and records an audit. Verified/disabled accounts retain their existing invitation conflict.
- Login defaults to OTP with an explicit Guest password entry. Switching back opens the Guest credentials form instead of reopening the OTP form. Password help no longer invites Admin/Member accounts to set passwords.
- STARTTLS runs inside the connection cleanup block; a failed TLS handshake closes the connection without masking the original exception.

## Verification

- Backend: 278 passed, 27 conditional skips; domain/services coverage 92.56%. Ruff formatting/lint pass.
- SQL suites: PostgreSQL 33 passed / 4 conditional skips; MySQL 34 passed / 3 conditional skips. Both drivers exercise the main/legacy upgrade histories and credential preservation; MySQL rollback now passes.
- Frontend: 262 passed; lint, TypeScript, generated API types and production build pass. Browser checks cover OTP/Guest transitions at 1440/768/375px with no horizontal overflow.
- Both production images build. Nginx configuration passes `nginx -t`. Source encoding and migration generation pass.
- Isolated HTTP load probe: 80 simultaneous fake password logins directly to the API returned 4 generic 401 / 76 capacity 503; ten health probes all returned 200, with a maximum observed 207ms (baseline 44ms). The same 80 requests through Nginx returned 2 generic 401 / 4 capacity 503 / 74 proxy 429; proxy health returned 200 in 11ms. These are local observations, not a production latency guarantee.
- GitHub CI results are tracked in the PR; local tests do not substitute for the CI run.

QA uses disposable database containers only. Existing application containers, real accounts, sessions and volumes are not changed. Real SMTP delivery is not exercised; STARTTLS failure is tested with an injected transport. Proxy IP limits apply to the immediate client unless a trusted upstream configures real-IP handling. The existing approximately 609KB frontend chunk warning remains.
