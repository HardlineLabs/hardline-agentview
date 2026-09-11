# Running an autonomous AgentView host

Host 0.4 adds saved permission defaults, an independent execution process and a
managed Windows installation. The iPhone controls are under **Workspace settings**.
Existing pairings and Codex conversations remain in the same Windows user's data.

Host 0.4.1 adds six-digit iPhone pairing. **Pair device** checks the public endpoint
and this host's encrypted identity before issuing a code. Agent readiness alone
does not establish that the network listener or tunnel is reachable. A malformed
or unreadable settings file now reports a startup error instead of silently using
LAN-only defaults; Windows UTF-8 BOM files are accepted.

## Opening the Host window

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
AgentView does not automatically accept approvals. Full access does not override
explicit forbidden rules or managed restrictions. Before Host 0.4.2-dev.3, Full
access forced `never`; changing Codex's global approval setting or restarting its
runtime did not remove that Host override. Updating Host applies the correction
on the next new turn without restarting the execution worker.
Changing the default does not alter a turn already running. Workspace and Read
only modes remain available. Organization requirements and individual connected
apps can impose their own restrictions.

Full access is separate from Windows administrator rights. Run **Check host
capabilities** to see the actual Host and runtime elevation, Codex home, enabled
features and exposed tools. Availability does not prove every app interaction
will succeed. Native computer use needs a signed-in, unlocked interactive Windows
session and the relevant installed runtime tools. A Windows service in session
zero cannot provide that desktop. AgentView does not disable UAC, change security
software, configure automatic Windows sign-in, solve CAPTCHAs or suppress required
third-party consent.

## Managed installation and updates

Build with `npm ci` and `npm run package`, then install the validated unpacked host:

```powershell
./scripts/install-host.ps1 -PackageDirectory ./out/host/win-unpacked `
  -InstallDirectory "$env:USERPROFILE/Desktop/AgentView" -Version 0.4.0 `
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
