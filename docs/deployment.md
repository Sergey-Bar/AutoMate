# Deployment Guide

This guide covers deploying the Automate platform using Docker Compose in a production environment.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Docker | 24+ |
| Docker Compose | v2.20+ (bundled with Docker Desktop) |
| Available RAM | 2 GB minimum, 4 GB recommended |
| Available disk | 10 GB minimum |

Optional: [Ollama](https://ollama.ai) running on the host for AI inference features.

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-org/automate.git
cd automate
```

### 2. Configure environment variables

```bash
cp docker/.env.example docker/.env
```

Open `docker/.env` and fill in all **REQUIRED** values (see [Environment Variables](#environment-variables) below).

### 3. Build images

```bash
# Build all service images
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env build
```

Or build individually:

```bash
docker build -t automate/api:latest -f apps/api/Dockerfile .
docker build -t automate/web:latest -f apps/web/Dockerfile .
docker build -t automate/webwright:latest -f services/webwright/Dockerfile .
```

### 4. Start the stack

```bash
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env up -d
```

### 5. Verify all services are healthy

```bash
docker compose -f docker/docker-compose.prod.yml ps
```

All services should show `healthy`. The stack is ready when nginx is healthy.

### 6. Open the dashboard

Navigate to `http://localhost` (or your configured `HTTP_PORT`).

---

## Services

| Service | Image | Internal Port | Description |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432 | PostgreSQL database |
| `api` | `automate/api` | 3000 | Hono API server (AI QA orchestrator + dashboard backend) |
| `web` | `automate/web` | 80 | React SPA served by nginx |
| `webwright` | `automate/webwright` | 8000 | FastAPI AI sidecar |
| `nginx` | `nginx:1.27-alpine` | **80** (public) | Reverse proxy / entry point |

Only `nginx` exposes a port to the host. All other services communicate over the internal `automate-net` bridge network.

---

## Environment Variables

Copy `docker/.env.example` to `docker/.env`. Variables marked **REQUIRED** have no default and must be set before starting.

### PostgreSQL

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_DB` | No | `automate` | Database name |
| `POSTGRES_USER` | No | `automate` | Database user |
| `POSTGRES_PASSWORD` | **Yes** | — | Database password |

### API Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | Full PostgreSQL connection string, e.g. `postgresql://automate:pass@postgres:5432/automate` |
| `COOKIE_SECRET` | **Yes** | — | Secret for signing httpOnly session cookies (min 32 chars). `SESSION_SECRET` is also accepted for legacy deployments. |
| `VAULT_SECRET` | **Yes** | — | AES-256-GCM vault encryption key (min 32 chars) |
| `AUTOMATE_API_KEY` | **Yes** | — | API key for authenticating requests to the Automate server |
| `CORS_ORIGIN` | No | `http://localhost:80` | Allowed CORS origin — set to your public domain |
| `OLLAMA_HOST` | No | `http://host.docker.internal:11434` | Ollama inference endpoint |
| `WEBWRIGHT_URL` | No | `http://webwright:8000` | Internal URL for the Webwright sidecar |

### Webwright Sidecar

| Variable | Required | Default | Description |
|---|---|---|---|
| `WEBWRIGHT_API_KEY` | No | — | Optional API key for Webwright authentication |

### Nginx

| Variable | Required | Default | Description |
|---|---|---|---|
| `HTTP_PORT` | No | `80` | Host port nginx listens on |

### Image Tags (optional)

Override the Docker image names/tags used by the compose file:

| Variable | Default |
|---|---|
| `API_IMAGE` | `automate/api:latest` |
| `WEB_IMAGE` | `automate/web:latest` |
| `WEBWRIGHT_IMAGE` | `automate/webwright:latest` |

---

## Health Check Endpoints

All services expose a `/health` endpoint. Docker uses these for readiness gating — dependent services only start after their dependencies are healthy.

| Service | Health Check URL | Expected Response |
|---|---|---|
| `postgres` | `pg_isready` (internal) | exit 0 |
| `api` | `http://api:3000/health` | HTTP 200 |
| `webwright` | `http://webwright:8000/health` | HTTP 200 |
| `web` | `http://web:80/` | HTTP 200 |
| `nginx` | `http://localhost:80/health` | `ok` (plain text) |

You can manually check health from outside the stack:

```bash
# Nginx (public entry point)
curl http://localhost/health

# API (via nginx proxy)
curl http://localhost/api/health
```

---

## Nginx Routing

The nginx reverse proxy routes traffic as follows:

| Path prefix | Upstream | Notes |
|---|---|---|
| `/health` | nginx (local) | Docker health probe — no upstream |
| `/api/*` | `api:3000` | REST API |
| `/ws/*` | `api:3000` | WebSocket connections (reporter, live runs) |
| `/webwright/*` | `webwright:8000` | FastAPI AI sidecar |
| `/*` | `web:80` | React SPA (client-side routing) |

---

## Stopping and Updating

### Stop the stack

```bash
docker compose -f docker/docker-compose.prod.yml down
```

### Stop and remove volumes (full wipe)

```bash
docker compose -f docker/docker-compose.prod.yml down -v
```

### Update to a new version

```bash
# Pull latest code
git pull

# Rebuild images
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env build

# Restart with zero-downtime rolling update
docker compose -f docker/docker-compose.prod.yml --env-file docker/.env up -d
```

---

## Generating Secrets

Use these commands to generate strong secrets for your `.env`:

```bash
# COOKIE_SECRET / VAULT_SECRET (32+ chars)
openssl rand -base64 32

# AUTOMATE_API_KEY
openssl rand -hex 32

# POSTGRES_PASSWORD
openssl rand -base64 24
```

---

## Troubleshooting

### Services stuck in "starting" or "unhealthy"

```bash
# View logs for a specific service
docker compose -f docker/docker-compose.prod.yml logs api
docker compose -f docker/docker-compose.prod.yml logs postgres
```

### Database connection errors

Ensure `DATABASE_URL` uses `postgres` as the hostname (the Docker service name), not `localhost`.

### Port already in use

Change `HTTP_PORT` in `docker/.env`:

```env
HTTP_PORT=8080
```

### Ollama not reachable

If Ollama runs on the Docker host, use `http://host.docker.internal:11434` (works on Docker Desktop for Mac/Windows). On Linux, use the host's LAN IP or add `extra_hosts: ["host.docker.internal:host-gateway"]` to the api service.
