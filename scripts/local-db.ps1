param([ValidateSet('Start', 'Stop', 'Test')][string]$Action = 'Test')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pgDirectory = Join-Path $projectRoot '.cache/postgres'
$pgCtl = Join-Path $pgDirectory 'pgsql/bin/pg_ctl.exe'
if (!(Test-Path -LiteralPath $pgCtl)) { throw 'Local PostgreSQL binaries are not prepared.' }
Push-Location $projectRoot
try {
    if ($Action -eq 'Stop') {
        & $pgCtl -D .cache/postgres/data -m fast -w stop
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL stop failed.' }
    } elseif ($Action -eq 'Start') {
        & $pgCtl -D .cache/postgres/data status
        if ($LASTEXITCODE -ne 0) {
            $pgProcess = Start-Process -FilePath $pgCtl -ArgumentList '-D .cache/postgres/data -l .cache/postgres/server.log -o "-h 127.0.0.1 -p 15432" -w start' -WindowStyle Hidden -PassThru
            $pgProcess.WaitForExit()
            if ($pgProcess.ExitCode -ne 0) { throw 'PostgreSQL start failed; inspect .cache/postgres/server.log.' }
        }
    } else {
        $connection = Get-Content -LiteralPath (Join-Path $pgDirectory 'connection.json') -Raw | ConvertFrom-Json
        $previousDatabaseUrl = $env:DATABASE_URL
        $previousTestDatabaseUrl = $env:TEST_DATABASE_URL
        try {
            $env:DATABASE_URL = $connection.url
            $env:TEST_DATABASE_URL = $connection.url
            & npx.cmd prisma migrate deploy
            if ($LASTEXITCODE -ne 0) { throw 'Migration failed.' }
            & npm.cmd run test:db
            if ($LASTEXITCODE -ne 0) { throw 'Database tests failed.' }
        } finally {
            $env:DATABASE_URL = $previousDatabaseUrl
            $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
        }
    }
} finally { Pop-Location }
