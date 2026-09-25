# Air-Gapped Deployment Guide

Automate is designed to run entirely on-premise with no internet dependency after initial setup.

## Prerequisites

- Docker and Docker Compose installed on the target machine
- A machine with internet access for pre-pulling artifacts (the "staging" machine)

## Step 1 — Pre-pull Docker Images (Staging Machine)

```bash
docker pull node:22-bookworm-slim
docker pull ollama/ollama:latest

# Save images to tarballs for transfer
docker save node:22-bookworm-slim -o node22.tar
docker save ollama/ollama:latest -o ollama.tar
```

## Step 2 — Pre-pull Ollama Model Weights (Staging Machine)

```bash
# Start Ollama temporarily to pull the model
docker run -d --name ollama-tmp -v ollama-staging:/root/.ollama ollama/ollama:latest
docker exec ollama-tmp ollama pull llama3.1

# Export the volume
docker run --rm -v ollama-staging:/data -v $(pwd):/backup busybox tar czf /backup/ollama-models.tar.gz /data
docker stop ollama-tmp && docker rm ollama-tmp
```

## Step 3 — Transfer Artifacts to Air-Gapped Machine

Transfer the following files to the target machine via USB drive, SCP, or other approved method:

- `node22.tar` — Node.js base image
- `ollama.tar` — Ollama runtime image
- `ollama-models.tar.gz` — Pre-downloaded model weights
- Automate source code (this repository)

## Step 4 — Load Images on Air-Gapped Machine

```bash
docker load -i node22.tar
docker load -i ollama.tar

# Restore Ollama model weights
docker volume create ollama-data
docker run --rm -v ollama-data:/data -v $(pwd):/backup busybox tar xzf /backup/ollama-models.tar.gz -C /
```

## Step 5 — Build and Run Automate

```bash
# Build the Automate image locally (no network needed — all deps in lockfile)
docker compose build

# Start Automate + Ollama
docker compose up -d
```

Automate will be available at `http://localhost:3000`.

## Verifying Air-Gapped Operation

```bash
# Check health
curl http://localhost:3000/health

# Verify Ollama has the model
curl http://localhost:11434/api/tags
```

## Notes

- **No data leaves the network**: All LLM inference runs locally via Ollama. No prompts, test data, or tool outputs are transmitted externally.
- **Connector credentials** are stored in an AES-256 encrypted local vault. The vault master key must be provided via the `VAULT_KEY` environment variable or entered at startup.
- **Updates** require repeating the staging → transfer → load cycle. Consider maintaining a staging machine for periodic updates.
