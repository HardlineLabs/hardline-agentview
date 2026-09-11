[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory)
$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$statePath = Join-Path $installRoot 'current.json'
if (Test-Path -LiteralPath (Join-Path $installRoot 'updating.lock')) { exit 0 }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$hostExecutable = [IO.Path]::GetFullPath((Join-Path $installRoot $state.executable))
if (-not $hostExecutable.StartsWith($installRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $hostExecutable)) { throw 'Installed host path is invalid.' }
# The interactive user session is required for browser and native computer use.
# Successful Quit is intentional. Unexpected exits restart with bounded backoff.
for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (Test-Path -LiteralPath (Join-Path $installRoot 'updating.lock')) { exit 0 }
    $existing = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $hostExecutable -and $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -notlike '*runtime.cjs*' } | Select-Object -First 1
    $process = if ($existing) { Get-Process -Id $existing.ProcessId } else { Start-Process -FilePath $hostExecutable -ArgumentList @('--role=host', '--hidden') -WindowStyle Hidden -PassThru }
    $process.WaitForExit()
    if ($process.ExitCode -eq 0) { exit 0 }
    $dataRoot = if ($env:AGENTVIEW_DATA_DIR) { $env:AGENTVIEW_DATA_DIR } else { Join-Path $env:APPDATA 'Hardline AgentView Host' }
    try {
        $health = Get-Content -Raw -LiteralPath (Join-Path $dataRoot 'health.json') | ConvertFrom-Json
        if ($health.pid -eq $process.Id -and $health.intentionalQuit) { exit 0 }
    } catch { }
    Start-Sleep -Seconds ([Math]::Min(60, 3 * ($attempt + 1)))
}
throw 'Host repeatedly failed. Use install-host.ps1 to restore a validated version.'
