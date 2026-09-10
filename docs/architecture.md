# Architecture

AgentView has two Windows entry points built from one TypeScript project.
The host is an Electron tray application. The client is an Electron application
with a React interface and a Canvas/d3-force knowledge graph. Fonts and visual
assets are bundled; the client does not need an internet connection to render.

## Ownership

The host retains the vault, repositories, tools, Codex authentication and execution.
Markdown is the source of truth. The graph is a rebuildable in-memory index,
not another knowledge store. Chokidar watches visible Markdown files; hidden
folders, template directories, tool directories and symbolic links are excluded.
YAML frontmatter, Markdown links, wikilinks, headings and aliases inform the view.
Unreadable or removed notes are reconciled on rescan. A selected note is read by
its indexed identifier; clients cannot request arbitrary filesystem paths.

The client holds the visible graph and conversation content in memory. It does
not clone the vault or repositories. Its remembered connection is encrypted with
Electron safeStorage on Windows. Ordinary OS paging and screen capture are outside
this storage boundary.

## Connection

The host listens on TCP 43120 by default, using TLS. A connection key contains
the LAN address, a random access token and the host certificate fingerprint.
The client checks the pinned certificate before sending the token. Pairing needs
no accounts, domain, certificate authority or router forwarding. Treat the key
as access to the workspace; do not publish it. This is designed for a private LAN.
The optional **Allow LAN connections** action asks Windows for administrator
approval and creates or updates the single `Hardline-AgentView-LAN` inbound rule:
TCP on the configured port, limited to `LocalSubnet`, on any Windows profile.
It never changes the network's Public/Private classification.

The desktop main process owns the socket; the renderer receives a narrow IPC API.
Typed events carry graph snapshots, activity, conversation deltas and approvals.
The host sends heartbeats. Clients retry with backoff after a lost connection and
receive a fresh snapshot. The host keeps running when the viewer disconnects.
Requests have unique identifiers; repeated mutation identifiers are deduplicated
within a host process. The client never automatically resends an uncertain action.

Host settings and TLS identity are stored in the current Windows user's application
data directory. Start-at-sign-in is optional. Closing the host window hides it;
Quit Host in the tray ends the service and its agent process. The laptop must
remain awake and signed in; AgentView does not override power or lid settings.

## Agent integration

The host starts the locally installed `codex app-server --stdio` and uses its
documented JSON-RPC interface. It uses the existing host sign-in. Available models
come from `model/list`; conversation history is paginated. Recent live turns are
also folded into memory so early deltas remain visible before logs reach disk.

The catalog exhausts active and archived `thread/list` cursors with every local
source kind and provider included. `project/list` and `threadSection/list` supply
projects and categories. During Desktop's project migration, a read-only adapter
reads only legacy local assignments and their canonical ID mapping from
`.codex-global-state.json`; runtime assignment takes precedence, then legacy
assignment, then an exact working-folder match. That adapter is version-sensitive
and never changes Desktop state. Cloud-only conversations are outside this catalog.

Desktop conversations are readable. Sending into an externally owned conversation
forks it into an AgentView branch, avoiding concurrent writers across independent
app-server processes. AgentView-owned conversations resume normally. The interface
labels this behavior before sending. This does not synchronize ordinary ChatGPT
web conversations, cloud projects or every desktop-only capability.

Owned active turns accept `turn/steer` with an `expectedTurnId` precondition.
An ended or changed turn fails without starting another turn; the client retains
the draft. Model/effort overrides apply to new turns, not steering. Archive,
unarchive and deletion use the runtime lifecycle APIs, including their descendant
semantics. The host rejects clearing observed active work; deletion requires the
client's explicit confirmation. Mutation request IDs are deduplicated.

`thread/tokenUsage/updated` supplies the context gauge and cumulative totals.
The bounded rollout observer recovers `token_count` records for existing active
and archived chats, including old timestamps, without interpreting message text.
The latest request's total tokens are compared to the reported model context
window; cumulative tokens are displayed separately. No model capacity is guessed.
Account quota buckets come from `account/rateLimits/read`, refreshed each minute
and on reported updates. Snapshots retain usage across client reconnects; account
failures/disconnection retain labeled last-known values and check times.

The graph's orbs represent observed events: tool reads/searches, file changes,
command execution, responses, and reported subagent activity. Recognized paths
target a node; unrecognized work orbits the graph. Filesystem changes pulse nodes
without inventing an agent attribution. Private reasoning is omitted. Subagent
detail is limited to events the installed runtime forwards.

Canvas resolution uses the current device pixel ratio without a density cap and
is rechecked on monitor changes. `requestAnimationFrame` follows display timing;
agent speed and zoom interpolation use elapsed time. The layout simulation settles
instead of continually nudging text. Connections extend and animate independently
of travel. Terminal and Agent workspace stations give untargeted work a visible,
clickable destination. Gentle-motion settings pause decorative motion; actual
agent travel remains visible. Smoothness ultimately depends on monitor, GPU and
OS compositor performance.

A read-only session observer follows only rollout paths returned by the local
app-server, within its sessions directory. It reads bounded incremental JSONL
chunks to surface existing desktop work and recover original tool targets hidden
behind runtime wrappers. Tool-input classification is best effort; mixed shell
commands can only be summarized approximately. Reasoning, user messages and tool
outputs are never interpreted as activity. This adapter is version-sensitive.

## Validation

`npm run check` runs TypeScript, unit/integration tests and the production build.
Tests exercise live vault reconciliation, link semantics, path restriction,
TLS/token rejection, connection recovery and streamed conversation ordering.
They also cover full catalog pagination, project migration, historical token
recovery, steering preconditions, archive/restore/delete and refresh-independent
travel speed.
`npm run smoke` launches both Electron apps and checks pairing, the real vault,
search, attachment, desktop history and the tray lifecycle, saving screenshots
under `.local/smoke`. Set `AGENTVIEW_LIVE_TEST=1` for an additional real read-only
agent turn; that uses the signed-in account and creates a conversation.
The live check sends steering during command execution, verifies the response,
then archives, restores and deletes only that newly created test conversation.
Set `AGENTVIEW_PACKAGED=1` to run the same checks against the packaged app payloads.
After packaging, `node scripts/portable-smoke.mjs` launches the actual portable
executables and verifies their independent roles, TLS pairing and live vault.
It uses isolated settings and closes only the process trees it creates.

`npm run package` builds two portable Windows executables. Packaging and local
checks publish nothing. The GitHub workflow validates branches independently.
