# KUVTH Zebrafish LIMS operations runbook

This runbook covers a clean local or self-hosted deployment. Hosting, TLS, backup retention, and the production database owner remain deployment decisions outside this repository.

## Configuration

Production API processes must use a real database:

```text
APP_ENV=production
DB_DRIVER=postgres
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/chronofish?sslmode=require
MIGRATIONS_DIR=/migrations/postgres
CORS_ALLOWED_ORIGINS=https://kuvth-zebrafish-lims.example
IP_ALLOWLIST=10.0.0.0/8,192.168.1.0/24
```

`DB_DRIVER=memory` is restricted to development and test. Keep credentials in the deployment secret store, never in `.env` committed to the repository. The API validates configuration, connects, applies versioned migrations, loads canonical tables, and only then serves traffic.

Set `BOOTSTRAP_ADMIN_EMAIL` to the invited `@ku.th` address of the first admin, `MAIL_SENDER_EMAIL` to the authorized SMTP sender, and `AUTH_SECRET` to a unique value of at least 32 characters. Production refuses to start if any are missing. Set `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, and the SMTP credentials before requesting sign-in codes. SMTP uses STARTTLS by default; use `MAIL_USE_SSL=true` for implicit TLS. `MAIL_USE_STARTTLS=false` without SSL is allowed only in development or test for a local mail catcher.

Admins may select any active operator to record work on their behalf. A member can record work only after an admin links their account to one operator; the server rejects a different operator in either the request header or batch body. Sign-in code requests return the same accepted response for invited and unknown addresses. Delivery runs after the response; check server logs if mail does not arrive. An invitation that creates an account but fails to send email appears in the admin list and can be resent there.

Members may view and record observations in another operator's experiment. They may edit experiment metadata, including notes, only when that experiment belongs to their linked operator. Duplicating another operator's experiment creates a new experiment under the member's linked operator; the original is unchanged. Admins may edit and duplicate experiments for any operator.

The API is not a TLS terminator. Production traffic must reach it through an HTTPS reverse proxy or private VPN, with the proxy enforcing the approved IP/CIDR allowlist. Set `IP_ALLOWLIST` as a second control when the API can be reached outside that proxy. Do not trust arbitrary forwarded headers from public clients.

## Sign-in limits and recovery

Incorrect usable-code verification is counted per email over the preceding 24 hours (rolling, persisted across workers). Reaching 15 failures locks code issuance and verification for 24 hours **from the last failure**, not from the first request. Successful sign-in resets the failure history. Requesting again retains the current usable code without resending it; wait for its ten-minute expiry or five incorrect attempts before requesting a replacement. Check spam if email is missing and contact an admin if locked. A failed SMTP delivery expires only the matching code and clears its resend cooldown, allowing an immediate retry; the hourly send cap still applies.

An attacker who knows an account's email can deliberately trigger a lock. Maintain **at least two active, verified administrators**, with separate working email accounts, and confirm both can sign in before production. Alert delivery runs after the verification response, once on reaching the cap, to every active admin. Failed deliveries and locks without any active admin are logged. Background tasks are best effort and can be lost on process termination; check server logs during incidents.

An admin with an existing session can use Members and access during an OTP lock, including unlocking their own account. The list shows the lock expiration and **Unlock account**. Verify the owner's identity before unlocking. `POST /api/v1/auth/admin/users/{user_id}/unlock` with JSON `{}` requires an authenticated admin and records an audit event. It clears failures and the email send quota, invalidates the old code, and allows a new request immediately. It does not reactivate disabled accounts or revoke existing sessions.

If all admins lose access, the database owner can recover an administrator out of band. Stop public authentication traffic, confirm the exact account email and active admin role with the owner, then run this transaction on PostgreSQL or MySQL (replace the literal with that verified email):

```sql
BEGIN;
SELECT id, email, role, active FROM auth_user WHERE email = 'verified-admin@ku.th' FOR UPDATE;
UPDATE auth_login_challenge SET failed_count = 0, locked_until = NULL,
    attempts = 0, code_hash = '', expires_at = CURRENT_TIMESTAMP,
    last_sent_at = '2000-01-01 00:00:00', failed_window_started_at = CURRENT_TIMESTAMP,
    send_count = 0, window_started_at = CURRENT_TIMESTAMP
