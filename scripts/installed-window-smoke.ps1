[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$installRoot = (Resolve-Path -LiteralPath $InstallDirectory).Path
$state = Get-Content -Raw -LiteralPath (Join-Path $installRoot 'current.json') | ConvertFrom-Json
$dataRoot = if ($env:AGENTVIEW_DATA_DIR) { $env:AGENTVIEW_DATA_DIR } else { Join-Path $env:APPDATA 'Hardline AgentView Host' }
$health = Get-Content -Raw -LiteralPath (Join-Path $dataRoot 'health.json') | ConvertFrom-Json
$expected = [IO.Path]::GetFullPath((Join-Path $installRoot $state.executable))
$running = Get-Process -Id $health.pid
if ($running.Path -ne $expected -or $state.version -ne $health.version) { throw 'The current installed Host is not running.' }
if ($running.MainWindowHandle -ne 0) { throw 'Run this check immediately after managed installation, before opening the hidden Host.' }
$clock = [Diagnostics.Stopwatch]::StartNew()
# This is an explicit user window open, not a background helper launch.
Start-Process -FilePath (Join-Path $installRoot 'AgentView Host.exe') -WindowStyle Normal
do {
    Start-Sleep -Milliseconds 50
    $running = Get-Process -Id $health.pid
    $running.Refresh()
} while ($running.MainWindowHandle -eq 0 -and $clock.ElapsedMilliseconds -lt 4000)
if ($running.MainWindowHandle -eq 0 -or -not $running.Responding) { throw 'The first user open did not produce a responsive native window within four seconds.' }
Write-Output "Installed Host $($health.version): first window open in $($clock.ElapsedMilliseconds) ms, same network process."
