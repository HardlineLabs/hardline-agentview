# Hardline AgentView

A remote workspace for the creator. A live knowledge graph and agent conversations,
with files and execution kept on the host computer.

## Connect your workspace

Open **AgentView Host.exe** on the Windows computer that owns your vault and agent
runtime. Choose the vault, check the agent connection, and optionally enable
start-at-sign-in. **Allow LAN connections** asks Windows to allow the configured
port from the local subnet. Keep the host computer awake and signed in; closing
its window leaves it in the tray.

For iPhone, choose **Pair device**, name the phone, and enter the six-digit code
at [agentviewapp.hardline-labs.com](https://agentviewapp.hardline-labs.com). Host checks remote
reachability first. Codes expire in five minutes and work for one device.
Windows clients use **Older clients and local pairing → Create full
invitation**. The host can remove a paired device's access at any time. Each paired
device has full access to this workspace. Version 0.3 requires fresh pairing;
connection keys from 0.2 no longer work.

Local connections go directly to the host on TCP **43120** by default. For access
from other networks, configure a dedicated Cloudflare Tunnel endpoint using the
[remote setup guide](docs/remote-access.md). Clients automatically fall back to
that endpoint when the paired LAN connection is unavailable. **Local**, **Remote**
and reconnecting states show which connection is in use. Workspace messages are
end-to-end encrypted through both paths. No router port forwarding is needed.

## On iPhone and the web

Open the AgentView PWA in Safari and add it to your Home Screen. Open its new icon,
then enter a fresh six-digit code from your own Host with Remote access configured.
The web app uses the shared workspace interface and existing encrypted protocol;
Host 0.4 enables saved Full Access defaults, onboarding, renamed chats, bulk
archive/delete, image/file attachments, durable drafts, files, queued follow-ups
and optional completion notifications. Older hosts retain the basic client.
UI updates arrive through the web app without reinstalling.
See [web installation, updates and validation](docs/pwa.md).

Use [host operation](docs/host-operation.md) for managed updates, optional Windows
administrator startup and conversation recovery. [Host API](docs/api.md) describes
the capability contract for future client interfaces.

## On Windows

Drag notes to play with the network, scroll to zoom, and double-click to fit.
Select a note to read it or bring it into a conversation. **Ctrl+K** finds notes
and conversations. Graph settings control labels and gentle motion; you can hide
the chat panel for a full-width brain.

Existing desktop conversations appear in the explorer. Continuing one creates
an AgentView branch with its history. Conversations created in AgentView continue
in place. All commands and file work run on the host. The host owns the agent
process, so disconnecting the client does not cancel a running turn.

The explorer includes every page of local Codex conversations, including archived
chats and subagents. Search chats or filter by project and category. **Archive**
clears a conversation from the active list; open **Archived** to restore it.
**Delete** permanently removes it from Codex on the host after confirmation.
Archive and deletion also apply to spawned subagent chats. Let active work finish
or stop it before clearing its conversation.

The chat's **Context** gauge shows the latest reported token use against the
model's context window, with cumulative conversation tokens underneath. Codex can
compact history, so context use can fall while the cumulative total keeps growing.
**Codex limits** in the sidebar shows account usage, reset times and reported
credit balances. Missing metrics are labeled, rather than estimated.

While an AgentView agent works, type into the composer and press **Steer agent**
or Enter to send more direction without stopping its turn. **Stop agent** remains
available separately. Steering applies to turns running in AgentView; an existing
Desktop conversation still continues in a new AgentView branch.

For fewer interruptions, select Full access in workspace settings and turn on
**Auto-approve** in a chat. Host automatically accepts supported command, file-change
and permission requests for that conversation, including while your phone is away.
New chats default to manual approval; questions and sign-in flows still need you.
Turn it off at any time. Requires Host 0.4.3-dev.3 or later; see
[approval behavior](docs/host-operation.md#permissions-and-computer-use).

Agents travel at a calm, display-independent pace. Bright animated connections
reach toward the file they are using. Command work without a known file target
connects to the separate **Terminal** node; other work connects to **Agent
workspace**. Click a busy station or an agent to open its chat. Graph labels settle
when untouched, while activity stays animated. Rendering follows the monitor's
native pixel density and browser refresh timing, including after moving between
monitors. The app does not change Windows display settings.

## Build

Requires Windows, Node.js 24 and an installed, signed-in Codex runtime for agent
features. The client needs only its executable.

```powershell
npm ci
npm run check
npm run host
# In a second terminal:
npm run client
```

Use `npm run package:host` when shipping only Host and the PWA. Build the browser
separately with `npm run pwa:build`.
`AGENTVIEW_PACKAGE_OUTPUT` can select a fresh output directory when Windows has
locked a previous build. The package contains the bundled app, not dependency build caches.

`npm run package` creates `out/host/AgentView Host.exe` and
`out/client/AgentView.exe`. No installer or administrator privileges are required
for the apps themselves; enabling the Windows firewall rule requires approval.
Keep the host executable in a stable location if using
start-at-sign-in. The two roles have separate settings directories in `%APPDATA%`.

For UI development, run `npm run dev` and set `AGENTVIEW_DEV_URL` to the displayed
localhost address before starting an app. The production build bundles fonts,
assets and application code.

See [architecture and validation](docs/architecture.md) for connection semantics,
data ownership and supported agent behavior.
