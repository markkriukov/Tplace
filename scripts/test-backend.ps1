# Backend tests against a disposable PostgreSQL: starts it, applies migrations and runs
# the Node and Python suites with the database required, so nothing is silently skipped.
#   .\scripts\test-backend.ps1                 full run, removes the database afterwards
#   .\scripts\test-backend.ps1 -KeepDatabase   keeps it running for reruns of single tests
param([switch]$KeepDatabase)

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker-compose.test.yml'
$testDatabaseUrl = 'postgresql://tplace:tplace@127.0.0.1:55432/tplace_test'
$python = Join-Path $root 'backend\python-worker\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

# Variables set here would outlive the script in the calling session.
$variables = 'TEST_DATABASE_URL', 'REQUIRE_TEST_DATABASE', 'DATABASE_URL'
$saved = @{}
foreach ($name in $variables) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$failed = @()

try {
    docker compose -f $compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'Test database did not start' }

    $env:TEST_DATABASE_URL = $testDatabaseUrl
    $env:REQUIRE_TEST_DATABASE = '1'
    # The migration target; it also keeps every step of this run off the working database.
    $env:DATABASE_URL = $testDatabaseUrl

    Push-Location (Join-Path $root 'backend\node')
    try {
        npm run db:migrate
        if ($LASTEXITCODE -ne 0) { throw 'Migrations failed' }
        npm test
        if ($LASTEXITCODE -ne 0) { $failed += 'Node' }
    } finally { Pop-Location }

    Push-Location (Join-Path $root 'backend\python-worker')
    try {
        & $python -m unittest discover -s tests
        if ($LASTEXITCODE -ne 0) { $failed += 'Python' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    if (-not $KeepDatabase) { docker compose -f $compose down }
}

if ($failed.Count) {
    Write-Host "Failed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host 'All backend tests passed' -ForegroundColor Green
