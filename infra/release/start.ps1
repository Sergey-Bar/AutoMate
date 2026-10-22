# Automate - start, stop and update a local install (Windows PowerShell 5.1 and PowerShell 7).
#
#   .\start.cmd                      start (first run creates .env with random secrets)
#   .\start.cmd stop                 stop the containers; data is kept
#   .\start.cmd status               show the containers
#   .\start.cmd logs                 follow the logs
#   .\start.cmd update [--version X] move to the latest (or a given) release; data is kept
#   .\start.cmd uninstall [--purge]  remove the containers; --purge also deletes all data
#
# start.cmd runs this file with `-ExecutionPolicy Bypass`, so it works on a machine where
# running scripts is disabled; running start.ps1 directly needs scripts to be allowed.
#
# Settings, read from the environment or from .env:
#   AUTOMATE_PORT   the port to open (default 8080)
#   AUTOMATE_BIND   the address to listen on (default 127.0.0.1, this machine only)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$Docker = if ($env:AUTOMATE_DOCKER) { $env:AUTOMATE_DOCKER } else { 'docker' }
$Project = if ($env:AUTOMATE_PROJECT) { $env:AUTOMATE_PROJECT } else { 'automate' }
$ReleasesUrl = if ($env:AUTOMATE_RELEASES_URL) { $env:AUTOMATE_RELEASES_URL } else { 'https://api.github.com/repos/Sergey-Bar/AutoMate/releases/latest' }
$ReadyTimeout = if ($env:AUTOMATE_READY_TIMEOUT) { [int]$env:AUTOMATE_READY_TIMEOUT } else { 180 }
$EnvFile = Join-Path $PSScriptRoot '.env'

function Fail([string]$Message) {
  [Console]::Error.WriteLine("automate: $Message")
  exit 1
}

function Show-Usage {
  Write-Output 'Usage: .\start.cmd [stop|status|logs|update [--version X]|uninstall [--purge]]'
}

