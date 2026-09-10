param([string]$SigningDirectory = (Join-Path $env:APPDATA 'Hardline Labs/Signing/AgentView'))
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This signing helper uses Windows protected storage. See docs/android.md for CI signing.' }
if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to JDK 21.' }
New-Item -ItemType Directory -Force -Path $SigningDirectory | Out-Null
$metadata = Join-Path $SigningDirectory 'signing.json'
$keyStore = Join-Path $SigningDirectory 'release.p12'
if (-not (Test-Path -LiteralPath $metadata)) {
    if (Test-Path -LiteralPath $keyStore) { throw 'Existing signing key found without its protected metadata. Restore the metadata before continuing.' }
    $passwordBytes = [byte[]]::new(32)
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
    $password = [Convert]::ToBase64String($passwordBytes)
    $env:AGENTVIEW_STORE_PASSWORD = $password
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $keyStore -storetype PKCS12 -alias agentview -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Hardline Labs AgentView, O=Hardline Labs' -storepass:env AGENTVIEW_STORE_PASSWORD -keypass:env AGENTVIEW_STORE_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Signing key creation failed.' }
    @{ password = (ConvertTo-SecureString $password -AsPlainText -Force | ConvertFrom-SecureString) } | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding utf8
}
try {
    $protected = Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json
    $securePassword = ConvertTo-SecureString $protected.password
    $env:AGENTVIEW_STORE_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
    $env:AGENTVIEW_KEY_PASSWORD = $env:AGENTVIEW_STORE_PASSWORD
    $env:AGENTVIEW_KEYSTORE = $keyStore
    $env:AGENTVIEW_KEY_ALIAS = 'agentview'
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or native sync failed.' }
    & ./android/gradlew.bat -p android assembleRelease lintRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
    $version = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).version
    New-Item -ItemType Directory -Force -Path out/android | Out-Null
    Copy-Item -LiteralPath android/app/build/outputs/apk/release/app-release.apk -Destination "out/android/AgentView-$version.apk"
    Write-Output "Signed Android release: out/android/AgentView-$version.apk"
    Write-Output "Signing identity retained in $SigningDirectory. Preserve this directory for future updates."
} finally {
    Remove-Item Env:AGENTVIEW_STORE_PASSWORD,Env:AGENTVIEW_KEY_PASSWORD,Env:AGENTVIEW_KEYSTORE,Env:AGENTVIEW_KEY_ALIAS -ErrorAction SilentlyContinue
}
