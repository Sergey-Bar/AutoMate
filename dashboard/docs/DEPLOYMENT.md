# Automate — Deployment Guide

Automate is a self-hosted Playwright QA dashboard. This guide covers deploying with Docker on a VPS or Railway.

## Requirements

- Docker 24+ and Docker Compose v2 (included with Docker Desktop)
- 512MB RAM minimum (1GB recommended for large test suites)
- 1GB disk for app + data; more for artifact storage

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/your-org/automate.git
cd automate

# Start the app (builds image on first run)
docker-compose up -d

# View logs
docker-compose logs mc -f

# Open the dashboard
open http://localhost:4000
```

The first `docker-compose up` builds the image (~3–5 minutes on first run; cached on subsequent runs).

---

## Environment Variables

All variables have safe defaults. Override by adding an `environment:` block to `docker-compose.yml` or exporting in the shell.

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `4000` | Fastify HTTP/WS port |
| `REPORTER_PORT` | `4001` | Reporter WebSocket port |
| `LOG_LEVEL` | `info` | Log level: `trace` \| `debug` \| `info` \| `warn` \| `error` |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (set to your domain in production) |
| `DATA_DIR` | `/app/apps/server/data` | SQLite database directory |
| `ARTIFACTS_DIR` | `/app/apps/server/test-results` | Test artifact directory |
| `SENTRY_DSN` | _(empty)_ | Sentry DSN for error monitoring (leave blank to disable) |
| `DATABASE_URL` | `file:data/missions.db` | SQLite file path (relative to DATA_DIR) |

---

## Data Persistence

Automate stores two categories of data:

| Data | Volume | Path in Container | Contents |
|------|--------|------------------|---------|
| Database | `mc_data` | `/app/apps/server/data` | SQLite WAL database (`missions.db`) |
| Artifacts | `mc_artifacts` | `/app/apps/server/test-results` | Screenshots, videos, traces |

Named Docker volumes survive `docker-compose down`. They are destroyed by `docker-compose down -v`.

### Backup

```bash
# Backup SQLite database
docker run --rm \
  -v automate_mc_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/mc_data_$(date +%Y%m%d).tar.gz -C /data .

# Backup artifacts
docker run --rm \
  -v automate_mc_artifacts:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/mc_artifacts_$(date +%Y%m%d).tar.gz -C /data .
```

---

## nginx Reverse Proxy

The included `nginx.conf` routes all traffic through port 80.

**Start with nginx:**
```bash
docker-compose --profile nginx up -d
```

**What gets proxied:**

| Path | Destination | Notes |
|------|-------------|-------|
| `/ws` | `mc:4000` | Browser WebSocket (upgrade headers set) |
| `/api/` | `mc:4000` | REST API |
| `/artifacts/` | `mc:4000` | Artifact file serving |
| `/health/` | `mc:4000` | Health endpoints |
| `/` | `mc:4000` | React SPA (catch-all) |

**Port 4001 (reporter WebSocket)** is NOT proxied through nginx. Connect ws-reporter.ts directly to `host:4001`. When running behind nginx on port 80, you must also open port 4001 on your firewall.

---

## VPS Deployment (Hetzner / DigitalOcean / Vultr)

1. Provision a server with Docker installed (Ubuntu 22.04 recommended):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. Clone the repo and start:
   ```bash
   git clone https://github.com/your-org/automate.git /opt/automate
   cd /opt/automate
   docker-compose --profile nginx up -d
   ```

3. Open firewall ports:
   - Port **80** — nginx (dashboard)
   - Port **4001** — reporter WebSocket (direct)
   ```bash
   # ufw example
   ufw allow 80/tcp
   ufw allow 4001/tcp
   ```

4. Set `CORS_ORIGIN` to your domain in `docker-compose.yml`:
   ```yaml
   CORS_ORIGIN: "https://mc.your-domain.com"
   ```

5. (Optional) Add TLS via Caddy in front of nginx, or use Cloudflare Tunnel.

---

## Railway Deployment

Railway supports Docker deployments but has a **single public port** per service.

**Dual-port caveat:** Automate needs two ports (4000 for the dashboard, 4001 for the reporter). Railway only exposes one port publicly per service.

**Workaround options:**

**Option A — Deploy two Railway services (Recommended)**
- Service 1: `mc-dashboard` — expose port 4000 only (`PORT=4000`). This serves the UI and REST API.
- Service 2: `mc-reporter` — same image, expose port 4001 only (`REPORTER_PORT=4001`). This is the reporter WS endpoint.
- Both services share a Railway volume for persistence.

**Option B — Single service, reporter via environment**
- Deploy one service on port 4000.
- Set `REPORTER_PORT=4000` and run the reporter on the same port as the API (requires code change — not recommended).

**Railway deployment steps (Option A):**
```bash
# Install Railway CLI
npm i -g @railway/cli
railway login

