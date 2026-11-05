# VPS deployment runbook

## 1. Preconditions

Use an owned domain, Bun 1.4.4 or Docker Engine with Compose v2, and a VPS with working public DNS and HTTPS egress. This project is designed for a small, single-instance host; memory limits are configuration choices, not measured production guarantees.

Know the actual VPS IP. The address after `Last login ... from ...` is the SSH client's source address. Do not copy it into an A record without verifying server networking.

Before launch, inspect the cloud firewall, disk availability, other services and current memory. Keep SSH restricted. Only 80/443 need public exposure for the application. Never publish the API's plain-HTTP port directly.

## 2. Docker + Caddy (public HTTPS)

Extract or clone the source on your VPS. For first setup:

```bash
bun scripts/init-env.mjs --domain api.your-owned-domain.com
chmod 600 .env
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs --tail=100
```

Bun is only needed on the host for the initialization helper. A Docker-only host can generate `.env` in a temporary Bun container:

```bash
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app oven/bun:1.4.4-debian \
  bun scripts/init-env.mjs --domain api.your-owned-domain.com
```

Set A/AAAA records correctly, leave 80/443 reachable for certificate issuance, and verify that `DOMAIN` and `PUBLIC_BASE_URL` refer to the same host. Caddy handles HTTPS. The app is only exposed to the Compose network.

If `.env` already exists, the helper refuses to overwrite it. Edit `DOMAIN`, `PUBLIC_BASE_URL`, `NODE_ENV` and relevant policies yourself while preserving keys. Do not paste `.env` in support requests. `docker compose config` without `--quiet` can print resolved secrets; avoid sharing its output.

The app runs as the unprivileged `bun` user with a read-only root filesystem, dropped capabilities, a persistent evidence volume and bounded logs. Caddy has its own certificate volumes. The Bun image is pinned to 1.4.4; Caddy tracks major version 2. Review and pin image digests in your release process for reproducible production rollouts.

## 3. Local Docker preview

```bash
pnpm env:init
docker compose up -d --build
```

This publishes only `127.0.0.1:8080`. The local and production Compose files are separate, not an override stack. Do not run both against the same named evidence volume concurrently.

## 4. systemd without Docker

Install Bun 1.4.4 and Caddy using their official distribution instructions. Install the Bun executable at `/usr/local/bin/bun`; the hardened service cannot read a binary under a private home directory. Confirm `bun --version` before enabling the service. Node and pnpm are not required to run the deployed application.

As an administrator on the intended server:

```bash
sudo useradd --system --home /opt/agent-reality-api --shell /usr/sbin/nologin agentreality
sudo mkdir -p /opt/agent-reality-api/data
sudo cp -R src public package.json /opt/agent-reality-api/
# Generate a production .env in the source directory first; then install it privately.
sudo install -m 600 -o agentreality -g agentreality .env /opt/agent-reality-api/.env
sudo chown -R agentreality:agentreality /opt/agent-reality-api/data
sudo chmod 700 /opt/agent-reality-api/data
sudo cp deploy/agent-reality-api.service /etc/systemd/system/
```

If the user already exists, skip `useradd`. Inspect the unit before enabling it. Change `ExecStart` when Bun is not `/usr/local/bin/bun`. Set `DATA_DIR=/opt/agent-reality-api/data`, `HOST=127.0.0.1` and the correct HTTPS public origin in the installed `.env`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agent-reality-api
sudo systemctl status agent-reality-api --no-pager
```

Edit a copy of `deploy/Caddyfile.host` with your domain. Merge it into the existing Caddy configuration rather than blindly replacing unrelated sites. Validate before reloading:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`ProtectSystem=strict` makes the app read-only except for its data directory. Do not relax sandboxing to solve an incorrect path or ownership configuration.

## 5. Acceptance checklist

1. `/healthz` returns 200 over the public HTTPS origin.
2. The homepage, documentation, sitemap and OpenAPI URLs load correctly; canonicals reference the real domain.
3. Verification without a key returns 401. A request to `https://127.0.0.1` is rejected before a socket is opened.
4. Probe an owned public endpoint with a release assertion. Confirm `verdict=pass`; deliberately request a wrong release and confirm `verdict=fail`.
5. Retrieve evidence using the same client ID, restart the app, then retrieve it again. Another client's key must return 404.
6. Run the wire smoke check, optional official SDK smoke check and intended agent client. Confirm actual authentication compatibility; this release does not provide OAuth discovery.
7. Check RSS, CPU, disk and log growth on the real VPS before increasing limits.

The health endpoint is process liveness, not a full check of disk durability or external network connectivity.

## 6. Operations

Logs contain request ID, logical route, method and status, not target URLs, keys or payloads. Disk permission, quota, expiry and integrity errors remain visible through error codes. Inspect system logs and free disk space if storage fails.

```bash
docker compose -f compose.prod.yaml logs --tail=100 api
docker stats --no-stream
# systemd alternative:
sudo journalctl -u agent-reality-api --since '30 minutes ago' --no-pager
```

For actual utilization on a roughly 1 GiB host, budget for the OS, Docker daemon when used, Caddy, the app and existing services. The container limits (192 MiB app / 96 MiB Caddy) are ceilings, not expected resident usage or an SLA. Swap is not a substitute for enough memory under sustained load.

## 7. Keys and quotas

`API_KEYS` is a comma-separated list of `client-id:random-secret` entries. Create separate stable IDs for distinct users. Generate secrets with `bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on a trusted terminal. Never reuse model-provider, GitHub or target-service credentials.

Rotate a secret while retaining the same client ID to preserve evidence access. Restart the process to reload keys. Removing a key revokes access but does not immediately erase its records; they expire normally. Avoid duplicate IDs or shared secrets.

In-memory rate limits reset on restart. Limits are per process. Do not deploy multiple instances with a shared data directory. Default storage retains at most 200 records per client for 24 hours; short-term probe burst limits do not override that quota.

## 8. Backup, update and rollback

Back up `.env` privately and the evidence volume only if the retention policy requires it. A backup contains target paths and assertion values; protect it and apply its own expiry policy. Stop the app briefly for a consistent simple file-copy backup. Do not publish backups as build artifacts.

For an update, preserve the previous commit/image, review migrations and release notes, run tests, build the new image, then recreate the app without deleting volumes. The current version has no database migration. The file format is versioned in each record; future incompatible formats require an explicit migration.

Rollback to the prior image/commit and retain data. Never use `docker compose down -v` as a normal update or rollback procedure: it deletes evidence and certificate volumes.

## 9. Defense in depth

For a small trusted user group, set `ALLOWED_TARGET_HOSTS` to the exact hosts you operate. Add `DENIED_CIDRS` for your management/public service addresses. Apply host or cloud egress filtering independently of application checks, including private, link-local and metadata ranges. Provider-specific virtual addresses may require additional denial rules.

SSRF checks are not permission to scan third-party services. Users must be authorized to probe their targets. The application performs GET only, but an ill-designed target can still attach side effects to a GET request.
