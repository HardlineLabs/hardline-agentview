# Running an autonomous AgentView host

Host 0.4 adds saved permission defaults, an independent execution process and a
managed Windows installation. The iPhone controls are under **Workspace settings**.
Existing pairings and Codex conversations remain in the same Windows user's data.

Host 0.4.1 adds six-digit iPhone pairing. **Pair device** checks the public endpoint
and this host's encrypted identity before issuing a code. Agent readiness alone
does not establish that the network listener or tunnel is reachable. A malformed
or unreadable settings file now reports a startup error instead of silently using
LAN-only defaults; Windows UTF-8 BOM files are accepted.

Host 0.4.2 updates pairing and QR links to `agentviewapp.hardline-labs.com`.
See [the web address migration](pwa.md#address-migration) before replacing an
installed phone PWA. Existing host settings and remote tunnel routes are retained.

## Opening the Host window

Host 0.4.2 preserves the saved connector settings when saving the Host form.
If connector paths are missing, it can recover this Host's existing managed
`tunnel.yml` and installed cloudflared, after checking the endpoint, origin port
and certificate path. It does not create tunnels or alter remote routes.
Open Host and click **Pair device**: pairing waits up to 25 seconds for the
managed connector to register, then verifies the public encrypted Host proof
before publishing a code. Invalid local setup and failed connector startup are
reported in Host; the remote endpoint URL alone does not configure a connector.

The managed installation's **AgentView Host.exe** is a small launcher that reads
`current.json` and opens the installed version directly. **AgentView Host.lnk**
also opens that version. Repeated clicks bring the existing window forward;
they do not unpack the portable distribution again or start another workspace.
The portable download still extracts its bundle when launched, so use the managed
entry points for everyday operation.

One click on the tray icon opens Host. Minimized windows are restored. A missing,
crashed or unresponsive window is recreated on the next open request without
restarting the network service or execution runtime. Hidden startup applies only
to initial launch; an explicit open request always shows the window. Window
display does not wait for the renderer's first paint or agent readiness.
Managed startup lets the app own this hidden state. Applying Windows' separate
hidden-window override can suppress the first user request to reveal the window.

## Permissions and computer use

Choose **Host → Default agent permissions → Full access** for a dedicated agent
computer. This sets Codex's full filesystem/network sandbox policy and `on-request`
approval policy for new conversations and each new turn, including resumed chats.
Routine work can run outside the workspace; actions requiring approval can reach
the configured Codex reviewer instead of being denied because prompts are disabled.
Approval remains manual unless you enable **Auto-approve** in an individual chat.
Full access does not override
explicit forbidden rules or managed restrictions. Before Host 0.4.2-dev.3, Full
access forced `never`; changing Codex's global approval setting or restarting its
runtime did not remove that Host override. Updating Host applies the correction
on the next new turn without restarting the execution worker.
Changing the default does not alter a turn already running. Workspace and Read
only modes remain available. Organization requirements and individual connected
apps can impose their own restrictions.

Host 0.4.3-dev.3 adds **Auto-approve off/on** inside each chat. With Full access
selected, enable it in an AgentView-owned conversation to automatically accept
supported command, file-change and filesystem/network permission requests,
including requests already waiting in that chat. The Host saves the choice per
conversation; it continues with no phone connected and survives Host replacement.
Other chats, new chats, forks and subagent chats keep their own manual default.
Turning it off restores manual approval once Host acknowledges the change; it
cannot undo work already accepted. Archive/restore retains the setting; deletion
removes it. Workspace and Read only pause automation, and returning to Full access
resumes it, including eligible waiting requests. This never changes a running
turn's sandbox or grants permanent command rules.

Questions, MCP forms and sign-in flows still require user input. Unknown requests
and requests whose available decisions exclude acceptance also stay manual.
Host 0.4.4-dev.3 honors explicitly saved Windows Computer Use app access from the
user's Codex configuration. This is separate from per-chat Auto-approve. It applies
only to an app-access prompt from the Computer Use runtime that permits persistent
approval and whose exact app ID has a `true` entry in
`[computer_use.windows.always_allowed_app_ids]`. Use the exact app ID in the
approval request's `tool_params.app`, such as `"mspaint.exe" = true`; this can
differ from the `process:` ID returned when listing windows. The setting is a
TOML table of quoted IDs and booleans, not an array. Manage saved access through the ChatGPT
desktop app's Computer Use settings. Host reads the raw user config layer for each
request, so removing consent applies to the next request without restarting.
Project settings cannot grant consent. Unknown formats, app IDs, questions, audio
capture, action confirmations and requests that disallow persistence stay manual.
The regular **Allow** button remains a one-time answer. This Host-only change
works with existing clients and preserves the running execution worker.

**Recent auto-approvals** shows up to ten decisions for the chat from the Host's
bounded in-memory activity history; it is not a permanent audit log. Install the
Host update and reload the PWA to get the control. The execution worker does not
need a restart, and existing chats remain manual until explicitly enabled.

Host 0.4.3-dev.1 also corrects MCP permission prompts: Allow submits acceptance
and the requested form values, while Decline submits refusal. Earlier versions
cancelled both choices for this prompt type. Install the updated Host as well as
the PWA; the existing execution worker can remain running during this update.

Host 0.4.3-dev.2 keeps older cached turns out of the newest history page. Install
it together with the PWA correction for duplicate pending steering messages.
This update also preserves the existing execution worker.

Full access is separate from Windows administrator rights. Run **Check host
capabilities** to see the actual Host and runtime elevation, Codex home, enabled
features and exposed tools. Availability does not prove every app interaction
will succeed. Native computer use needs a signed-in, unlocked interactive Windows
session and the relevant installed runtime tools. A Windows service in session
zero cannot provide that desktop. AgentView does not disable UAC, change security
software, configure automatic Windows sign-in, solve CAPTCHAs or suppress required
third-party consent.

## Chat history and lifecycle

Host 0.4.4-dev.6 builds history pages in the execution worker, before sending
anything across the worker pipe or the client connection. Pages are capped at
256 KiB of display data and can split inside a single hours-long turn. Opening
loads the latest page; **Earlier messages** requests its predecessor using an
opaque item cursor. The worker requests item-sized original data from the local
app-server and turn metadata without contents; it never requests whole turns for
history. Older runtimes without item pagination report an error instead of falling
back to a full-history download.

Original conversation data stays in Codex storage. Tool previews and excerpts are
bounded; **Load full detail** retrieves the original in 32,000-character chunks,
also sliced in the worker before crossing its pipe. Detail cursors stay anchored
to the original item when newer messages arrive. Images and structured tool
results remain in the original detail and are not automatically downloaded on
opening. The existing PWA and Windows clients use this unchanged page contract.

A retained older worker must migrate before these reads become available. During
an update, the managed installer preserves active execution. Install the new Host,
then use **Restart execution runtime** only when turns and approvals are idle;
the worker atomically refuses shutdown while execution, approvals or accepted
starts are in flight. Background migration must honor this guard and retain the
old version directory until no process references it. No force-stopping active
workers or editing Codex storage is needed.

The PWA asks for a name before sending a new chat's first message or onboarding
instruction. Names are stored in the shared runtime; existing unnamed chats use
compact first-line labels. Bulk selection uses the same labels as chat navigation.

Successful runtime catalogs replace stale cached chat entries and reconcile
observed activity. Archive, restore and delete have durable receipts and verify
current execution state before acting. A stale activity badge no longer blocks
an idle chat. A genuine writer lock held by a separate Codex runtime can still
reject lifecycle changes, even after that runtime's turn ends: unsubscribe alone
does not release the lock. Perform the action from its owning session or close
that session and retry. AgentView does not terminate another runtime or edit its
database to bypass ownership. These changes preserve the existing execution
worker during Host replacement.

Host 0.4.4-dev.5 treats the selected vault's `workspace.json.products` as the
canonical onboarding workspaces. Product names come from their entry-note titles,
and runtime project metadata is matched by checkout path without replacing the
manifest identity. A newly registered product therefore appears in both clients
without requiring an earlier Codex conversation. Runtime-only folders remain
available after the manifest workspaces; `plannedProducts` are not execution
workspaces.

## Managed installation and updates

Managed installations can pin `dataDirectory` in `current.json`. Both the native
launcher and scheduled `start-host.ps1` pass it as `AGENTVIEW_DATA_DIR`, overriding
inherited settings. The installer preserves this selection across updates; use
`-HostDataDirectory` to select an already prepared profile. The shortcut opens the
native launcher so it uses the same profile as scheduled startup.

When installing from a packaged desktop app, Windows can redirect AppData into
that app's LocalCache while scheduled startup sees the physical AppData folder.
An absolute AppData path alone does not prevent this. For this case, back up both
profiles and migrate the intended identity, devices and durable state to a private
directory outside AppData, such as `<InstallDirectory>/data`. Repoint the tunnel's
certificate/credential paths and saved connector path to that directory. Do not
merge unrelated Host identities or regenerate paired-device credentials. Set
`-HostDataDirectory` to the migrated directory and pass the same directory to
`configure-remote.ps1 -HostDataDir` for future remote configuration. The installer
does not guess which profile owns the user's devices or automatically migrate it.

Build with `npm ci` and `npm run package`, then install the validated unpacked host:

```powershell
./scripts/install-host.ps1 -PackageDirectory ./out/host/win-unpacked `
  -InstallDirectory "$env:USERPROFILE/Desktop/AgentView" -Version 0.4.2 `
  -RegisterStartup
```

For administrator execution, run this same command **once in an administrator
PowerShell**, adding `-Elevated`. Windows may require a human UAC consent. The
installer registers an interactive task for the same user with Highest privileges;
future sign-ins do not require a fresh UAC prompt for that task. Do not use another
administrator account, which would select a different Codex sign-in and data.
Use the managed task instead of the portable app's separate start-at-sign-in toggle.
The installer updates **AgentView Host.lnk** in the installation folder to open
the same validated version used by the startup task.
It also installs the small launcher as **AgentView Host.exe** in the folder root.
The installer clears that toggle and removes this installation's older login entry
when registering managed startup, preventing two host versions from racing at sign-in.

The installer stages a versioned directory, stops only the installed transport
process tree, retains the independent runtime, switches `current.json`, and checks
the new Host's version, process and agent readiness. Failure restores the previous
pointer and executable when available. An existing portable executable in the
installation root is retained for the first rollback. Do not delete older version
directories while their runtime still runs. Settings, device keys, attachments and
Codex history live outside those version directories.

Managed install/start scripts clear inherited `ELECTRON_RUN_AS_NODE` before
launching the Host. An agent executing inside the independent worker can export
that flag; passing it into the Host makes Electron run as Node and exit before
starting the service or tunnel. It is retained only inside execution workers.

`start-host.ps1` adopts an already running installed host and restarts unexpected
exits with bounded backoff. An intentional tray Quit ends supervision. Updates
coordinate with the scheduled task using `updating.lock`. The computer must stay
awake and signed in; the installer does not change power settings or reboot it.

## Execution and recovery

The packaged Host launches a detached runtime worker that owns `codex app-server`.
The host authenticates to a private named pipe using a per-installation token.
Closing or replacing the tray/network process detaches its viewer while active
turns continue. Reopening restores active turn and approval state. A machine
reboot, terminated worker, runtime crash or expired account still interrupts work.
There is no promise of uninterrupted tools across an OS restart.

**Reconnect agent** reattaches the host. **Restart execution runtime** deliberately
restarts the worker to pick up new code, permissions or tool changes; it refuses
while turns or approvals are active. An existing worker keeps its original Windows
elevation until restarted. Diagnostics show the worker version as well as Host version.

Chats are non-ephemeral Codex threads, saved under the same account's Codex home.
**Recovery** verifies the stored thread and copies `codex resume <thread-id>`.
Stop active work before opening that conversation in another runtime. Desktop
discovery depends on its runtime compatibility and the same account/home. This
does not mirror local Codex chats into ordinary ChatGPT web history. If an external
Desktop chat is continued in AgentView, AgentView creates its own history-preserving
branch to avoid competing writers.

The durable outbox records accepted commands on the host. If a connection dies
after submission, the phone checks its receipt instead of automatically repeating
the action. A crash during acceptance can leave an **uncertain** result; inspect
the chat before resending. Queued follow-ups persist and run after current work.
The network host must be running to dispatch queued work and push notifications.
Completion events missed while it is offline remain in Codex history; they are
not retrospectively delivered as push alerts.

## Validation

With Host stopped, set `AGENTVIEW_LIVE_TEST=1` and `AGENTVIEW_PACKAGED_HOST` to the
installed executable, then run `npx tsx scripts/installed-pairing-smoke.ts`.
This opens Host, clicks Pair without a manual tunnel delay, claims the generated
code and verifies an authenticated public WSS snapshot. It revokes only its new
test device and closes Host. Existing devices and conversations are preserved.

`npm run check` and `npm run pwa:smoke` cover permission forwarding, durable
receipts, file boundaries, onboarding, rename, images, reload recovery and bulk
actions. `node scripts/worker-smoke.mjs` uses the installed signed-in runtime to
verify that the same execution worker survives a host crash/restart. Set
`AGENTVIEW_PACKAGED=1` to test the unpacked release payload. The test uses isolated
Host settings and removes its own processes and temporary files.

After packaging, `node scripts/window-smoke.mjs` checks hidden startup, repeated
reopening through the managed launcher, minimization, missing-window recreation
and renderer-crash recovery with an unavailable backend. Each reopen must complete
within four seconds. Set `AGENTVIEW_PACKAGED_HOST` to test a different unpacked
Host directory. Windows packaging compiles the small managed launcher with the
Windows .NET Framework compiler; its source is tracked in `src/launcher`.
Immediately after installing, before opening Host, run
`./scripts/installed-window-smoke.ps1 -InstallDirectory <installed-folder>` to
verify that the first explicit open produces a responsive native Windows window
without replacing the running network process.

`npx tsx scripts/runtime-smoke.ts` performs a real agent turn with an image and an
outside-workspace file write, checks unrestricted access with `on-request` on
start and resume and zero approval requests for that routine write,
then verifies persisted history and resume from another app-server. It consumes
account usage and deletes only its newly created test conversation and directory.

After installation, set `AGENTVIEW_LIVE_TEST=1` and `AGENTVIEW_DATA_DIR` to the
installed Host data directory, then run `npx tsx scripts/installed-permissions-smoke.ts`.
With Full access selected and an existing paired client, this creates one no-tool
test turn through the running Host and checks its recorded approval/sandbox policy.
It removes only that test conversation; existing agents and pairings are preserved.
