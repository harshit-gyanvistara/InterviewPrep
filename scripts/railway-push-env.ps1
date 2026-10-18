# Copies secrets from local env files to the Railway services without printing them.
# core <- .env.local, liveagent <- liveAgent/.env. Empty values are skipped.
# LIVE_AGENT_URL and AUTH_MODE are never copied: staging sets its own.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Push-Env($service, $file, $keys) {
  $lines = Get-Content $file
  $setArgs = @()
  foreach ($key in $keys) {
    $line = $lines | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
    $value = if ($line) { ($line -replace "^$key=", "").Trim().Trim('"') } else { "" }
    if ($value) { $setArgs += @("--set", "$key=$value"); Write-Host "${service}: $key" }
    else { Write-Host "${service}: $key (empty, skipped)" }
  }
  if ($setArgs.Count -gt 0) { railway variables --service $service @setArgs | Out-Null }
}

Push-Env "liveagent" "liveAgent/.env" @("GEMINI_API_KEY", "LIVE_AGENT_TOKEN")
Push-Env "core" ".env.local" @("LIVE_AGENT_TOKEN", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "AUTH_GOOGLE")
Write-Host "Done. Railway redeploys each service that changed."
