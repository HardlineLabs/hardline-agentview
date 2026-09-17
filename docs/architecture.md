# Architecture

AgentView has two Windows entry points and an installable PWA in one TypeScript
project. The PWA uses the shared React interface and encrypted protocol through a
browser adapter. [Web client](pwa.md) owns installation, device storage, lifecycle
and static publishing behavior.
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
Electron safeStorage on Windows. Drafts, attachment previews, the selected chat and
up to 50 outgoing action receipts use the same Windows protection, with atomic
ciphertext replacement and a 16 MB saved-state limit. These are isolated by Host
identity and cleared on disconnect. Conversation transcripts stay in memory.
Ordinary OS paging and screen capture are outside this storage boundary.

Shared React components under `src/ui` own transcript virtualization, composer,
workspace tools, recent-chat cache and client state. Browser IndexedDB and native
Electron IPC provide platform storage; both clients share receipt reconciliation.
The native main process retains credentials and transport. Reloading its renderer
requests a fresh Host snapshot without interrupting running work. Windows notices
are opt-in and require the client to remain open; web push uses its service worker.

The Windows Client can replace its renderer with a signed compatible UI bundle.
The native shell owns downloads, verification, active-version selection and startup
rollback; it always retains the bundled fallback. The Host uses only its packaged
interface. [Desktop UI updates](desktop-ui-updates.md) owns the format, publication,
compatibility and recovery workflow.

## Connection

The default LAN listener is TLS on TCP 43120. Clients prefer the paired LAN host
and fall back to its configured remote WSS endpoint. Both use authenticated,
end-to-end encrypted sessions with per-device credentials. See the authoritative
[remote access guide](remote-access.md) for protocol, pairing, isolation, migration,
Cloudflare setup and operational boundaries.

The desktop main process owns networking.
The PWA uses browser WebSocket with publicly trusted remote TLS. All clients use
the shared WorkspaceConnection state machine and typed interface bridge.
Events carry graph snapshots, activity, conversation deltas and approvals. The
host sends heartbeats. Clients retry with backoff and receive a fresh snapshot.
The host keeps running when a viewer disconnects. Mutations are deduplicated by
device and request identifier. Host 0.4 adds durable receipts for expanded-client
mutations; reusing an identifier with a different action is rejected. Clients do
not resend uncertain actions. [Host API](api.md) owns the capability contracts.

Host settings and TLS identity are stored in the current Windows user's application
data directory. Start-at-sign-in is optional. Closing the host window hides it;
Quit Host in the tray ends the network service; the packaged independent runtime
keeps active agent work alive. [Host operation](host-operation.md) owns the worker,
managed updater, privilege and shutdown contracts. The computer must
remain awake and signed in; AgentView does not override power or lid settings.

## Agent integration

The packaged host connects to a detached worker that starts the locally installed
`codex app-server --stdio` and uses its documented JSON-RPC interface. It uses the
existing host sign-in. Available models come from `model/list`; history is
paginated where supported, with legacy stored-history fallback. Recent live turns are
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

Steering appears immediately as a muted pending message. Runtime acknowledgement
changes its status to Waiting for agent; the runtime's user-message event replaces
it with the normal chat message using its `clientId` correlation (or matching item
ID on older runtimes). This does not claim that the model has understood the
direction. Failed steering retains the draft; uncertain delivery stays visibly
unconfirmed and is never resent automatically.

Reopened conversations preserve the saved page's chronological order. The Host's
live cache can contain turns older than that page; these stay behind Earlier
messages instead of being appended as new work. Shared turns receive live updates,
and only the cache tail after the last shared turn extends the newest page.

Newly accepted turns remain visible while the runtime's rollout metadata is still
being written. Host uses its live conversation cache only for this transient
condition, marks saved history as pending, and clients refresh the read until it
is available. Other history errors remain visible. Composer choices survive chat
creation and refresh; late thread metadata cannot overwrite a user's local choice.

Command/file approvals and MCP elicitations have separate response contracts.
MCP Allow sends accept with the requested typed form values; Decline sends decline
with no content. URL elicitations link to their permission flow. Unknown extended
forms require the host agent interface; AgentView never treats an unsupported form
as an approval or silently converts Allow into cancellation.

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
clickable destination. In the PWA these stations sit below the note bounds without
joining the force simulation or note links. They use a 13-unit radius, scale with
the graph, and support independent dragging. User placement lasts for the mounted
graph and survives graph snapshots; Fit includes the current station positions.
Dragging does not open a chat; tapping a busy station does.
Gentle-motion settings pause decorative motion; actual
agent travel remains visible. Smoothness ultimately depends on monitor, GPU and
OS compositor performance.

The Windows graph uses the note-domain palette for luminous nodes and links over
its black brain surface. While an agent remains active, its current target and up
to six distinct note targets observed for that thread in the preceding 90 seconds
remain connected; older, unknown and unrelated targets are excluded. This is a
bounded presentation of observed activity, not a claim about private reasoning or
simultaneous filesystem access. The Windows conversation panel can be resized from
300 to 720 pixels by dragging its divider or using the divider's arrow-key control;
the available brain width can lower the effective maximum. These treatments are
desktop-only and do not alter PWA rendering or layout.

The PWA renders subdued flat nodes and reuses the settled note network as a raster
while live agents animate above it. Hidden and idle views stop drawing; metadata
refreshes retain layout. The browser [rendering guide](pwa.md#rendering-and-battery-use)
owns invalidation, resource loading and repeatable performance checks. The Windows
client retains its original visual treatment and continuous animation.

A read-only session observer follows only rollout paths returned by the local
app-server, within its sessions directory. It reads bounded incremental JSONL
chunks to surface existing desktop work and recover original tool targets hidden
behind runtime wrappers. Tool-input classification is best effort; mixed shell
commands can only be summarized approximately. Reasoning, user messages and tool
outputs are never interpreted as activity. This adapter is version-sensitive.

## Validation

`npm run check` runs TypeScript, unit/integration tests and the production build.
Tests exercise live vault reconciliation, link semantics, path restriction,
TLS/peer rejection, connection recovery and streamed conversation ordering.
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
Set `AGENTVIEW_TEST_DPR=3` to verify native canvas resolution above 2x density.
After packaging, `node scripts/portable-smoke.mjs` launches the actual portable
executables and verifies their independent roles, TLS pairing and live vault.
It uses isolated settings and closes only the process trees it creates.

`npm run package` builds two portable Windows executables. Packaging and local
checks publish nothing. The GitHub workflow validates branches independently.
