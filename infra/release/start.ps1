# Automate - start, stop and update a local install (Windows PowerShell 5.1 and PowerShell 7).
#
#   .\start.cmd                      start (first run creates .env with random secrets)
#   .\start.cmd --profile NAME       start, recording the deployment profile in .env
#   .\start.cmd --remote cloudflare  start, and reach it from anywhere through Cloudflare Tunnel
#   .\start.cmd stop                 stop the containers; data is kept
#   .\start.cmd status               show the containers
#   .\start.cmd logs                 follow the logs
#   .\start.cmd update [--version X] move to the latest (or a given) release; data is kept
#   .\start.cmd uninstall [--purge]  remove the containers; --purge also deletes all data
#   .\start.cmd backup [--keep N]    write the database, artifacts and secrets to backups\;
#                                    --keep N then removes all but the newest N backups
#   .\start.cmd restore FOLDER       check a backup, then replace this install's data with it
#
# start.cmd runs this file with `-ExecutionPolicy Bypass`, so it works on a machine where
# running scripts is disabled; running start.ps1 directly needs scripts to be allowed.
#
# Settings, read from the environment or from .env:
#   AUTOMATE_PROFILE   solo (default: this machine, no login), startup, team or enterprise
#   AUTOMATE_PORT      the port to open (default 8080)
#   AUTOMATE_BIND      the address to listen on (default 127.0.0.1, this machine only)
#   AUTOMATE_LAN_MODE  1 to serve other machines on your network, with sign-in required

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$Docker = if ($env:AUTOMATE_DOCKER) { $env:AUTOMATE_DOCKER } else { 'docker' }
$Project = if ($env:AUTOMATE_PROJECT) { $env:AUTOMATE_PROJECT } else { 'automate' }
$ReleasesUrl = if ($env:AUTOMATE_RELEASES_URL) { $env:AUTOMATE_RELEASES_URL } else { 'https://api.github.com/repos/Sergey-Bar/AutoMate/releases/latest' }
$ReadyTimeout = if ($env:AUTOMATE_READY_TIMEOUT) { [int]$env:AUTOMATE_READY_TIMEOUT } else { 180 }
$EnvFile = Join-Path $PSScriptRoot '.env'
# .env is UTF-8 without a byte-order mark, read and written: Compose reads a BOM as part of the
# first name, and a comment or a value in another language has to survive a rewrite.
$EnvEncoding = New-Object System.Text.UTF8Encoding $false

function Fail([string]$Message) {
  [Console]::Error.WriteLine("automate: $Message")
  exit 1
}

function Show-Usage {
  Write-Output 'Usage: .\start.cmd [--profile solo|startup|team|enterprise] [--remote cloudflare] | stop|status|logs|update [--version X]|uninstall [--purge]|lan-cert|backup [--keep N]|restore FOLDER'
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
  Write-EnvLines $lines
  Write-Output 'Created .env with new random secrets.'
}

function Read-EnvLines {
  return [System.IO.File]::ReadAllLines($EnvFile, $EnvEncoding)
}

function Write-EnvLines([string[]]$Lines) {
  [System.IO.File]::WriteAllText($EnvFile, (($Lines -join "`n") + "`n"), $EnvEncoding)
}

# A value from the environment first, then .env, then the default.
function Get-Setting([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value -and (Test-Path -LiteralPath $EnvFile)) {
    $line = Read-EnvLines | Where-Object { $_ -like "$Name=*" } | Select-Object -Last 1
    if ($line) { $value = $line.Substring($Name.Length + 1) }
  }
  if ($value) { return $value } else { return $Default }
}

# The compose command line. The tunnel's profile is there while this install is remote, so
# start, status and logs include it, and always with -AllProfiles: stop and uninstall have to
# reach a tunnel an earlier --remote cloudflare started, which has `restart: unless-stopped`.
function Get-ComposeArgs([switch]$AllProfiles) {
  $composeArgs = @('compose', '-p', $Project, '--env-file', $EnvFile, '-f', (Join-Path $PSScriptRoot 'compose.yml'))
  if ($AllProfiles -or (Get-Setting 'AUTOMATE_REMOTE' '') -eq 'cloudflare') { $composeArgs += @('--profile', 'cloudflare') }
  return $composeArgs
}

function Invoke-Compose {
  $composeArgs = Get-ComposeArgs
  & $Docker @composeArgs @args
  if ($LASTEXITCODE -ne 0) { Fail "docker compose $($args -join ' ') failed." }
}

