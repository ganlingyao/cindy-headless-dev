param(
  [ValidateSet('claude', 'codex')][string]$Backend = 'codex',
  [string]$Config,
  [string]$JobName = "cindy-headless-harbor-smoke-$(Get-Date -Format yyyyMMdd-HHmmss)"
)

$ErrorActionPreference = 'Stop'
$sourceRootCandidate = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$distributionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = if (Test-Path (Join-Path $sourceRootCandidate 'apps\cindy-headless')) { $sourceRootCandidate } else { $distributionRoot }
$localConfig = if (Test-Path (Join-Path $repoRoot 'apps\cindy-headless')) { Join-Path $repoRoot 'apps\cindy-headless\config.local.json' } else { Join-Path $repoRoot 'config.local.json' }
if ((-not $env:CINDY_HEADLESS_API_KEY -or -not $env:CINDY_HEADLESS_BASE_URL) -and (Test-Path -LiteralPath $localConfig)) {
  $gateway = (Get-Content -Raw -LiteralPath $localConfig | ConvertFrom-Json).gateway
  if (-not $env:CINDY_HEADLESS_API_KEY) { $env:CINDY_HEADLESS_API_KEY = $gateway.apiKey }
  if (-not $env:CINDY_HEADLESS_BASE_URL) { $env:CINDY_HEADLESS_BASE_URL = $gateway.baseUrl }
}
if (-not $env:CINDY_HEADLESS_API_KEY) { $env:CINDY_HEADLESS_API_KEY = $env:ANTHROPIC_API_KEY }
if (-not $env:CINDY_HEADLESS_BASE_URL) { $env:CINDY_HEADLESS_BASE_URL = $env:ANTHROPIC_BASE_URL }
if (-not $env:CINDY_HEADLESS_API_KEY) { throw 'A gateway API key is required via config.local.json or environment variables' }
if (-not $env:CINDY_HEADLESS_BASE_URL) { throw 'A gateway base URL is required via config.local.json or environment variables' }
$env:PYTHONPATH = $repoRoot
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$harbor = if ($env:HARBOR_BIN) { $env:HARBOR_BIN } else { 'D:\Tools\Harbor\bin\harbor.exe' }
if (-not (Get-Command $harbor -ErrorAction SilentlyContinue)) { throw 'Harbor 0.20 is required; set HARBOR_BIN when it is not on PATH' }
if (-not $Config) {
  $generated = & node (Join-Path $PSScriptRoot 'generate-smoke-config.mjs') --backend $Backend --run-id $JobName | ConvertFrom-Json
  $Config = $generated.output
}
& $harbor run --config $Config --job-name $JobName --yes --quiet
if ($LASTEXITCODE -ne 0) { throw "Harbor exited with code $LASTEXITCODE" }
$jobDir = Join-Path $repoRoot ".cindy-headless\jobs\$JobName"
$results = Join-Path $jobDir 'collected-results.json'
& python (Join-Path $PSScriptRoot 'collect_results.py') $jobDir $results
if ($LASTEXITCODE -ne 0) { throw 'Result collection failed' }
Write-Host "PASS Harbor smoke: $jobDir"