WHERE email = 'verified-admin@ku.th';
DELETE FROM auth_login_failure WHERE email = 'verified-admin@ku.th';
COMMIT;
```

Record this emergency operation in the incident log, request a new code, establish a second verified admin, and investigate the attack before reopening traffic. Prefer the audited admin endpoint whenever a session remains available.

Migration 000024 adds rolling failure history and an explicit lock deadline. Existing capped accounts keep their old deadline until expiration or admin unlock. Older partial counts are carried forward using their recorded window start because individual failure times were not stored. Rollback drops the new history; stop authentication traffic during rollback.

The HTTP/IP request limiter is in memory **per API process**: multiple workers or replicas multiply its effective cap, and restarts reset it. Enforce a shared limit at the trusted reverse proxy for multi-worker deployments. Email OTP send limits and verification locks use shared database state. Do not trust unvalidated forwarded IP headers.

## Admin and correction requests

Admins open `/admin` directly or use the Admin link in the research workspace. Membership, invitations, roles, lab reference data, timing profiles, correction decisions, and audit history are in this area. Master and timing writes still require an active operator selected in the admin header for audit attribution.

Members may directly correct a record they originally created for 24 hours. They may assign an empty embryo well, record a fish's previously unknown sex, and move a fish between eligible boxes as routine work. After the direct-edit window, they submit a correction from the saved experiment or observation while online. Each request changes one input field and includes a proposed value and reason. An admin approves to apply the value atomically or rejects with a reason. If the source record changed since submission, approval is blocked; the request shows related audit log links and must be rejected before the member submits a fresh request. A member can withdraw their own pending request. Direct cancellation by a member is limited to their latest observation within the 24-hour window.

New requests email active verified admins. Decisions email the requester and, on approval, the account that originally created the record when known. Delivery failures are logged and do not roll back the recorded decision. Set `APP_BASE_URL` to the public web URL so the email links to `/admin` and the member request page resolve correctly.

## Build and deploy

Build the API image from the repository root so migration files are included:

```powershell
$imageBuildDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$imageRevision = git rev-parse HEAD
docker build --build-arg "BUILD_DATE=$imageBuildDate" --build-arg "VCS_REF=$imageRevision" -f backend/Dockerfile -t kuvth-zebrafish-lims-api:local .
cd frontend
npm ci
npm run check
```

For a native API process, install the reviewed dependency resolution instead of resolving new transitive versions during deployment:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -c constraints.txt .
```

Serve `frontend/dist` from a static web server with SPA fallback to `index.html`, and proxy `/api/` to the API. Keep TLS termination and the external VPN/reverse-proxy allowlist in front of the API. If the API is directly reachable, set `IP_ALLOWLIST` as an additional control.

The API image is pinned to a patch-level Python base, runs as the non-root `chronofish` user, contains only the installed backend and migrations, and carries OCI build metadata. Scan the exact image that will be deployed before promotion; for example:

```powershell
trivy image --ignore-unfixed --severity HIGH,CRITICAL --exit-code 1 kuvth-zebrafish-lims-api:local
docker image inspect kuvth-zebrafish-lims-api:local --format '{{.Config.User}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

The frontend is a static artifact. The repository also provides an optional nginx image for environments that want one Compose stack: it builds with Node, runs the static files with unprivileged nginx, proxies `/api/` to the API service, and has SPA fallback. Node is not present in the runtime image. For static hosting, deploy `frontend/dist` directly instead.

For the default PostgreSQL stack:

```powershell
docker compose -f compose.yaml up --build -d
docker compose -f compose.yaml ps
curl http://localhost:5173/
curl http://localhost:5173/api/v1/health
```

Compose binds the direct API ports (`8080` for PostgreSQL and `8081` for MySQL)
to `127.0.0.1`. Network clients use the frontend proxy, which normalizes the
forwarded client address before the API applies `IP_ALLOWLIST` and rate limits.

If another load balancer or reverse proxy sits in front of the frontend nginx,
configure nginx's `real_ip` module with **only that proxy's IP/CIDR** in the
`server` block of `frontend/default.conf` before deploying, for example:

```nginx
set_real_ip_from 10.20.0.0/24; # replace with the actual trusted proxy CIDR
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

