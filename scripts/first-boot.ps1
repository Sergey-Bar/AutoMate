# Run the unified stack with first-boot initialization
# Usage: .\scripts\first-boot.ps1

Write-Host "Starting Automate platform (first boot)..." -ForegroundColor Cyan
docker compose -f docker-compose.unified.yml --profile init up -d

Write-Host ""
Write-Host "Waiting for initialization..." -ForegroundColor Cyan
docker compose -f docker-compose.unified.yml logs -f init
