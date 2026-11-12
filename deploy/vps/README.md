# VPS deployment (158.108.225.112)

Mirrors the company layout: everything lives under `/root`, every container sits on the
shared `bridge0` network (`172.20.0.0/16`) with a fixed address, and only `cr-nginx`
publishes a port.

```none
/root
├── core/                    cr-nginx 172.20.10.1
│   ├── docker-compose.yml
│   └── config/0.conf        host -> container map
├── service/                 shared services (empty until a second app needs one)
└── app/
    ├── vetku/               ap-vetku-api .30.10, ap-vetku-web .30.11, ap-vetku-postgres .30.12
    │   ├── docker-compose.yml
    │   ├── .env             secrets, chmod 600, never committed
    │   ├── postgres/        database files
    │   └── backups/         nightly pg_dump (root crontab, 14 days)
    └── <project2>/          use 172.20.31.x
```

Copy app Compose changes to the VPS when they change. The live core also serves
`vetrmc.vet.ku.ac.th` and has additional TLS mounts; merge core changes into the live
file instead of overwriting it or its nginx configuration.

## Manual release flow

CI validates and tests changes; it does not publish images or deploy. Watchtower has
been removed. No public GHCR packages or registry credentials are required for this flow.
The GHCR-style image names below are local tags transported through SSH.

1. Use the reviewed main commit after CI passes. Build both images from the same
   checkout, passing that commit as `VCS_REF` to both Dockerfiles. The API also accepts
   `BUILD_DATE`; the frontend uses `VITE_API_BASE_URL=/api/v1`.
2. Export the two locally built images and upload the archive (PowerShell example):

   ```powershell
   New-Item -ItemType Directory -Force .tmp | Out-Null
   docker save -o .tmp/vetku-release.tar ghcr.io/p-prpas/kuvth-zebrafish-lims-api:main ghcr.io/p-prpas/kuvth-zebrafish-lims-frontend:main
   scp .tmp/vetku-release.tar vdladmin@158.108.225.112:vetku-release.tar
   ```

3. On the VPS, load the archive, take a database backup, then replace only the app:

   ```sh
   sudo -i
   cd /root/app/vetku
   docker load -i /home/vdladmin/vetku-release.tar
   # Confirm both image revision labels match the intended commit before deployment.
   docker image inspect ghcr.io/p-prpas/kuvth-zebrafish-lims-api:main ghcr.io/p-prpas/kuvth-zebrafish-lims-frontend:main --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
   umask 077
   backup=backups/predeploy-$(date +%Y%m%d-%H%M%S).dump
   docker exec ap-vetku-postgres pg_dump -U kuvacb_aqlims -Fc kuvacb_aqlims > "$backup" && test -s "$backup" && docker compose up -d --no-deps --pull never --wait --wait-timeout 180 api web
   curl --fail -H 'Host: kuvacb-aqlims.vet.ku.ac.th' http://127.0.0.1/api/v1/health
   ```

Use `--pull never` so a stale registry tag cannot replace the uploaded images.
Apply Compose/environment changes explicitly. The API applies migrations at startup;
nightly database backups retain 14 days, and each manual release needs its own backup.
Remove the uploaded archive and local `.tmp/vetku-release.tar` after verification.

Rollback images from the 2026-11-12 deployment are tagged `vetku-api:rollback-20261112`
and `vetku-web:rollback-20261112`. Change the two app `image:` values to the selected
rollback images and use the same Compose command. An image rollback does not undo
migrations; review schema compatibility first. Restoring a database backup requires
explicit approval of the data loss window.

## Day-to-day

```sh
sudo -i
cd /root/app/vetku && docker compose ps            # status
docker compose logs -f --tail=100 api              # logs (rotated: 3 x 10 MB per container)
docker compose up -d                               # apply compose/.env changes
docker exec -i ap-vetku-postgres pg_restore -U kuvacb_aqlims -d kuvacb_aqlims --clean < backups/vetku-YYYY-MM-DD.dump
```

## Rules

- Never add `ports:` to an app or database: Docker-published ports bypass UFW. Route through `cr-nginx`.
- Refer to containers by `container_name` (`ap-vetku-api`), not service name: service names like
  `api` collide across projects on the shared `bridge0`.
- Frontend forwarding trust defaults to `unix:` (no TCP peer is trusted). This VPS
  sets `TRUSTED_PROXY_IP=172.20.10.1`, the fixed address of `cr-nginx`. Keep the web
  listener unpublished and the edge overwriting `X-Real-IP`. Never trust the whole
  Docker subnet; update this setting if the edge's fixed address changes.

## Host setup already done

- Docker from the Ubuntu archive (`docker.io`, `docker-compose-v2`): `download.docker.com` is unreachable.
- `security.ubuntu.com` replaced by `mirror1.ku.ac.th` in `/etc/apt/sources.list.d/ubuntu.sources`
  (backup alongside as `.bak`): the original was hijacked by the KU login portal, so no security updates arrived.
- `/etc/docker/daemon.json`: json-file log rotation.
- UFW: allow 22, 80, 443 only.
- The image's preinstalled `apache2` (default page only) is stopped and disabled so `cr-nginx` can take port 80.

## Verified 2026-11-12 and remaining items

- **Access**: the site was previously confirmed through KU VPN. Public internet access
  is not certified by that test. For local testing through SSH use:
  `ssh -L 8080:127.0.0.1:80 vdladmin@158.108.225.112`, then open http://localhost:8080
  (browsers allow Secure cookies on localhost, so login works there).
- **Registry**: anonymous GHCR pull/publish permissions were incomplete. The manual
  SSH archive flow does not depend on GHCR. Package visibility was not changed by this agent.
- **SMTP**: delivery has not been checked in this deployment session.
- **HTTPS** for `kuvacb-aqlims.vet.ku.ac.th`: Let's Encrypt HTTP-01 only works if the port is
  opened to the internet. Internal-only services can use DNS-01 with public DNS TXT
  control, or a KU-issued certificate.
  Until then login fails because `SESSION_COOKIE_SECURE=true` cookies are not sent over plain HTTP.