function Invoke-ComposeAll {
  $composeArgs = Get-ComposeArgs -AllProfiles
  & $Docker @composeArgs @args
  if ($LASTEXITCODE -ne 0) { Fail "docker compose $($args -join ' ') failed." }
}

# A compose step whose failure the caller handles: $true when it succeeded. Its output goes to
# the console, so it cannot be mistaken for the answer.
function Test-Compose {
  $composeArgs = Get-ComposeArgs
  & $Docker @composeArgs @args | Out-Host
  return ($LASTEXITCODE -eq 0)
}

# Cleanup that may find nothing to clean: no output, and no failure. 'Continue' because Windows
# PowerShell 5.1 turns a redirected stderr line into a terminating error under 'Stop'.
function Invoke-ComposeQuietly {
  $ErrorActionPreference = 'Continue'
  $composeArgs = Get-ComposeArgs -AllProfiles
  & $Docker @composeArgs @args *> $null
}

# SQL against the maintenance database, for what cannot run inside the database it changes:
# creating, dropping and renaming databases. PostgreSQL refuses those while anyone else is
# connected, so other sessions on the three a restore touches are ended first. Stops at the
# first error.
$AdminSql = @('exec', '-T', 'postgres', 'psql', '-U', 'automate', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq',
  '-c', 'SET client_min_messages = warning',
  '-c', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('automate', 'automate_restore', 'automate_previous') AND pid <> pg_backend_pid()")

# $true when every statement ran.
function Invoke-AdminSql {
  $sql = $AdminSql
  foreach ($statement in $args) { $sql += @('-c', [string]$statement) }
  $composeArgs = Get-ComposeArgs
  & $Docker @composeArgs @sql | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# Sets NAME=VALUE in .env, replacing the line that is there. The value is written as given,
# so a tunnel token's `/`, `+` and `=` are kept exactly.
function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = @(Read-EnvLines | Where-Object { $_ -notlike "$Name=*" })
  $lines += "$Name=$Value"
  Write-EnvLines $lines
}

# `--remote cloudflare`: the three values a tunnel needs, from the environment or .env, kept
# in .env so the next plain start still has them. The token is never printed.
function Set-Remote([string]$Mode) {
  if ($Mode -ne 'cloudflare') { Fail '--remote takes one value: cloudflare.' }
  $names = @('TUNNEL_TOKEN', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD')
  $missing = @($names | Where-Object { -not (Get-Setting $_ '') })
  if ($missing.Count -gt 0) {
    Fail "--remote cloudflare needs $($missing -join ' '). Create a tunnel and an Access application in the Cloudflare Zero Trust dashboard, then set them (see the remote access guide)."
  }
  $values = @{}
  foreach ($name in $names) { $values[$name] = Get-Setting $name '' }
  foreach ($name in $names) { Set-EnvValue $name $values[$name] }
  Set-EnvValue 'AUTOMATE_REMOTE' 'cloudflare'
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

# A reachable install with no login is refused, not warned about. The API refuses the same
# bind at startup (apps/api/src/startup-policy.ts); saying it here means the operator reads
# it at the prompt, before anything is downloaded.
function Assert-Exposure {
  $bind = Get-Setting 'AUTOMATE_BIND' '127.0.0.1'
  $profileName = Get-Setting 'AUTOMATE_PROFILE' ''
  Assert-ProfileName $profileName
  $lan = @('1', 'true', 'yes') -contains (Get-Setting 'AUTOMATE_LAN_MODE' '')
  if ($profileName -eq 'solo' -and $lan) {
    Fail 'AUTOMATE_PROFILE=solo keeps Automate on this machine, and AUTOMATE_LAN_MODE is on. Set AUTOMATE_PROFILE=startup to serve other people with sign-in.'
  }
  if ($bind -like '127.*' -or $bind -eq 'localhost' -or $bind -eq '::1' -or $bind -eq '[::1]') { return }
  if ($profileName -eq 'solo') {
    Fail "AUTOMATE_PROFILE=solo keeps Automate on this machine, and AUTOMATE_BIND=$bind would make it reachable. Set AUTOMATE_PROFILE=startup to serve other people with sign-in, or unset AUTOMATE_BIND."
  }
  if (-not $lan -and -not $profileName) {
    Fail "AUTOMATE_BIND=$bind would make Automate reachable from other machines with no login. Set AUTOMATE_LAN_MODE=1 (or AUTOMATE_PROFILE=startup) to serve your network with sign-in and device pairing, or unset AUTOMATE_BIND to keep it on this machine."
  }
  $port = Get-Setting 'AUTOMATE_PORT' '8080'
  Write-Output ''
  if ($lan) {
    Write-Output "LAN mode: other machines on your network can reach Automate on port $port, after signing in."
  } else {
    Write-Output "Profile ${profileName}: other machines can reach Automate on port $port, after signing in."
  }
  Write-Output 'If they cannot connect, allow the port through Windows Firewall from an elevated PowerShell (not done for you):'
  Write-Output "  New-NetFirewallRule -DisplayName 'Automate' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private"
  Write-Output ''
}

# The deployment profile (ADR-014). Empty is unset, which the API reads as solo, or as
# startup when LAN mode is on.
function Assert-ProfileName([string]$Name) {
  if (@('', 'solo', 'startup', 'team', 'enterprise') -notcontains $Name) {
    Fail "AUTOMATE_PROFILE=$Name is not a profile. Use solo, startup, team or enterprise."
  }
}

# Writes AUTOMATE_PROFILE into .env, replacing the line that is there. Nothing else in .env
# is touched: the secrets in it sign sessions and encrypt the vault.
function Set-Profile([string]$Name) {
  if (-not $Name) { Fail '--profile needs a value: solo, startup, team or enterprise.' }
  Assert-ProfileName $Name
  Set-EnvValue 'AUTOMATE_PROFILE' $Name
}

# What to do next, per profile. Printed after a start so the first run ends with an action.
function Write-NextStep([string]$Name) {
  switch ($Name) {
    'startup' { Write-Output 'Next step: sign in with the key below, then pair devices or issue access tokens on the Access page.' }
    { $_ -in 'team', 'enterprise' } { Write-Output 'Next step: sign in with the key below, then open Map > Deployment to see what this profile turns on.' }
    default { Write-Output 'Next step: open a project, or send test results from CI with the automate CLI.' }
  }
}

function Start-Automate([string[]]$Options = @()) {
  Assert-Docker
  Initialize-EnvFile
  $remoteWanted = ''
  for ($i = 0; $i -lt $Options.Count; $i++) {
    if ($Options[$i] -eq '--profile') {
      $value = if ($i + 1 -lt $Options.Count) { $Options[$i + 1] } else { '' }
      Set-Profile $value
      $i++
    } elseif ($Options[$i] -like '--profile=*') {
      Set-Profile $Options[$i].Substring(10)
    } elseif ($Options[$i] -eq '--remote') {
      $remoteWanted = if ($i + 1 -lt $Options.Count) { $Options[$i + 1] } else { '' }
      if (-not $remoteWanted) { Fail '--remote takes one value: cloudflare.' }
      $i++
    } elseif ($Options[$i] -like '--remote=*') {
      $remoteWanted = $Options[$i].Substring(9)
    } else {
      Show-Usage
      exit 2
    }
  }
  # After the profile, so `--profile solo --remote cloudflare` is refused by name.
  if ($remoteWanted) {
    if ((Get-Setting 'AUTOMATE_PROFILE' '') -eq 'solo') {
      Fail 'AUTOMATE_PROFILE=solo keeps Automate on this machine, and --remote cloudflare publishes it through a tunnel. Use --profile startup (or larger).'
    }
    Set-Remote $remoteWanted
  }
  Assert-Exposure
  # Remote access turned off: the tunnel an earlier start left running is removed, or it would
  # go on publishing the install. Nothing to remove is the usual case, so it is quiet.
  if ((Get-Setting 'AUTOMATE_REMOTE' '') -ne 'cloudflare') { Invoke-ComposeQuietly rm --stop --force cloudflared }
  $port = Get-Setting 'AUTOMATE_PORT' '8080'
  $base = "http://localhost:$port"
  Write-Output 'Downloading the Automate images (the first run takes a few minutes)...'
  # Images already here keep working offline; a tag that is missing still fails in 'up'.
  Invoke-Compose pull --ignore-pull-failures
  Invoke-Compose up -d
  Wait-Ready "http://127.0.0.1:$port"
  $profileName = Get-Setting 'AUTOMATE_PROFILE' 'solo'
  Write-Output ''
  Write-Output "Automate is running at $base"
  Write-Output "Profile: $profileName"
  if ((Get-Setting 'AUTOMATE_REMOTE' '') -eq 'cloudflare') {
    Write-Output 'Remote: through Cloudflare Tunnel, at the public hostname you gave the tunnel. Cloudflare Access decides who reaches it.'
  }
  Write-Output "Sign in with this key: $(Get-Setting 'AUTOMATE_INSTALLATION_KEY' '')"
  Write-Output '(it is also in .env as AUTOMATE_INSTALLATION_KEY)'
  Write-NextStep $profileName
  if ($env:AUTOMATE_NO_BROWSER -ne '1') { Start-Process $base }
}

function Set-Version([string]$Version) {
  Set-EnvValue 'AUTOMATE_VERSION' $Version
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

# Every name and address this machine answers to on the network, for the certificate's
# subjectAltName. AUTOMATE_TLS_NAMES adds more, comma-separated.
function Get-LanNames {
  $hostName = [Environment]::MachineName.ToLowerInvariant()
  $ips = @()
  try {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        ForEach-Object { $_.IPAddress })
  } catch {
    # Not Windows (pwsh on Linux or macOS): the resolver's view of this host.
    $ips = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
        Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('127.') } |
        ForEach-Object { $_.ToString() })
  }
  $extra = @((Get-Setting 'AUTOMATE_TLS_NAMES' '') -split ',' | ForEach-Object { $_.Trim() })
  $all = @('automate.local', $hostName, "$hostName.local", 'localhost', '127.0.0.1') + $ips + $extra
  return (@($all | Where-Object { $_ -ne '' } | Select-Object -Unique) -join ',')
}

function New-LanCertificate {
  Assert-Docker
  Initialize-EnvFile
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'certs') | Out-Null
  $names = Get-LanNames
  Write-Output "Issuing a LAN certificate for: $names"
  Invoke-Compose run --rm --no-deps --user 0 --entrypoint automate-lan-cert edge $names
  Write-Output ''
  Write-Output 'Done. Trust certs\ca.crt once on each device that opens Automate, then restart:'
  Write-Output '  .\start.cmd stop; .\start.cmd'
  Write-Output 'How to trust it on Windows, macOS, Linux, iPhone and Android: docs on LAN mode.'
}

