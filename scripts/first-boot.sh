#!/bin/sh
# Run the unified stack with first-boot initialization
# Usage: ./scripts/first-boot.sh

echo "Starting Automate platform (first boot)..."
docker compose -f docker-compose.unified.yml --profile init up -d

echo ""
echo "Waiting for initialization..."
docker compose -f docker-compose.unified.yml logs -f init
