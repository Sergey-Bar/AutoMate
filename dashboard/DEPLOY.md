# Production Deployment Guide

Self-hosted production deployment for **Automate** using Docker Compose, nginx, and Let's Encrypt TLS.

---

## Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| **Docker Engine** | 24+ | `docker --version` |
| **Docker Compose plugin** | v2.20+ | `docker compose version` |
| **Domain name** | — | Must have DNS A record pointing to your server |
| **Open ports** | 80, 443, 4001 | Firewall / security group rules |
| **Disk** | 10 GB+ | SQLite DB + test artifacts |
| **RAM** | 512 MB | Configured limit in compose |

> **DNS**: Ensure `your-domain.com` resolves to your server's public IP _before_ requesting TLS certificates.

---

## Step-by-step Deployment

### 1. Clone the repository

```bash
git clone https://github.com/automate-hq/automate.git
cd automate
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set **all required values**:

```bash
# REQUIRED — dashboard login key (min 16 characters, use a random secret)
AUTOMATE_DASHBOARD_API_KEY=replace-with-a-strong-random-secret

# REQUIRED — restrict CORS to your actual domain
CORS_ORIGIN=https://your-domain.com

# Optional — used in Slack/GitHub notification links
PUBLIC_DASHBOARD_URL=https://your-domain.com

# Optional — Sentry error tracking
SENTRY_DSN=
```

> **Security**: `AUTOMATE_DASHBOARD_API_KEY` must be set to a strong random value. The server will refuse to start in production if it is unset or set to `changeme`.
>
> Generate one with: `openssl rand -hex 32`

### 3. Obtain a TLS certificate (Let's Encrypt)

Install certbot on the host machine:

```bash
# Debian / Ubuntu
sudo apt-get install -y certbot

# RHEL / CentOS / Amazon Linux
sudo dnf install -y certbot
```

Request a certificate using the **standalone** method (requires port 80 to be free):

```bash
sudo certbot certonly --standalone \
  -d your-domain.com \
  --agree-tos \
  --email you@example.com
```

Certificates are written to `/etc/letsencrypt/live/your-domain.com/`:
- `fullchain.pem` — certificate + CA chain
- `privkey.pem` — private key

> **Already have nginx running?** Use webroot mode instead:
> ```bash
> sudo certbot certonly --webroot \
>   -w /var/www/certbot \
>   -d your-domain.com \
>   --agree-tos --email you@example.com
> ```

### 4. Update the nginx config with your domain

Replace the `your-domain.com` placeholder in `nginx-prod.conf`:

```bash
# Linux/macOS
sed -i 's/your-domain.com/YOUR_ACTUAL_DOMAIN/g' nginx-prod.conf

# Or edit manually with your preferred editor
```

### 5. Start the stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Verify all services are healthy:

```bash
docker compose ps
docker compose logs --tail=50 automate
```

The dashboard is now available at `https://your-domain.com`.

### 6. Verify the deployment

```bash
# Health endpoint (should return 200 OK)
curl -sf https://your-domain.com/health/live && echo "OK"

# Check TLS certificate
openssl s_client -connect your-domain.com:443 -brief 2>/dev/null | head -5
```

---

## Useful Commands

```bash
# View live logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Logs for a single service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f automate

# Restart a service without downtime
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart automate

# Pull latest image and redeploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Stop all services (data preserved in volumes)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Stop and destroy all data (CAUTION: irreversible)
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

---

## TLS Certificate Renewal

Let's Encrypt certificates expire after 90 days. Set up automatic renewal:

```bash
# Test renewal (dry run — no changes made)
sudo certbot renew --dry-run

# Add to crontab (checks every 12 hours, renews 30 days before expiry)
(crontab -l 2>/dev/null; echo "0 */12 * * * certbot renew --quiet --deploy-hook \"docker compose -f /path/to/automate/docker-compose.yml -f /path/to/automate/docker-compose.prod.yml exec nginx nginx -s reload\"") | crontab -
```

Update the deploy-hook path to match your actual installation directory.

---

## Backup

Use the included backup script to snapshot the SQLite database and test artifacts:

```bash
# Run a manual backup
bash scripts/backup-db.sh

