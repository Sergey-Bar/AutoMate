# Automate — Production Deployment Guide

This document covers deploying Automate in production using Docker Compose with the production override file.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Starting the Stack](#3-starting-the-stack)
4. [Pulling the AI Model](#4-pulling-the-ai-model)
5. [Environment Variable Reference](#5-environment-variable-reference)
6. [Backup & Restore](#6-backup--restore)
7. [GPU Configuration (NVIDIA)](#7-gpu-configuration-nvidia)
8. [Log Management](#8-log-management)
9. [Upgrading](#9-upgrading)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Requirement | Minimum | Notes |
|---|---|---|
| Docker Engine | 24+ | [Install guide](https://docs.docker.com/engine/install/) |
| Docker Compose plugin | v2.20+ | Included with Docker Desktop; `docker compose version` to check |
| Disk space | 20 GB | ~5 GB image layers + ~4–8 GB per Ollama model |
| RAM | 10 GB | 8 GB reserved for Ollama + 1 GB for the app |
| CPU | 4 cores | Ollama default limit; tune via `docker-compose.prod.yml` |
| (Optional) NVIDIA GPU | Any CUDA-capable | See [GPU Configuration](#7-gpu-configuration-nvidia) |

> **Windows / macOS hosts:** Docker Desktop sets a VM memory cap. Raise it to at least 12 GB in  
> *Docker Desktop → Settings → Resources → Memory*.

---

## 2. First-Time Setup

### 2a. Clone the repository

```bash
git clone <your-repo-url> automate
cd automate/Automate
```

### 2b. Create your environment file

```bash
cp .env.example .env   # or create from scratch
```

Minimum required content for production:

```dotenv
# Required — never commit this file
VAULT_PASSWORD=a-long-random-passphrase

# Optional — model to use (default: llama3.1)
AUTOMATE_MODEL=llama3.1
```

The file is automatically read by Docker Compose if it is named `.env` in the same directory as the Compose files.

### 2c. Build the image

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
```

---

## 3. Starting the Stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Both services will start in detached mode. Check their status:

```bash
docker compose ps
```

Expected output once healthy:

```
NAME              IMAGE                    STATUS
automate-automate-1   automate-automate   Up X minutes (healthy)
automate-ollama-1     ollama/ollama:latest   Up X minutes (healthy)
```

View logs in real time:

```bash
docker compose logs -f
docker compose logs -f automate   # app only
docker compose logs -f ollama     # Ollama only
```

---

## 4. Pulling the AI Model

The Ollama container starts without any models. Pull the model after the first startup:

```bash
bash scripts/pull-model.sh
```

The script reads `AUTOMATE_MODEL` from the environment (defaults to `llama3.1`) and runs:

```bash
docker compose exec ollama ollama pull llama3.1
```

Model weights are stored in the named Docker volume `ollama-data` and persist across container restarts and image rebuilds.

To switch models, set `AUTOMATE_MODEL` in `.env`, restart the app, then pull the new model:

```bash
AUTOMATE_MODEL=llama3.2 bash scripts/pull-model.sh
```

Available models: <https://ollama.com/library>

---

## 5. Environment Variable Reference

### Automate application

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | HTTP / WebSocket port |
| `NODE_ENV` | `production` | No | Set by Compose file — do not override |
| `OLLAMA_HOST` | `http://ollama:11434` | No | Ollama base URL (auto-set to the sidecar) |
| `AUTOMATE_MODEL` | `llama3.1` | No | LLM model name |
| `AUTOMATE_ENDPOINT` | `http://localhost:11434` | No | Model endpoint (overridden by `OLLAMA_HOST`) |
| `AUTOMATE_TEMPERATURE` | `0.7` | No | Generation temperature (0.0–1.0) |
| `AUTOMATE_MAX_TOKENS` | `4096` | No | Maximum tokens per response |
| `VAULT_DB_PATH` | `.automate-vault.db` | No | Path to vault database inside container |
| `VAULT_PASSWORD` | — | **Yes** | Auto-unlocks vault on startup. Store as a Docker secret or in `.env`. |
| `RATE_LIMIT_MAX` | `100` | No | Max API requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | No | Rate limit window |

### Resource limits (docker-compose.prod.yml)

| Service | CPU limit | Memory limit | CPU reservation | Memory reservation |
|---|---|---|---|---|
| `automate` | 2.0 | 1 G | 0.5 | 256 M |
| `ollama` | 4.0 | 8 G | 1.0 | 2 G |

Adjust these directly in `docker-compose.prod.yml` for your hardware.

---

## 6. Backup & Restore

Automate stores two kinds of persistent data:

| Data | Location | Volume |
|---|---|---|
| Conversations + audit log (SQLite) | `/app/data` inside container | `automate_data` |
| Ollama model weights | `/root/.ollama` inside container | `ollama-data` |

### Backup the database

If the project includes a `scripts/backup-db.sh` script, run:

```bash
bash scripts/backup-db.sh
```

Manual backup using `docker cp`:

```bash
# Get the container name
docker compose ps --format '{{.Name}}' | grep automate

# Copy the data directory out
docker cp automate-automate-1:/app/data ./backups/automate-data-$(date +%Y%m%d)
```

Or dump the volume directly:

```bash
docker run --rm \
  -v automate_automate_data:/data \
  -v "$(pwd)/backups":/backup \
  busybox tar czf /backup/automate-data-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
docker run --rm \
  -v automate_automate_data:/data \
  -v "$(pwd)/backups":/backup \
  busybox tar xzf /backup/automate-data-<date>.tar.gz -C /
```

> Stop the `automate` container before restoring to avoid database corruption.

### Backup Ollama models

Ollama model weights are large (4–8 GB each). Back them up only if re-downloading is not an option:

```bash
docker run --rm \
  -v automate_ollama-data:/data \
  -v "$(pwd)/backups":/backup \
  busybox tar czf /backup/ollama-models-$(date +%Y%m%d).tar.gz /data
```

---

## 7. GPU Configuration (NVIDIA)

Running inference on a GPU dramatically reduces response times.

### Requirements

1. NVIDIA GPU with CUDA support (Compute Capability ≥ 6.0)
2. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on the host
3. NVIDIA driver ≥ 525 (for CUDA 12)

### Verify the toolkit is working

```bash
docker run --rm --gpus all nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi
```

### Enable GPU in docker-compose.prod.yml

In `docker-compose.prod.yml`, uncomment the GPU block under the `ollama` service:

```yaml
  ollama:
    # ...
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility
```

Alternatively, use the `deploy.resources` syntax (Docker Swarm / Compose v3.8+):

```yaml
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

Restart the stack after editing the file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d ollama
```

Confirm Ollama is using the GPU:

```bash
docker compose exec ollama ollama run llama3.1 "say hello"
# GPU usage visible in: watch -n1 nvidia-smi
```

---

## 8. Log Management

The production override uses the `json-file` logging driver with rotation:

| Setting | Value | Meaning |
|---|---|---|
| `max-size` | `10m` | Rotate log file after 10 MB |
| `max-file` | `3` | Keep at most 3 rotated files (30 MB total per service) |

Log files are written to the host at:

```
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

Read them with Docker Compose:

```bash
docker compose logs --tail 200 -f
```

Or forward to a log aggregator (Loki, Datadog, etc.) by replacing the `json-file` driver in `docker-compose.prod.yml`:

```yaml
logging:
  driver: loki
  options:
    loki-url: "http://loki:3100/loki/api/v1/push"
    loki-retries: "5"
```

---

## 9. Upgrading

### Upgrade the app image

```bash
# Rebuild from the latest source
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache automate

# Replace the running container (zero-downtime on single-host deployments is not possible
# without a load balancer; the container will restart in a few seconds)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d automate
```

### Upgrade Ollama

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull ollama
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d ollama
```

Models are stored in the named volume and are not affected by image upgrades.

### Pull a new model version

```bash
bash scripts/pull-model.sh        # pulls AUTOMATE_MODEL (default: llama3.1)
AUTOMATE_MODEL=llama3.2 bash scripts/pull-model.sh
```

---

## 10. Troubleshooting

### Container exits immediately

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs automate
```

Common causes:
- `VAULT_PASSWORD` not set — the server logs `Cannot read properties of undefined` on startup.
- Port 3000 already bound on the host — change the host-side port in the base `docker-compose.yml`.

### Healthcheck stuck in "starting"

The `automate` service uses Node.js fetch for its healthcheck (no `curl` in the slim image). If the container is healthy but the check keeps failing, confirm the `/health` endpoint returns HTTP 200:

```bash
docker compose exec automate node -e \
  "fetch('http://localhost:3000/health').then(r=>console.log(r.status))"
```

### Ollama healthcheck failing

Ollama may take 30–60 seconds to load a model into memory. The healthcheck has a `start_period: 10s` to give it breathing room. If it keeps failing:

```bash
docker compose exec ollama curl -s http://localhost:11434/
```

Expected response: `Ollama is running`

### Out-of-memory errors for Ollama

The default memory limit is 8 G. If you are running a larger model (e.g., `llama3.1:70b`) you need more RAM. Increase the limit in `docker-compose.prod.yml`:

```yaml
  ollama:
    deploy:
      resources:
        limits:
          memory: 32G
```

### Read-only filesystem errors

The `automate` service runs with `read_only: true`. All writes must go to `/app/data` (named volume) or `/tmp` (tmpfs). If a new dependency writes outside these paths, add another `tmpfs` entry:

```yaml
    tmpfs:
      - /tmp:size=64m,mode=1777
      - /run:size=16m
```