# Docker, running, with Compose v2 - each missing piece named, with what to do about it.
function Assert-Docker {
  if (-not (Get-Command $Docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker is not installed. Install Docker Desktop from https://docs.docker.com/get-docker/ and run this again.'
  }
  & $Docker info *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Docker is not running. Start Docker Desktop and run this again.' }
  & $Docker compose version *> $null
  if ($LASTEXITCODE -ne 0) { Fail "Docker Compose v2 is required ('docker compose'). Update Docker Desktop." }
}

# 48 hex characters: over the 32-character floor every secret has.
function New-Secret {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# Written once. A second run never overwrites it: the secrets sign sessions and encrypt
# the vault, so new values would lock the install out of its own data.
function Initialize-EnvFile {
  if (Test-Path -LiteralPath $EnvFile) { return }
  $accessKey = 'AK' + (New-Secret).Substring(0, 18).ToUpperInvariant()
  $lines = @(
    "# Created by start.ps1 on $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')). Keep it: the secrets below",
    '# sign sessions and encrypt stored credentials.',
    "POSTGRES_PASSWORD=$(New-Secret)",
    "COOKIE_SECRET=$(New-Secret)",
    "VAULT_SECRET=$(New-Secret)",
    "AUTOMATE_API_KEY=$(New-Secret)",
    "AUTOMATE_INSTALLATION_KEY=$(New-Secret)",
    "REPORTER_SECRET=$(New-Secret)",
    "RUNNER_REGISTRATION_SECRET=$(New-Secret)",
    'OBJECT_STORE_BUCKET=automate-artifacts',
    'OBJECT_STORE_REGION=us-east-1',
    "OBJECT_STORE_ACCESS_KEY_ID=$accessKey",
    "OBJECT_STORE_SECRET_ACCESS_KEY=$(New-Secret)"
  )
  # ASCII without a byte-order mark: Compose reads a BOM as part of the first name.
  [System.IO.File]::WriteAllText($EnvFile, (($lines -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))
  Write-Output 'Created .env with new random secrets.'
}

# A value from the environment first, then .env, then the default.
function Get-Setting([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value -and (Test-Path -LiteralPath $EnvFile)) {
    $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -like "$Name=*" } | Select-Object -Last 1
    if ($line) { $value = $line.Substring($Name.Length + 1) }
  }
  if ($value) { return $value } else { return $Default }
}

function Invoke-Compose {
  & $Docker compose -p $Project --env-file $EnvFile -f (Join-Path $PSScriptRoot 'compose.yml') @args
  if ($LASTEXITCODE -ne 0) { Fail "docker compose $($args -join ' ') failed." }
}

function Wait-Ready([string]$Base) {
  Write-Output "Waiting for Automate to be ready (up to ${ReadyTimeout}s)..."
  $deadline = (Get-Date).AddSeconds($ReadyTimeout)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri "$Base/api/v1/ready" -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  Fail "Automate did not become ready in ${ReadyTimeout}s. Run '.\start.cmd logs' to see why."
}

function Show-ExposureWarning {
  $bind = Get-Setting 'AUTOMATE_BIND' '127.0.0.1'
  if ($bind -like '127.*' -or $bind -eq 'localhost' -or $bind -eq '::1') { return }
  Write-Output ''
  Write-Output "WARNING: AUTOMATE_BIND=$bind makes Automate reachable from other machines."
  Write-Output 'WARNING: The install has no login, so anyone who can reach this port can use it.'
  Write-Output 'WARNING: Unset AUTOMATE_BIND to keep it on this machine only.'
  Write-Output ''
}

function Start-Automate {
  Assert-Docker
  Initialize-EnvFile
  Show-ExposureWarning
  $port = Get-Setting 'AUTOMATE_PORT' '8080'
  $base = "http://localhost:$port"
  Write-Output 'Downloading the Automate images (the first run takes a few minutes)...'
  # Images already here keep working offline; a tag that is missing still fails in 'up'.
  Invoke-Compose pull --ignore-pull-failures
  Invoke-Compose up -d
  Wait-Ready "http://127.0.0.1:$port"
  Write-Output ''
  Write-Output "Automate is running at $base"
  Write-Output "Sign in with this key: $(Get-Setting 'AUTOMATE_INSTALLATION_KEY' '')"
  Write-Output '(it is also in .env as AUTOMATE_INSTALLATION_KEY)'
  if ($env:AUTOMATE_NO_BROWSER -ne '1') { Start-Process $base }
}

function Set-Version([string]$Version) {
  $lines = @(Get-Content -LiteralPath $EnvFile | Where-Object { $_ -notlike 'AUTOMATE_VERSION=*' })
  $lines += "AUTOMATE_VERSION=$Version"
  [System.IO.File]::WriteAllText($EnvFile, (($lines -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))
}

function Update-Automate([string[]]$Rest) {
  $version = $null
  if ($Rest.Count -ge 2 -and $Rest[0] -eq '--version') { $version = $Rest[1] }
  if (-not $version) {
    try {
      $release = Invoke-RestMethod -Uri $ReleasesUrl -UseBasicParsing
      $version = ([string]$release.tag_name) -replace '^v', ''
    } catch { }
  }
  if (-not $version) { Fail 'Could not read the latest release version. Use: .\start.cmd update --version X' }
  Assert-Docker
  Initialize-EnvFile
  Set-Version $version
  Write-Output "Updating to Automate $version. Your data is kept; migrations run on start."
  Start-Automate
}

function Uninstall-Automate([string[]]$Rest) {
  Assert-Docker
  if (-not (Test-Path -LiteralPath $EnvFile)) { [System.IO.File]::WriteAllText($EnvFile, '') }
  if ($Rest.Count -ge 1 -and $Rest[0] -eq '--purge') {
    Invoke-Compose down -v --remove-orphans
    Remove-Item -LiteralPath $EnvFile -Force
    Write-Output 'Automate is removed, with all of its data.'
  } else {
    Invoke-Compose down --remove-orphans
    Write-Output 'Automate is removed. Your data and .env are kept; run .\start.cmd to start again.'
  }
}

$command = if ($args.Count -gt 0) { [string]$args[0] } else { 'start' }
$rest = if ($args.Count -gt 1) { [string[]]$args[1..($args.Count - 1)] } else { [string[]]@() }
switch ($command) {
  'start' { Start-Automate }
  'stop' { Assert-Docker; Invoke-Compose stop }
  'status' { Assert-Docker; Invoke-Compose ps }
  'logs' { Assert-Docker; Invoke-Compose logs --tail 200 -f }
  'update' { Update-Automate $rest }
  'uninstall' { Uninstall-Automate $rest }
  { $_ -in 'help', '-h', '--help' } { Show-Usage }
  default { Show-Usage; exit 2 }
}
exit 0
