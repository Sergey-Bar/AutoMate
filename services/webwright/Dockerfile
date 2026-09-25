# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pyproject.toml ./

# Install production dependencies into /app/.venv
RUN uv sync --no-dev --frozen

# Copy source
COPY src/ ./src/

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app

# Copy the pre-built venv and source from builder
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src

# Activate venv by prepending to PATH
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"

EXPOSE 8000

CMD ["uvicorn", "webwright_bridge.main:app", "--host", "0.0.0.0", "--port", "8000"]