The upstream proxy must append the original client IP to `X-Forwarded-For`.
nginx then forwards its verified `$remote_addr` to the API. Without this setup,
all users behind that proxy share the API's 120 requests/minute quota and an
`IP_ALLOWLIST` entry for the proxy would apply to everyone. Never trust forwarded
headers from arbitrary clients or expose the API container directly to the network.

The MySQL compatibility stack is isolated in its own file and does not start PostgreSQL:

```powershell
docker compose -f compose.mysql.yaml --profile mysql up --build -d
curl http://localhost:5173/
curl http://localhost:5173/api/v1/health
```

## Backup and restore

Schedule a daily logical backup in the database platform or job runner and retain at least 30 days. Verify the job by restoring to a disposable database; never restore over production without an approved maintenance window.

PostgreSQL example:

```powershell
docker compose -f compose.yaml exec -T postgres pg_dump -U chronofish -d chronofish --format=custom --file=/tmp/kuvth-zebrafish-lims.dump
docker compose -f compose.yaml cp postgres:/tmp/kuvth-zebrafish-lims.dump ./kuvth-zebrafish-lims-YYYYMMDD.dump
docker compose -f compose.yaml exec -T postgres createdb -U chronofish chronofish_restore
docker compose -f compose.yaml cp ./kuvth-zebrafish-lims-YYYYMMDD.dump postgres:/tmp/kuvth-zebrafish-lims-restore.dump
docker compose -f compose.yaml exec -T postgres pg_restore -U chronofish --clean --if-exists --dbname=chronofish_restore /tmp/kuvth-zebrafish-lims-restore.dump
```

MySQL example:

```powershell
docker compose -f compose.mysql.yaml --profile mysql exec -T mysql mysqldump -uroot -proot --single-transaction --result-file=/tmp/kuvth-zebrafish-lims.sql chronofish
docker compose -f compose.mysql.yaml --profile mysql cp mysql:/tmp/kuvth-zebrafish-lims.sql ./kuvth-zebrafish-lims-YYYYMMDD.sql
docker compose -f compose.mysql.yaml --profile mysql exec -T mysql mysql -uroot -proot --execute="CREATE DATABASE chronofish_restore"
docker compose -f compose.mysql.yaml --profile mysql cp ./kuvth-zebrafish-lims-YYYYMMDD.sql mysql:/tmp/kuvth-zebrafish-lims-restore.sql
docker compose -f compose.mysql.yaml --profile mysql exec -T mysql mysql -uroot -proot chronofish_restore --execute="source /tmp/kuvth-zebrafish-lims-restore.sql"
```

After a restore, check `/api/v1/health`, run the database constraint checks, and verify one idempotent mutation plus its audit entry before reopening traffic.

The API keeps no application state on the local filesystem. PostgreSQL/MySQL is the source of truth; local filesystem volumes are not a substitute for database backup or restore.

## Upgrade and rollback

Deploy the immutable API image, wait for the health check, and inspect logs for migration/load failures. A startup migration or canonical-load failure is fail-closed; keep the previous image available for application rollback. Do not manually edit migration history or roll back a non-transactional MySQL DDL migration. Restore a database backup into a new instance if data rollback is required, then point the API at that instance during a controlled cutover.

## Verification

The CI workflow validates OpenAPI, generated MySQL migrations, frontend build, Python tests/coverage, and boot/idempotency/restart smoke tests on PostgreSQL 16 and MySQL 8. Production UAT, browser/device validation, reference-export reconciliation, and the restore drill require the deployment owner and are not replaced by CI.
