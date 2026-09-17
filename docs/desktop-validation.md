# Windows client validation

Run `npm run check`, `npm run pwa:build`, and `npm run pwa:smoke` for the shared
UI and protocol. The browser suite covers long history, streaming, graph energy,
station dragging, composer behavior, attachments, queue and recovery in Chromium
and WebKit. No signed-in agent account or personal vault is used.

`npm run desktop:smoke` launches the real Electron client against an isolated TLS
Host with a deterministic runtime. It checks pairing, native window controls,
encrypted drafts and attachment restoration after process restart, image sending,
auto-approval and renderer reload, workspace tools, notification preferences and
host-switch isolation. Temporary Host and client data are removed on exit.

Run `npm run package` to build both Windows applications. Repeat the native check
against the packaged client:

```powershell
$env:AGENTVIEW_PACKAGED_CLIENT = 'out/client/win-unpacked/AgentView.exe'
npm run desktop:smoke
Remove-Item Env:AGENTVIEW_PACKAGED_CLIENT
node scripts/package-smoke.mjs
node scripts/window-smoke.mjs
```

The client screenshot is written under ignored `artifacts/desktop-parity/` for
visual review. Tests never replace the installed Host or its execution worker.
Windows notifications depend on OS notification settings; the automated test
checks opt-in persistence and controls, not delivery through Windows Focus Assist.

For release downloads, `python scripts/release-assets.py` assembles both portable
executables, the managed Host and web archives, and SHA-256 checksums after the
package and PWA builds. It writes only under `artifacts/release-<version>`.

The manual **Stage release downloads** workflow can assemble and upload from a
successful **Product checks** run's `windows-desktop` artifact. Supply its run ID
and an existing draft release tag. The workflow requires the tested source tree
to match the draft's target and its version, then verifies uploaded digests. This
keeps large uploads on GitHub's network; publication remains an explicit step.
