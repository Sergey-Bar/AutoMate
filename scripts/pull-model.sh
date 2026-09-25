#!/bin/bash
# pull-model.sh — Pull the default Ollama model after containers start.
#
# Usage (from Automate/ directory):
#   bash scripts/pull-model.sh
#
# The model name is read from the AUTOMATE_MODEL environment variable.
# If the variable is unset it defaults to llama3.1, which matches the
# AUTOMATE_MODEL default in the application and README.
#
# Run this once after the first `docker compose ... up -d`, and again
# whenever you want to switch to a different model.

set -euo pipefail

MODEL="${AUTOMATE_MODEL:-llama3.1}"

echo "==> Pulling Ollama model: ${MODEL}"
docker compose exec ollama ollama pull "${MODEL}"
echo "==> Model '${MODEL}' is ready."
