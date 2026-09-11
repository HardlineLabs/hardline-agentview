[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackageDirectory,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$')][string]$Version,
    [switch]$RegisterStartup,
    [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $PackageDirectory).Path
$installRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$versionRoot = [IO.Path]::GetFullPath((Join-Path $installRoot "versions\$Version"))
function Assert-InstalledPath([string]$Target) {
    if (-not $Target.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation target.' }
}
Assert-InstalledPath $versionRoot
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'resources\app.asar')) -or -not (Test-Path -LiteralPath (Join-Path $sourceRoot 'AgentView Host.exe'))) { throw 'Use the validated out/host/win-unpacked directory.' }
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if ($Elevated -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer once from an administrator PowerShell to enable elevated startup. Full Access does not grant Windows elevation.' }
$taskName = 'Hardline AgentView Host'
$launcher = Join-Path $installRoot 'start-host.ps1'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and ($existingTask.Actions.Arguments -notlike "*$launcher*")) { throw 'An unrelated task uses the AgentView startup name.' }
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
if (Test-Path -LiteralPath $versionRoot) {
    foreach ($relative in @('resources\app.asar', 'resources\app.asar.unpacked\dist\electron\runtime.cjs', 'AgentView Host.exe')) {
        if ((Get-FileHash -LiteralPath (Join-Path $versionRoot $relative)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $sourceRoot $relative)).Hash) { throw 'This version already contains a different build. Choose a new release version.' }
    }
} else {
    New-Item -ItemType Directory -Path $versionRoot | Out-Null
    Get-ChildItem -LiteralPath $sourceRoot | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $versionRoot -Recurse }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-host.ps1') -Destination $launcher -Force
$pointerPath = Join-Path $installRoot 'current.json'
$previous = if (Test-Path -LiteralPath $pointerPath) { Get-Content -Raw -LiteralPath $pointerPath } else { $null }
# Preserve the portable executable for the first managed installation's rollback.
if (-not $previous -and (Test-Path -LiteralPath (Join-Path $installRoot 'AgentView Host.exe'))) {
    $previous = @{ executable = 'AgentView Host.exe'; version = 'legacy' } | ConvertTo-Json
}
function Stop-InstalledHost {
    $all = @(Get-CimInstance Win32_Process)
    $roots = @($all | Where-Object { $_.Name -eq 'AgentView Host.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -notlike '*runtime.cjs*' -and $_.CommandLine -notlike '*--type=*' })
    $ids = [Collections.Generic.HashSet[uint32]]::new()
    foreach ($root in $roots) { [void]$ids.Add($root.ProcessId) }
    do {
        $added = $false
        foreach ($child in $all) {
            # Excluding the worker also excludes all its agent/tool descendants.
            if ($ids.Contains($child.ParentProcessId) -and $child.CommandLine -notlike '*runtime.cjs*' -and $ids.Add($child.ProcessId)) { $added = $true }
        }
    } while ($added)
    foreach ($processId in $ids) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}
$dataRoot = if ($env:AGENTVIEW_DATA_DIR) { $env:AGENTVIEW_DATA_DIR } else { Join-Path $env:APPDATA 'Hardline AgentView Host' }
$healthPath = Join-Path $dataRoot 'health.json'
$settingsPath = Join-Path $dataRoot 'settings.json'
$previousSettings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -Raw -LiteralPath $settingsPath } else { $null }
$lockPath = Join-Path $installRoot 'updating.lock'
Set-Content -LiteralPath $lockPath -Value $Version
try {
    if ($existingTask) { Stop-ScheduledTask -TaskName $taskName }
    Stop-InstalledHost
    if ($RegisterStartup -and $previousSettings) {
        # The managed task owns startup; avoid a second version-specific login entry.
        $managedSettings = $previousSettings | ConvertFrom-Json
        $managedSettings.autoStart = $false
        [IO.File]::WriteAllText($settingsPath, ($managedSettings | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    }
    $relativeExe = "versions\$Version\AgentView Host.exe"
    @{ version = $Version; executable = $relativeExe; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath ($pointerPath + '.next') -Encoding UTF8
    Move-Item -LiteralPath ($pointerPath + '.next') -Destination $pointerPath -Force
    $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    # Host owns hidden startup. Windows SW_HIDE can suppress the first explicit window open.
    $started = Start-Process -FilePath (Join-Path $installRoot $relativeExe) -ArgumentList @('--role=host', '--hidden') -WindowStyle Normal -PassThru
    $healthy = $false
    for ($check = 0; $check -lt 30; $check++) {
        Start-Sleep -Seconds 2
        $started.Refresh()
        if ($started.HasExited) { break }
        try {
            $health = Get-Content -Raw -LiteralPath $healthPath | ConvertFrom-Json
            if ($health.pid -eq $started.Id -and $health.version -eq $Version -and $health.checkedAt -ge $startedAt -and $health.running -and $health.agentReady) { $healthy = $true; break }
        } catch { }
    }
    if (-not $healthy) { throw 'New host failed its health check.' }
} catch {
    $failure = $_
    Stop-InstalledHost
    if ($previousSettings) { [IO.File]::WriteAllText($settingsPath, $previousSettings, [Text.UTF8Encoding]::new($false)) }
    if ($previous) {
        $previous | Set-Content -LiteralPath $pointerPath -Encoding UTF8
        $oldExe = [IO.Path]::GetFullPath((Join-Path $installRoot ($previous | ConvertFrom-Json).executable))
        Assert-InstalledPath $oldExe
        Start-Process -FilePath $oldExe -ArgumentList @('--role=host', '--hidden') -WindowStyle Normal
    } else { Remove-Item -LiteralPath $pointerPath -Force -ErrorAction SilentlyContinue }
    throw "$failure Previous host restored when available."
} finally {
    Remove-Item -LiteralPath $lockPath -Force
    if ($existingTask) { Start-ScheduledTask -TaskName $taskName }
}
if ($RegisterStartup) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -InstallDirectory "' + $installRoot + '"'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $runLevel = if ($Elevated) { 'Highest' } else { 'Limited' }
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel $runLevel
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $taskPrincipal -Trigger $trigger -Settings $taskSettings -Description 'Start AgentView in its signed-in Windows session and recover unexpected exits.' -Force | Out-Null
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $runName = 'labs.hardline.agentview.host'
    $legacy = $null
    # A previous managed install has already removed this optional legacy value.
    try { $legacy = Get-ItemPropertyValue -LiteralPath $runKey -Name $runName -ErrorAction Stop } catch { }
    if ($legacy -and $legacy.StartsWith('"' + $installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-ItemProperty -LiteralPath $runKey -Name $runName }
    Start-ScheduledTask -TaskName $taskName
}
# Keep the visible entry point on the same validated version as managed startup.
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $installRoot 'AgentView Host.lnk'))
$shortcut.TargetPath = Join-Path $installRoot $relativeExe
$shortcut.Arguments = '--role=host'
$shortcut.WorkingDirectory = $installRoot
$shortcut.Description = 'Open the current AgentView Host'
$shortcut.Save()
$fastLauncher = Join-Path $sourceRoot 'resources\host-launcher.exe'
if (Test-Path -LiteralPath $fastLauncher) {
    # Keep the familiar .exe fast as well as the shortcut; current.json selects the version.
    Copy-Item -LiteralPath $fastLauncher -Destination (Join-Path $installRoot 'AgentView Host.exe') -Force
}
Write-Output "AgentView Host $Version is healthy. Installation: $installRoot"
