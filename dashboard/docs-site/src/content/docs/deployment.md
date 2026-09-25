---
title: Deployment
description: Deploy Automate with Docker, Docker Compose, or on a VPS.
---

Automate is distributed as a single Docker image. It has no external dependencies — no Postgres, no Redis, no message queue. SQLite runs inside the container.

## Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Docker | 24+ | latest |
| RAM | 512 MB | 1 GB+ |
| Disk | 1 GB | 10 GB+ (for artifacts) |

## Docker Quick Start

```bash
docker run -d \
  --name automate \
  -p 4000:4000 \
  -p 4001:4001 \
  ghcr.io/automate-hq/automate:latest
```

Open [http://localhost:4000](http://localhost:4000). Done.

This runs without persistent storage. Restart the container and you lose all data. For persistent data, use Docker Compose with named volumes.

## Docker Compose

The dashboard includes a pre-configured `docker-compose.yml` for quick deployment.

### Quick Start

```bash
docker compose up -d
```

Dashboard runs on port 4000, reporter ingestion on port 4001.

### Production Deployment

For production, use the provided override file to enable security hardening and nginx reverse proxy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Combined Automate Deployment

To run the full Automate ecosystem (Automate + Dashboard + Ollama + nginx), use the root `docker-compose.yml`:

```bash
# From the repo root
docker compose up -d
```

### TLS and HTTPS Setup

Use Let's Encrypt and Certbot for production TLS. If using the provided nginx configuration:

```bash
# Install certbot
sudo apt-get update; sudo apt-get install certbot python3-certbot-nginx

# Obtain and install certificate
sudo certbot --nginx -d qa.example.com
```

Ensure your firewall allows traffic on ports 80 (HTTP) and 443 (HTTPS).

## Data Persistence and Backup

Automate stores data in two locations:

1. **Database (`DATA_DIR/dashboard.db`)** — SQLite in WAL mode.
2. **Artifacts (`ARTIFACTS_DIR`)** — Screenshots, videos, and Playwright traces.

### Backup and Restore

Use the provided scripts for database maintenance and backups:

```bash
# Backup the database (creates a timestamped copy)
./scripts/backup-db.sh

# Optimize the database (runs VACUUM and ANALYZE)
./scripts/vacuum-db.sh
```

To restore, stop the container, replace the `dashboard.db` file with your backup, and restart.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server and browser WebSocket port |
| `REPORTER_PORT` | `4001` | Reporter WebSocket port (for CI machines) |
| `HOST` | `0.0.0.0` | Interface to bind on |
| `NODE_ENV` | `development` | Set to `production` in deployed environments |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `CORS_ORIGIN` | `*` | Allowed origins for browser WebSocket connections |
| `DATA_DIR` | `./data` | Directory for `dashboard.db` (SQLite WAL database) |
| `ARTIFACTS_DIR` | `./test-results` | Directory for screenshots, videos, and traces |
| `SENTRY_DSN` | _(empty)_ | Sentry DSN for error reporting (optional) |
| `PUBLIC_DASHBOARD_URL` | _(empty)_ | Public URL shown in Slack/Jira notifications |

## Data Persistence

Automate stores two kinds of data:

**Database (`DATA_DIR/dashboard.db`)** — SQLite in WAL mode. Contains all run history, test results, and metadata. Compact and fast. A year of daily test runs typically stays under 500 MB.

**Artifacts (`ARTIFACTS_DIR`)** — Screenshots, videos, and Playwright traces. These can grow large. Budget 50–200 MB per run depending on how many tests record video.

Map both directories to named Docker volumes or host paths to keep data across container restarts and upgrades.

## Reverse Proxy (nginx)

Port `4001` should **not** be proxied. CI machines connect directly to it (no auth, no TLS termination needed on the reporter path). Expose it at the network level instead.

Port `4000` can sit behind nginx:

```nginx
server {
    listen 80;
    server_name qa.example.com;

    # WebSocket upgrade for browser connections
    location /ws {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # API routes
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback
    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Add TLS with Certbot (`certbot --nginx -d qa.example.com`) for production.

## VPS Deployment

A $6/month VPS works fine for most teams. Steps:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and start
git clone https://github.com/automate-hq/automate.git
cd automate
docker-compose up -d
```

Open ports `80` and `4001` in your VPS firewall (plus `443` if using TLS). Port `4001` must be accessible from your CI environment.

## Railway

Railway only exposes one port per service. Automate needs two (`4000` for the UI, `4001` for the reporter). The recommended approach is two separate Railway services:

1. **automate-server** — expose port `4000`, set `REPORTER_PORT` to something unused
2. **@automate/reporter-bridge** — expose port `4001`, disable the HTTP UI

Alternatively, run both behind a single TCP proxy that routes by port. Railway's documentation covers TCP proxy setup.

## Upgrading

```bash
git pull
docker-compose build
docker-compose up -d
```

SQLite migrations run automatically on startup. No manual schema changes needed.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Container exits immediately | Startup error | Check `docker logs automate` |
| `/health` or `/ready` returns 500 | File permission issue | Ensure `DATA_DIR` and `ARTIFACTS_DIR` are writable by the container user |
| Browser WebSocket disconnects | CORS mismatch | Set `CORS_ORIGIN` to your dashboard's origin (e.g., `https://qa.example.com`) |
| Reporter can't connect | Firewall blocking port 4001 | Open port `4001` on your server; verify with `telnet your-server 4001` |
| Artifacts missing after upgrade | Volume not mapped | Confirm `ARTIFACTS_DIR` points to a mounted volume, not a container-local path |
