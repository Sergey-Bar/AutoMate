# Webwright Bridge

Python sidecar service for the Automate platform. Provides a FastAPI HTTP bridge for future Microsoft Webwright agent integration.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) ≥ 0.4 — Python package manager
- Python ≥ 3.10 (uv will manage the interpreter automatically)

## Local Development

```bash
# From this directory: services/webwright/

# Install all dependencies (including dev)
uv sync

# Run the dev server (hot-reload)
uv run uvicorn webwright_bridge.main:app --reload --host 0.0.0.0 --port 8000

# The API is now available at http://localhost:8000
# Health check: curl http://localhost:8000/health
```

## Running Tests

```bash
uv run pytest
```

## Linting & Type Checking

```bash
# Lint
uv run ruff check .

# Auto-fix lint issues
uv run ruff check --fix .

# Type check
uv run mypy src/
```

## Docker

```bash
# Build
docker build -t webwright-bridge .

# Run
docker run -p 8000:8000 webwright-bridge

# Health check
curl http://localhost:8000/health
# → {"status":"ok"}
```

## Project Structure

```
services/webwright/
├── pyproject.toml              # uv-managed project config
├── Dockerfile                  # Multi-stage build
├── src/
│   └── webwright_bridge/
│       ├── __init__.py         # Package init
│       └── main.py             # FastAPI app + /health endpoint
└── tests/
    └── test_smoke.py           # Smoke tests
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{"status": "ok"}` |