# Automate with cron (daily at 02:00)
(crontab -l 2>/dev/null; echo "0 2 * * * cd /path/to/automate && bash scripts/backup-db.sh") | crontab -
```

The backup script creates a timestamped `.tar.gz` archive in the `backups/` directory.

> **Volumes**: The SQLite database lives in the `automate_dashboard_data` Docker volume, mounted at `/app/apps/server/data` inside the container. Test artifacts are in `automate_dashboard_artifacts` at `/app/apps/server/test-results`.

### Restore from backup

```bash
# Stop the application
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Restore the database volume from a backup archive
docker run --rm \
  -v automate_dashboard_data:/data \
  -v $(pwd)/backups:/backup:ro \
  alpine tar -xzf /backup/automate-backup-YYYY-MM-DD.tar.gz -C /data

# Restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Monitoring

### Healthchecks

Docker performs automatic healthchecks every 15 seconds. View health status:

```bash
docker inspect automate-automate-1 \
  --format='{{.State.Health.Status}}'
```

The application exposes two health endpoints:

| Endpoint | Description |
|---|---|
| `GET /health/live` | Liveness — returns 200 if the process is running |
| `GET /health/ready` | Readiness — returns 200 if DB connection is established |

### Log rotation

Logs are automatically rotated by the `json-file` logging driver:
- Max file size: **10 MB**
- Max files kept: **3** (30 MB total per service)
- Files are written to `/var/lib/docker/containers/<id>/`

View logs:

```bash
# Follow live
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Last 100 lines from the app
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=100 automate

# Filter by severity
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs automate 2>&1 | grep '"level":"error"'
```

### Resource usage

```bash
docker stats automate-automate-1 \
             automate-nginx-1
```

---

## Security Notes

- The application container runs as non-root user `appuser` (UID defined in `Dockerfile`).
- `no-new-privileges:true` prevents privilege escalation via setuid binaries.
- The root filesystem is mounted **read-only**; only volume-backed paths and `/tmp` are writable.
- nginx enforces TLS 1.2+ and drops all legacy cipher suites.
- HSTS is set for 1 year with `includeSubDomains; preload`.
- Session cookies are `httpOnly` and `Secure` (set by Fastify on the server side).
- `CORS_ORIGIN` should be set to your exact domain, not `*`, in production.

---

## Architecture Overview

```
Internet
   │
   │  :80   HTTP → redirected to HTTPS
   │  :443  HTTPS → dashboard SPA + API + browser WebSocket
   │  :4001 WSS  → Playwright reporter ingestion
   ▼
nginx:1.27-alpine  (TLS termination, security headers, gzip)
   │
   │  :4000  HTTP/WS (internal Docker network)
   │  :4001  WS     (internal Docker network)
   ▼
automate (Node.js 22, non-root appuser)
   │
   ├── /app/apps/server/data       → Docker volume: automate_dashboard_data
   └── /app/apps/server/test-results → Docker volume: automate_dashboard_artifacts
```

---

## Connecting the Playwright Reporter

With TLS in place, reporters must connect over `wss://`:

```bash
AUTOMATE_DASHBOARD_URL=wss://your-domain.com:4001 \
AUTOMATE_DASHBOARD_API_KEY=your-secret-key \
npx playwright test
```

Or in `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@automate/reporter', {
      serverUrl: 'wss://your-domain.com:4001',
      apiKey: process.env.AUTOMATE_DASHBOARD_API_KEY,
    }],
  ],
});
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502 Bad Gateway` | App container not healthy yet | `docker compose ps` — wait for `healthy` status |
| `SSL_ERROR_RX_RECORD_TOO_LONG` | Port 443 serving HTTP | Check `ssl_certificate` paths in `nginx-prod.conf` |
| `connection refused :4001` | Port 4001 not exposed / firewall | Check security group rules; verify `ports: 4001:4001` in compose |
| Container exits immediately | Missing `AUTOMATE_DASHBOARD_API_KEY` | Set the API key in `.env` |
| `read-only file system` error | App trying to write outside volumes | Check `tmpfs` mounts cover all runtime write paths |
| Certificate not found | certbot hasn't run yet | Run certbot standalone before starting the stack |
