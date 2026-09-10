# Android

AgentView for Android shares the Windows client's React interface, graph and
versioned workspace protocol. The native shell bundles all interface assets.
It uses OkHttp for pinned LAN TLS and publicly validated remote TLS, and Android
Keystore to encrypt its saved device credential. Backups and release WebView
debugging are disabled. Camera access is requested only when scanning a pairing
invitation; no camera image is sent to a server.

Chat occupies the phone screen. The drawer contains conversations, project and
category filters, archived chats, account limits and settings. The compact live
activity strip opens the interactive brain; the back button returns to chat.
The brain supports dragging, panning, pinch zoom, note inspection, attachments,
agent selection and the live activity drawer. Drafts survive switching chats and
views in the current app session. They are not persisted to disk.

## Build and validate

Use Node.js 24, JDK 21, Android SDK platform 36 and the checked-in Gradle wrapper.
Set `JAVA_HOME` and `ANDROID_HOME` for your installation.

```powershell
npm ci
npm run check
npm run android:debug
```

On Linux, run `npm run android:sync`, then
`bash android/gradlew -p android assembleDebug lintRelease`. CI checks both Windows
and Android. Debug builds enable WebView inspection and keep the screen awake
while visible. Release builds enable neither behavior.

For a connected test device, inspect `adb devices -l`, then explicitly select it:

```powershell
$env:AGENTVIEW_ANDROID_SERIAL = '<device serial>'
node scripts/mobile-smoke.mjs
```

The smoke test installs the debug APK, resets only AgentView's saved connection,
pairs with an isolated live host on port 43123, checks chat history, context usage,
draft retention, graph pixels and navigation. It writes temporary screenshots in
`.local/mobile-smoke`. ADB forwarding is used only to inspect the debug WebView;
the app's workspace traffic uses its actual network. The phone must be unlocked.

For remote validation set `AGENTVIEW_TEST_REMOTE` to a WSS endpoint and optionally
`AGENTVIEW_TEST_TUNNEL` to its local tunnel configuration. Point that test tunnel
at port 43123 with the test host's `host-cert.pem` as its CA pool and `localhost`
as origin server name. The test makes only the LAN address unreachable, verifies
the public route and checks secure-storage recovery after reloading the app.
It does not change the phone's Wi-Fi settings or simulate a cellular carrier.

## Signed releases

From PowerShell 7, run `./scripts/android-release.ps1`. The first run creates a
private signing identity in `%APPDATA%/Hardline Labs/Signing/AgentView`; subsequent
runs reuse it. The password is protected with Windows DPAPI for the current user.
Preserve the signing directory and an appropriate protected backup: Android
updates must use the same certificate. Never commit signing files or passwords.
The script checks the web build, native build and release lint before copying the
signed APK into `out/android/AgentView-<version>.apk`.

Other build machines can supply `AGENTVIEW_KEYSTORE`, `AGENTVIEW_STORE_PASSWORD`,
`AGENTVIEW_KEY_ALIAS`, and `AGENTVIEW_KEY_PASSWORD` through their secure environment,
then run the native `assembleRelease` and `lintRelease` tasks after Android sync.
No signing material is included in GitHub source. GitHub releases remain private.

Uninstall a debug build before installing the release APK if they have different
signing certificates. This removes only that app's local pairing; create a fresh
invitation afterward. Normal release-to-release updates retain pairing.
