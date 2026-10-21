# Starts Tradelog locally with Docker Desktop on Windows: http://localhost:8080
#   .\scripts\local-up.ps1          start (first run asks for the Google OAuth client ID and secret)
#   .\scripts\local-up.ps1 -Demo    also load a month of sample trades
#   .\scripts\local-up.ps1 -Reset   stop and wipe the local database
param([switch]$Demo, [switch]$Reset)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker Desktop (with Compose) is required: https://www.docker.com/products/docker-desktop/"; exit 1 }
if ($Reset) { docker compose down -v; Write-Host "Stopped and wiped the local database."; exit 0 }

function Rand($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
function Get-Var($k) { $l = Get-Content .env | Where-Object { $_ -match "^$k=" } | Select-Object -First 1; if ($l) { $l.Substring($k.Length + 1) } else { "" } }
function Set-Var($k, $v) {
  $lines = Get-Content .env
  if ($lines -match "^$k=") { $lines = $lines -replace "^$k=.*", "$k=$v" } else { $lines += "$k=$v" }
  Set-Content -Path .env -Value $lines -Encoding ascii
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Set-Var "SESSION_SECRET" (Rand 48)
  Set-Var "POSTGRES_PASSWORD" (Rand 24)
  Write-Host "Created .env with generated secrets."
}
if (-not (Get-Var "GOOGLE_CLIENT_ID") -or -not (Get-Var "GOOGLE_CLIENT_SECRET")) {
  Write-Host "`nGoogle sign-in needs an OAuth client (README > First-time setup > Google sign-in)."
  Write-Host "Authorized redirect URI to register: http://localhost:8080/auth/google/callback"
  Set-Var "GOOGLE_CLIENT_ID" (Read-Host "Google OAuth client ID")
  Set-Var "GOOGLE_CLIENT_SECRET" (Read-Host "Google OAuth client secret")
}

Write-Host "Building and starting Tradelog (the first build takes a few minutes)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host -NoNewline "Waiting for the API"
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:8080/api/health -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Write-Host -NoNewline "."; Start-Sleep 2 }
}
Write-Host ""
if (-not $ok) { Write-Host "Tradelog didn't come up. See: docker compose logs api"; exit 1 }

if ($Demo) {
  docker compose exec -T api npx tsx scripts/seed-demo.ts ../../packages/core/test/fixtures/sample-month.xml
  Write-Host "Loaded sample trades (Sep 21 to Oct 20, 2026). Wipe them before real use: .\scripts\local-up.ps1 -Reset"
}
Write-Host "`nTradelog is ready: http://localhost:8080"
Write-Host "Sign in with santosh.krishna0909@gmail.com or mailanilkumar@gmail.com."
Write-Host "Logs: docker compose logs -f api worker    Stop: docker compose down"
