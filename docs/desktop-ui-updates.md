# Desktop UI updates

Windows Client 0.4.4-dev.2 introduces **Update UI** in the title bar. Clicking it
downloads the published desktop interface, verifies it, saves the current drafts,
attachment references and selected conversation, then reloads the interface.
The native connection process and Host execution keep running. The PWA and Host
window do not use this updater. An update failure leaves the existing UI usable.

The first installation requires the new AgentView.exe. Later compatible UI changes
need only a UI publication. Electron, preload/native bridge, networking and native
storage changes still require a new executable. The button tooltip shows separate
UI and desktop versions. There is no automatic download or forced update.

## Build and publish

Run the product checks and native UI validation, then commit the source on a
feature branch and integrate into develop. No GitHub release or main promotion is
needed for an explicitly approved UI-feed publication. Choose a new UI version
for every publication; an example is `2026.09.17.1`.

```powershell
npm ci
npm run check
npm run desktop:smoke
$env:AGENTVIEW_UI_SIGNING_KEY = 'C:\secure-location\agentview-ui-signing.pem'
npm run ui:bundle -- 2026.09.17.1
```

The builder requires clean committed source and the private Ed25519 key matching
`src/shared/ui-update.ts`. It emits `artifacts/ui-updates/<version>/`: a signed
`latest.json`, a SHA-256-named compressed bundle, and a local publication record
with the source commit. Preserve these artifacts for reproduction and rollback;
the publication record is not served to clients. Private keys must remain outside
repositories, web roots and delivered packages, with access restricted to the
publishing account. Back up the key through your normal secure key backup process.

For an entirely new distribution, `node scripts/ui-update-key.mjs <absolute-path>`
creates a new external key without overwriting an existing one and prints only its
public key. Changing the pinned key requires a new executable and a matching
website publisher configuration; do not regenerate it for routine UI updates.

In the Hardline website checkout, use its documented
`npm run agentview:publish-ui -- <absolute-artifact-directory>` command.
It verifies the signature and bytes, retains the previous published bundle, and
deploys only the desktop update route. Clients read
`https://hardline-labs.com/updates/agentview/desktop/latest.json`.
Uploading or merging source alone does not publish an update.

## Verification and recovery

`npm run check` covers invalid signatures, incompatible bridges, path rejection,
corrupt/oversized downloads, staged activation, offline restart, tampered caches,
interrupted startup and rollback. For the real native update flow:

```powershell
$env:AGENTVIEW_UI_TEST_ARTIFACT = 'C:\path\to\signed\ui-artifact'
npm run ui:smoke
# Repeat against the packaged native application:
$env:AGENTVIEW_PACKAGED_CLIENT = 'out\client\win-unpacked\AgentView.exe'
npm run ui:smoke
```

These checks use isolated settings and a synthetic TLS Host. They inject the test
download response into the test process; production signature verification is
still exercised, without adding a configurable trust bypass to the shipped app.
They verify that the native process stays alive, pairing and drafts/attachments
survive, the UI can restart offline, and network failure remains recoverable.

Bundles contain only renderer HTML, JavaScript, CSS, fonts and images. The shell
checks the pinned Ed25519 signature, SHA-256, byte limits and exact bridge version
before extracting into a version-specific user-data directory. IPC calls are
accepted only from the current main frame. The signed manifest is not an authority
to overwrite native files. Cached files are reverified on startup.

Activation atomically records a pending version and retains the previous working
version. The new React interface must acknowledge startup within 20 seconds;
otherwise the shell reloads the previous UI. Exiting during activation also rolls
back on next launch. If neither cached version verifies, the executable's bundled
interface is used. This detects startup failures, not every possible UI regression.
For a functional regression, fix or revert the source and publish a newly signed
UI version with a later timestamp. Clients reject older publication timestamps.

Package only the Windows Client with `npm run package:client`. Packaging does not
publish the website or create a GitHub release.