# Create project
railway init

# Deploy dashboard service
railway service create mc-dashboard
railway variables set PORT=4000 REPORTER_PORT=4001 NODE_ENV=production
railway up

# Get dashboard URL
railway open
```

For the reporter connection URL on Railway, use the internal service URL on port 4001.

---

## Using the Pre-Built Docker Image

Instead of building locally, pull the pre-built image from GitHub Container Registry:

```bash
# Pull the latest release
docker pull ghcr.io/automate-hq/automate:latest

# Or pull a specific version
docker pull ghcr.io/automate-hq/automate:v2.0.0

# Run with minimal config
docker run -d \
  --name automate \
  -p 4000:4000 \
  -p 4001:4001 \
  -v automate_dashboard_data:/app/apps/server/data \
  -v automate_dashboard_artifacts:/app/apps/server/test-results \
  ghcr.io/automate-hq/automate:latest

# Verify health
curl http://localhost:4000/health/ready
# {"status":"ok","db":"connected","ts":"..."}
```

> **Note:** The `publish-docker` CI workflow automatically builds and pushes images to GHCR on `v*` tag pushes. Docker Desktop is not required for development — only for running the production image.

---

## First-Run Verification

After `docker-compose up -d`, verify the stack:

```bash
# 1. Container is running and healthy
docker-compose ps
# mc    running (healthy)

# 2. Liveness check
curl http://localhost:4000/health/live
# {"status":"ok","ts":"..."}

# 3. Readiness check (DB connected)
curl http://localhost:4000/health/ready
# {"status":"ok","db":"connected","ts":"..."}

# 4. SPA is served
curl -s http://localhost:4000/ | grep -c "<title>"
# 1

# 5. Reporter port is open
curl -f http://localhost:4001/ || echo "Expected — WS-only port"
# Expected — WS-only server returns non-200 on HTTP

# 6. Open dashboard in browser
open http://localhost:4000
```

---

## Upgrading

```bash
# Pull latest code
git pull

# Rebuild and restart (data preserved in volumes)
docker-compose build mc
docker-compose up -d --no-deps mc

# Verify health after upgrade
curl http://localhost:4000/health/ready
```

---

## Logs

```bash
# Follow live logs
docker-compose logs mc -f

# Last 100 lines
docker-compose logs mc --tail 100

# Filter for errors
docker-compose logs mc | grep '"level":50'
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Container exits immediately | Build failed or bad env var | `docker-compose logs mc` |
| `/health/ready` returns `db: disconnected` | SQLite file permissions | Check volume mount permissions |
| Dashboard loads but WS disconnects | CORS_ORIGIN mismatch | Set `CORS_ORIGIN` to your exact domain |
| Reporter can't connect | Firewall blocking port 4001 | Open port 4001 on your VPS firewall |
| Artifacts 404 | `ARTIFACTS_DIR` not matching volume mount | Verify `ARTIFACTS_DIR=/app/apps/server/test-results` |
