# AgentView on iPhone and the web

The PWA shares AgentView's React interface, graph and encrypted workspace protocol
with the Android and Windows clients. Its static deployment delivers application
files. Each phone pairs with its own Windows host; that host retains its vault,
repositories, agent sign-in and execution. There is no shared hosted agent account.

## Install and pair

1. Open [app.hardline-labs.com](https://app.hardline-labs.com) in Safari on iPhone.
2. Open Share (sometimes under the ••• menu), select **Add to Home Screen**, keep
   **Open as Web App** enabled if shown, and tap **Add**.
3. Open AgentView from its new icon before pairing. Browser tabs and installed apps
   may have separate storage on iOS.
4. On your computer, run AgentView Host 0.3.1 or later, select your vault and
   configure [Remote access](remote-access.md). Choose **Pair device**.
5. In the PWA, scan the invitation or paste it and choose **Connect to workspace**.
   Camera frames are decoded on the phone and never uploaded.

The same site works on Android and desktop browsers. Supporting browsers offer an
**Install app** prompt. No App Store account or native client reinstall is needed.

## Connection and device storage

The PWA uses the host's publicly trusted WSS endpoint, even on the same Wi-Fi.
Browser JavaScript cannot implement native certificate pinning for AgentView's
self-signed LAN certificate. It never disables certificate verification. Each
person must configure their own reachable endpoint; serving the PWA does not
automatically provision remote access for a new computer.

Pairing retains the existing per-device proof and end-to-end encryption. The host
can revoke one phone without affecting other devices. Every paired device has full
access to that host's workspace.

Saved pairing is encrypted in IndexedDB with a non-exportable Web Crypto key.
This is browser-origin protection, not Android Keystore or an iOS Keychain promise:
code running on the app's origin can use that key. Use a trusted device. Clearing
website data removes pairing; create a fresh invitation afterward. **Disconnect &
change host** clears this browser's saved pairing and in-memory drafts. Remove the
old device from Host as well if you want to revoke its credential.

Workspace snapshots and conversations are not saved in the service-worker cache.
Only the app shell, fonts and icons are cached. An offline shell cannot read live
workspace content or run an agent. Returning to the app reconnects and refreshes
the workspace; running work continues on the computer while the phone is away.
Background push notifications are not included.

## Updates

The app checks for updates when opened, returned to the foreground, brought online
and periodically while visible. **Update & reload** first saves an encrypted,
short-lived copy of the current text drafts and selected conversation, then loads
the complete new build. Restoration is bound to the paired host, consumed once,
and expires after ten minutes. Ordinary reloads do not persist drafts. Finish a
pending request before updating. UI-only releases need no host update; changes to
host capabilities still require a compatible host release.

## Build and validate

```powershell
npm ci
npm run check
npm run pwa:build
npx playwright install chromium webkit
npm run pwa:smoke
```

`npm run pwa:dev` serves the browser target locally. `pwa:build` emits only public
client assets into `dist/client`, including a content-versioned service worker and
install icons. `.openai/hosting.json` identifies the dedicated static Sites project.
Publish that exact validated output through Sites; source remains in this private
repository. Never copy host settings, pairing invitations or tunnel credentials
into the web output. Browser-origin storage depends on keeping the deployment URL
stable; changing origins requires pairing again.

The smoke check uses ephemeral vaults and actual host TLS/encrypted WebSockets;
only the agent runtime is a deterministic fixture. Its certificate exemption is
restricted to the local fixture, never production. Chromium and WebKit checks
cover pairing, host separation, graph/chat interaction, reconnect, saved-device
recovery and revocation. Chromium additionally exercises camera-frame QR decoding,
offline shell and update/draft recovery. These do not establish physical iPhone
camera, keyboard, installation or cellular behavior; verify those on an iPhone.

For a public-path check, install `cloudflared`, set `AGENTVIEW_PWA_URL` to the
published HTTPS client and run `npm run pwa:remote-smoke`. This starts a temporary
Cloudflare quick tunnel to an isolated synthetic vault, validates the origin with
its generated CA certificate, and checks both browsers with normal public TLS
validation. It closes the tunnel and removes the fixture afterward. It does not
use the developer's running host, vault or agent account.
