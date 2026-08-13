param(
  [string]$Repository = 'https://github.com/ganlingyao/cindy-headless-dev.git',
  [string]$Branch = 'feat/cindy-headless-127'
)
$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) "cindy-headless-clean-$([guid]::NewGuid().ToString('N'))"
try {
  git clone --depth 1 --branch $Branch $Repository $root
  if ($LASTEXITCODE -ne 0) { throw 'Clean clone failed' }
  Push-Location $root
  try {
    pnpm install --frozen-lockfile
    npm --prefix apps/cindy-headless run typecheck
    npm --prefix apps/cindy-headless test -- --run
    npm --prefix apps/cindy-headless run build
    npm --prefix apps/cindy-headless run test:distribution
  } finally { Pop-Location }
  Write-Host 'PASS clean clone verification'
} finally {
  if (Test-Path -LiteralPath $root) {
    Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $_.IsReadOnly = $false }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
      try { [System.IO.Directory]::Delete($root, $true); break } catch { if ($attempt -eq 2) { Write-Warning "Could not remove clean-test directory: $root" } else { Start-Sleep -Seconds 1 } }
    }
  }
}