# A file's sha256, through .NET rather than Get-FileHash. In Windows PowerShell 5.1,
# Get-FileHash is a script-module function that has to be autoloaded, and started from a
# PowerShell 7 terminal (which is what start.cmd inherits there), 5.1 finds 7's module first,
# cannot load it, and reports that Get-FileHash does not exist.
function Get-FileSha256([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead((Resolve-Path -LiteralPath $Path).ProviderPath)
  try {
    $bytes = $sha.ComputeHash($stream)
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# A string's sha256. Used for the vault key, so a backup can say which key it needs without
# holding the key in its manifest.
function Get-TextSha256([string]$Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
  } finally { $sha.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

# How many migrations the database has applied: the schema a backup was taken at. 'Continue'
# because Docker says on stderr that the stack is down, and Windows PowerShell 5.1 turns a
# redirected stderr line into a terminating error under 'Stop'.
function Get-MigrationCount {
  $ErrorActionPreference = 'Continue'
  $composeArgs = Get-ComposeArgs
  $out = & $Docker @composeArgs exec -T postgres psql -U automate -d automate -tAc 'SELECT count(*) FROM drizzle.__drizzle_migrations' 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return ((@($out) -join '') -replace '\s', '')
}

function Read-Manifest([string]$Folder) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath (Join-Path $Folder 'manifest.env')) {
    $at = $line.IndexOf('=')
    if ($at -gt 0) { $values[$line.Substring(0, $at)] = $line.Substring($at + 1) }
  }
  return $values
}

# Whether dotted version $A is newer than $B. A pre-release suffix is ignored.
function Test-VersionNewer([string]$A, [string]$B) {
  $left = @(($A -split '-')[0] -split '\.' | ForEach-Object { [int]$_ })
  $right = @(($B -split '-')[0] -split '\.' | ForEach-Object { [int]$_ })
  for ($i = 0; $i -lt [Math]::Max($left.Count, $right.Count); $i++) {
    $x = if ($i -lt $left.Count) { $left[$i] } else { 0 }
    $y = if ($i -lt $right.Count) { $right[$i] } else { 0 }
    if ($x -gt $y) { return $true }
    if ($x -lt $y) { return $false }
  }
  return $false
}

function Write-AsciiLines([string]$Path, [string[]]$Lines) {
  [System.IO.File]::WriteAllText($Path, (($Lines -join "`n") + "`n"), (New-Object System.Text.ASCIIEncoding))
}

# The database, the stored artifacts and .env, each with a digest, into backups\. The
# database is dumped consistently by pg_dump; artifact bytes are written once and never
# changed, so a copy taken while the install runs is whole for every finished upload.
# Files are copied out with 'compose cp' rather than redirected: PowerShell 5.1 re-encodes
# a native command's redirected output, which would corrupt a binary dump.
function Backup-Automate([string[]]$Rest) {
  $keep = $null
  for ($i = 0; $i -lt $Rest.Count; $i++) {
    $option = $Rest[$i]
    if ($option -eq '--keep') {
      $keep = if ($i + 1 -lt $Rest.Count) { $Rest[$i + 1] } else { '' }
      $i++
    } elseif ($option -like '--keep=*') {
      $keep = $option.Substring('--keep='.Length)
    } else {
      Fail "Unknown backup option '$option'. Use .\start.cmd backup [--keep N]."
    }
  }
  if ($null -ne $keep -and $keep -notmatch '^[1-9][0-9]*$') {
    Fail '--keep needs a whole number of backups to keep, 1 or more, like --keep 7.'
  }
  if (-not (Test-Path -LiteralPath $EnvFile)) { Fail 'There is nothing to back up yet: no .env here. Run .\start.cmd first.' }
  Assert-Docker
  $count = Get-MigrationCount
  if ($count -notmatch '^\d+$') { Fail "Could not read the database's migrations. Is Automate running? (.\start.cmd status)" }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  $relative = "backups/automate-$stamp"
  $folder = Join-Path $PSScriptRoot $relative
  if (Test-Path -LiteralPath $folder) { Fail "$relative already exists. Run the backup again in a second." }
  # Written under a hidden name and renamed once the manifest is in it, so a backup that fails
  # part-way never leaves a folder that --keep counts. A failed one is removed: it holds a
  # copy of the database.
  $work = "backups/.automate-$stamp.partial"
  $workPath = Join-Path $PSScriptRoot $work
  if (Test-Path -LiteralPath $workPath) { Remove-Item -LiteralPath $workPath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $workPath | Out-Null
  $written = $false
  try {
    Write-Output 'Backing up the database...'
    Invoke-Compose exec -T postgres pg_dump -U automate -d automate -Fc -f /tmp/automate-backup.dump
    Invoke-Compose cp postgres:/tmp/automate-backup.dump "$work/database.dump"
    Invoke-Compose exec -T postgres rm -f /tmp/automate-backup.dump
    Write-Output 'Backing up stored artifacts...'
    Invoke-Compose exec -T objectstore tar -C /data -cf /tmp/automate-objects.tar .
    Invoke-Compose cp objectstore:/tmp/automate-objects.tar "$work/objects.tar"
    Invoke-Compose exec -T objectstore rm -f /tmp/automate-objects.tar
    Copy-Item -LiteralPath $EnvFile -Destination (Join-Path $workPath 'env')
    $sums = foreach ($part in 'database.dump', 'objects.tar', 'env') {
      "$(Get-FileSha256 (Join-Path $workPath $part))  $part"
    }
    Write-AsciiLines (Join-Path $workPath 'SHA256SUMS') $sums
    Write-AsciiLines (Join-Path $workPath 'manifest.env') @(
      'format=1',
      "created=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
      "version=$(Get-Setting 'AUTOMATE_VERSION' '')",
      "migrations=$count",
      "vault=$(Get-TextSha256 (Get-Setting 'VAULT_SECRET' ''))"
    )
    Move-Item -LiteralPath $workPath -Destination $folder
    $written = $true
  } finally {
    # Fail exits through here too.
    if (-not $written) { Remove-Item -LiteralPath $workPath -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Write-Output "Backup written to $relative"
  Write-Output 'It holds your secrets (the env file): store it like a password, and off this machine.'
  if ($null -ne $keep) { Remove-OldBackups ([int]$keep) }
}

# Removes the oldest backups beyond the newest N. Only folders named the way Backup-Automate
# names them are counted or removed, never a hidden .partial one; anything else in backups\ is
# left alone.
function Remove-OldBackups([int]$Keep) {
  $root = Join-Path $PSScriptRoot 'backups'
  # The names sort by time, so the newest are last.
  $all = @(Get-ChildItem -LiteralPath $root -Directory |
      Where-Object { $_.Name -cmatch '^automate-\d{8}T\d{6}Z$' } |
      Sort-Object Name)
  $stale = if ($all.Count -gt $Keep) { $all[0..($all.Count - $Keep - 1)] } else { @() }
  foreach ($folder in $stale) { Remove-Item -LiteralPath $folder.FullName -Recurse -Force }
  if ($stale.Count -gt 0) {
    Write-Output "Removed $($stale.Count) older backup(s), keeping the newest $Keep."
  }
}

# A restore that stopped before the swap. This install's own database was never touched, so the
# copy is dropped and Automate starts again on its own data rather than staying down.
function Restore-Failed([string]$Message) {
  Invoke-ComposeQuietly exec -T postgres rm -f /tmp/automate-restore.dump
  Invoke-ComposeQuietly @AdminSql -c 'DROP DATABASE IF EXISTS automate_restore'
  if (-not (Test-Compose up -d)) { Fail "$Message Nothing was replaced, but Automate could not be started again: run .\start.cmd." }
  Fail "$Message Nothing was replaced: Automate is started again on its own data. The output above says why."
}

# Checks everything before it changes anything: every digest, the vault key, the release
# and the schema. Then the install stops, the backup's database is loaded beside this one and
# swapped in, the objects are replaced, and it starts again. An older backup is fine: the
# newer release's migrations run forward on start.
function Restore-Automate([string[]]$Rest) {
  $given = if ($Rest.Count -ge 1) { $Rest[0] } else { '' }
  $folder = if ($given -and [System.IO.Path]::IsPathRooted($given)) { $given } elseif ($given) { Join-Path $PSScriptRoot $given } else { '' }
  if (-not $folder -or -not (Test-Path -LiteralPath (Join-Path $folder 'manifest.env')) -or -not (Test-Path -LiteralPath (Join-Path $folder 'SHA256SUMS'))) {
    Fail "There is no backup at '$given'. Pass the folder '.\start.cmd backup' wrote, like backups\automate-20261027T120000Z."
  }
  if (-not (Test-Path -LiteralPath $EnvFile)) { Fail "Restore into an install: copy $given\env to .env before its first start, start it (.\start.cmd), then run this again." }
  $manifest = Read-Manifest $folder
  if ($manifest['format'] -ne '1') { Fail "$given was written by a newer start script. Update first: .\start.cmd update" }
  $sums = Get-Content -LiteralPath (Join-Path $folder 'SHA256SUMS')
  foreach ($part in 'database.dump', 'objects.tar', 'env') {
    $line = $sums | Where-Object { $_ -like "*  $part" } | Select-Object -First 1
    $path = Join-Path $folder $part
    if (-not (Test-Path -LiteralPath $path)) { Fail "$given\$part is missing. Nothing was restored." }
    if (-not $line -or $line.Substring(0, $line.IndexOf(' ')) -ne (Get-FileSha256 $path)) {
      Fail "$given\$part does not match its digest in SHA256SUMS: the backup is damaged. Nothing was restored."
    }
  }
  # Only the vault key: this install's database keeps the POSTGRES_PASSWORD it was first started
  # with and the dump carries no roles, so the backup's whole env over .env locks it out.
  if ($manifest['vault'] -ne (Get-TextSha256 (Get-Setting 'VAULT_SECRET' ''))) {
    Fail "This backup was made with a different VAULT_SECRET, so the credentials stored in it could not be read. On this install, keep a copy of .env, then set only VAULT_SECRET in it to the value in $given\env and run the restore again; the rest of .env stays, because this install's database keeps the POSTGRES_PASSWORD it was first started with. On a new host, copy $given\env to .env before the first start."
  }
  $taken = [string]$manifest['version']
  $current = Get-Setting 'AUTOMATE_VERSION' ''
  if ($taken -and $current -and (Test-VersionNewer $taken $current)) {
    Fail "This backup is from Automate $taken, which is newer than this install ($current). Update first: .\start.cmd update --version $taken"
  }
  Assert-Docker
  $wanted = [string]$manifest['migrations']
  if ($wanted -notmatch '^\d+$') { Fail "$given\manifest.env records no migration count. Nothing was restored." }
  $have = Get-MigrationCount
  if ($have -notmatch '^\d+$') { Fail "Could not read this install's migrations. Start Automate first (.\start.cmd), then restore." }
  if ([int]$wanted -gt [int]$have) {
    Fail "This backup has $wanted migrations and this install has ${have}: its schema is newer. Update first: .\start.cmd update"
  }
  Write-Output "Restoring $given. Automate stops while it runs."
  if (-not (Test-Compose stop api worker runner web edge objectstore)) { Restore-Failed 'Automate could not be stopped for the restore.' }
  # Into automate_restore, a new database beside this install's, so no table a newer release
  # added here can block it. One transaction, so a load that fails part-way leaves it empty.
  $loaded = (Invoke-AdminSql 'DROP DATABASE IF EXISTS automate_restore' 'CREATE DATABASE automate_restore') -and
    (Test-Compose cp (Join-Path $folder 'database.dump') postgres:/tmp/automate-restore.dump) -and
    (Test-Compose exec -T postgres pg_restore -U automate -d automate_restore --no-owner --single-transaction /tmp/automate-restore.dump)
  if (-not $loaded) { Restore-Failed "The database in $given could not be restored." }
  Invoke-ComposeQuietly exec -T postgres rm -f /tmp/automate-restore.dump
  # Both renames in one statement, so in one transaction: either the restored database is
  # automate, or nothing moved.
  if (-not (Invoke-AdminSql 'DROP DATABASE IF EXISTS automate_previous' 'ALTER DATABASE automate RENAME TO automate_previous; ALTER DATABASE automate_restore RENAME TO automate')) {
    Restore-Failed 'The restored database could not be swapped in.'
  }
  Write-Output 'The database it replaced is kept as automate_previous, until the next restore. Once this one is right, drop it from this folder:'
  Write-Output "  docker compose -p $Project exec postgres psql -U automate -d postgres -c `"DROP DATABASE automate_previous`""
  # The objects belong to the restored database, so they are replaced only once it is in.
  $mount = (Resolve-Path -LiteralPath $folder).Path + ':/backup:ro'
  if (-not (Test-Compose run --rm --no-deps -T -v $mount --entrypoint sh objectstore -c 'find /data -mindepth 1 -delete && tar -C /data -xf /backup/objects.tar')) {
    Fail "The database is restored from $given, but its stored artifacts could not be put back, so Automate is left stopped. The output above says why."
  }
  Invoke-Compose up -d
  $port = Get-Setting 'AUTOMATE_PORT' '8080'
  Wait-Ready "http://127.0.0.1:$port"
  Write-Output "Restored $given. Migrations newer than the backup ran on start."
}

function Uninstall-Automate([string[]]$Rest) {
  Assert-Docker
  if (-not (Test-Path -LiteralPath $EnvFile)) { [System.IO.File]::WriteAllText($EnvFile, '') }
  if ($Rest.Count -ge 1 -and $Rest[0] -eq '--purge') {
    Invoke-ComposeAll down -v --remove-orphans
    Remove-Item -LiteralPath $EnvFile -Force
    Write-Output 'Automate is removed, with all of its data.'
  } else {
    Invoke-ComposeAll down --remove-orphans
    Write-Output 'Automate is removed. Your data and .env are kept; run .\start.cmd to start again.'
  }
}

$command = if ($args.Count -gt 0) { [string]$args[0] } else { 'start' }
$rest = if ($args.Count -gt 1) { [string[]]$args[1..($args.Count - 1)] } else { [string[]]@() }
switch ($command) {
  'start' { Start-Automate $rest }
  { $_ -like '--profile*' -or $_ -like '--remote*' } { Start-Automate (@($command) + $rest) }
  'stop' { Assert-Docker; Invoke-ComposeAll stop }
  'status' { Assert-Docker; Invoke-Compose ps }
  'logs' { Assert-Docker; Invoke-Compose logs --tail 200 -f }
  'update' { Update-Automate $rest }
  'uninstall' { Uninstall-Automate $rest }
  'lan-cert' { New-LanCertificate }
  'backup' { Backup-Automate $rest }
  'restore' { Restore-Automate $rest }
  { $_ -in 'help', '-h', '--help' } { Show-Usage }
  default { Show-Usage; exit 2 }
}
exit 0
