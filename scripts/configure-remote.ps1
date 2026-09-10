param(
    [Parameter(Mandatory = $true)][string]$Hostname,
    [string]$TunnelName = 'agentview',
    [string]$HostDataDir = (Join-Path $env:APPDATA 'Hardline AgentView Host'),
    [int]$Port = 43120
)
$ErrorActionPreference = 'Stop'
if ($Hostname -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$') { throw 'Supply a DNS hostname in a zone you own.' }
if ($TunnelName -notmatch '^[a-zA-Z0-9-]+$') { throw 'Use letters, numbers and hyphens for the tunnel name.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid host port.' }
$cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
$HostDataDir = [IO.Path]::GetFullPath($HostDataDir)
$certificate = Join-Path $HostDataDir 'host-cert.pem'
if (-not (Test-Path -LiteralPath $certificate)) { throw 'Start AgentView Host 0.3 or later once before configuring remote access.' }
$setupConfig = Join-Path $HostDataDir 'tunnel-setup.json'
'{}' | Set-Content -LiteralPath $setupConfig -Encoding utf8
try {
$tunnels = & $cloudflared tunnel --config $setupConfig list --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Sign in with cloudflared tunnel login, then retry.' }
$tunnel = $tunnels | Where-Object name -eq $TunnelName | Select-Object -First 1
if (-not $tunnel) {
    & $cloudflared tunnel --config $setupConfig create $TunnelName
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel creation failed.' }
    $tunnels = & $cloudflared tunnel --config $setupConfig list --output json | ConvertFrom-Json
    $tunnel = $tunnels | Where-Object name -eq $TunnelName | Select-Object -First 1
}
if (-not $tunnel) { throw 'Tunnel was not found.' }
$credential = Join-Path $env:USERPROFILE ('.cloudflared/' + $tunnel.id + '.json')
if (-not (Test-Path -LiteralPath $credential)) { throw 'This computer does not hold the tunnel credential.' }
& $cloudflared tunnel --config $setupConfig route dns $tunnel.id $Hostname
if ($LASTEXITCODE -ne 0) { throw 'DNS routing failed. An existing record may need review.' }
$configPath = Join-Path $HostDataDir 'tunnel.yml'
# JSON is valid YAML; serialization safely quotes Windows paths and user input.
$config = @{
    tunnel = $tunnel.id
    'credentials-file' = $credential
    ingress = @(
        @{ hostname = $Hostname; service = "https://127.0.0.1:$Port"; originRequest = @{ originServerName = 'localhost'; caPool = $certificate } },
        @{ service = 'http_status:404' }
    )
}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8
$settingsPath = Join-Path $HostDataDir 'settings.json'
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json -AsHashtable
$settings.remoteAddress = "wss://$Hostname/"
$settings.tunnelConfig = $configPath
$settings.cloudflaredPath = $cloudflared
$settings | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding utf8
Write-Output "Configured $Hostname. Restart AgentView Host to start its tunnel, then create new device invitations."
} finally { Remove-Item -LiteralPath $setupConfig -Force -ErrorAction SilentlyContinue }
