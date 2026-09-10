# Hardline AgentView

A remote workspace for the creator. A live knowledge graph and agent conversations,
with files and execution kept on the host computer.

## On the host PC

1. Open **AgentView Host.exe**. It finds the usual desktop vault automatically;
   choose a different folder if needed.
2. Check that the agent runtime is connected. The host uses your installed Codex
   and its existing ChatGPT sign-in. Expand **Agent runtime** to choose an
   executable if automatic detection cannot find it.
3. Copy the **connection key**.
4. Optionally enable **Start when I sign in**, then save.

Closing the host window leaves it running in the system tray. Use the tray's
**Quit host** to stop it. Keep the server laptop awake and signed in, including
when its lid is closed.

## On the workstation

1. Open **AgentView.exe** on the same private network.
2. Paste the connection key and connect. The key is remembered on this PC.

If Windows asks about network access on the host, allow your **private network**.
The default host port is TCP **43120**. No internet port forwarding is needed.
If the host has several adapters, use **a different host address** on the client
to select its LAN address. Guest Wi-Fi and device isolation can block the link.

Drag notes to play with the network, scroll to zoom, and double-click to fit.
Select a note to read it or bring it into a conversation. **Ctrl+K** finds notes
and conversations. Graph settings control labels and gentle motion; you can hide
the chat panel for a full-width brain.

Existing desktop conversations appear in the explorer. Continuing one creates
an AgentView branch with its history. Conversations created in AgentView continue
in place. All commands and file work run on the host. The host owns the agent
process, so disconnecting the client does not cancel a running turn.

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

`npm run package` creates `out/host/AgentView Host.exe` and
`out/client/AgentView.exe`. No installer or administrator privileges are required
for the apps themselves. Keep the host executable in a stable location if using
start-at-sign-in. The two roles have separate settings directories in `%APPDATA%`.

For UI development, run `npm run dev` and set `AGENTVIEW_DEV_URL` to the displayed
localhost address before starting an app. The production build bundles fonts,
assets and application code.

See [architecture and validation](docs/architecture.md) for connection semantics,
data ownership and supported agent behavior.
