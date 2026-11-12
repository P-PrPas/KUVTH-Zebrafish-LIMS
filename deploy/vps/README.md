# VPS deployment (158.108.225.112)

Mirrors the company layout: everything lives under `/root`, every container sits on the
shared `bridge0` network (`172.20.0.0/16`) with a fixed address, and only `cr-nginx`
publishes a port.

```none
/root
├── core/                    cr-nginx 172.20.10.1, cr-watchtower 172.20.10.2
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

## Release flow

Merge to `main` -> CI passes -> `publish` job pushes `ghcr.io/p-prpas/kuvth-zebrafish-lims-{api,frontend}:main`
(plus `:sha-<commit>`) -> `cr-watchtower` pulls and restarts `ap-vetku-api` / `ap-vetku-web` within a minute.
Only the two app containers labelled with scope `vetku` are updated, one at a time.
Postgres and the other project are excluded. Watchtower updates images, not Compose
files or environment settings; apply those manually with Compose.

The publish job is serialized and rejects an obsolete main commit before publishing.
The two tags are published separately, so this is not an atomic release; keep API and
frontend changes compatible during deployment. Nightly database backups retain 14 days;
take an additional dump before manually deploying migrations.

The GHCR packages must be **public** (GitHub -> Packages -> package settings -> visibility) so the VPS
can pull without a token; the repository is already public. For both packages, grant
`KUVTH-Zebrafish-LIMS` **Write** under package settings -> Manage Actions access.
Repository visibility alone does not make packages public or grant Actions write access.

Rollback: set `image:` to `:sha-<good commit>` in `/root/app/vetku/docker-compose.yml`, then
`docker compose up -d --no-deps api web`. Commit tags are never overwritten by CI.
Rolling back the image does not undo database migrations; review schema compatibility
before rollback and restore a backup only with explicit approval of the data loss window.

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
- **Registry**: VPS reaches GHCR. Anonymous pull returned 403 for private packages;
  make both public and verify Actions write access, then check a full publish/pull cycle.
  Images can also be sideloaded for a manual deployment:
  `docker save ... | gzip | ssh vdladmin@158.108.225.112 'gunzip | sudo docker load'`.
  SMTP delivery has not been checked in this deployment session.
- **HTTPS** for `kuvacb-aqlims.vet.ku.ac.th`: Let's Encrypt HTTP-01 only works if the port is
  opened to the internet. Internal-only services can use DNS-01 with public DNS TXT
  control, or a KU-issued certificate.
  Until then login fails because `SESSION_COOKIE_SECURE=true` cookies are not sent over plain HTTP.
