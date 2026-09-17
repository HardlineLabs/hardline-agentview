# Host capability API

The encrypted AgentView request envelope remains `{id, method, params}`. Requests
are available only after the existing per-device pairing/authentication handshake.
There is no unauthenticated HTTP control API. See [remote access](remote-access.md)
for the transport. All paired devices have workspace-level authority.

Initial pairing has a separate, bounded directory API at
`https://agentviewapp.hardline-labs.com/api/pair`. Its JSON POST routes are `publish`
(`invitation`, random 256-bit hexadecimal `token`, `expiresAt`), `claim` (six-digit
`code`, random UUID `claimId`), and `cancel` (`token`). Publish returns `code` and
`expiresAt`; claim returns the temporary `invitation`. Requests are capped at
12 KB, rate-limited and uncached. The same claim ID can retry a lost response.
This API performs no workspace operations. Host's local `host.pairCode` action
checks the public encrypted endpoint before publishing. Full protocol-3 invitations
remain available through local `host.invite` for older clients.

Clients inspect `api.capabilities` (its version indicator is also in snapshots) before exposing new
controls. Version 1 reports Host version, supported method names, limits and event
epoch. Existing 0.3 clients continue using their original calls; new clients hide
expanded controls on older hosts. Runtime adapters return a clear runtime error
when an installed Codex version does not support an extension.

## Host-owned methods

| Methods                                              | Parameters and result                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `host.preferences`, `host.preferences.update`        | Saved `defaultPermissions`: `full`, `workspace`, `read-only`; `onboarding`: text up to 20,000 characters. Update only supplied fields. |
| `host.diagnostics`                                   | Actual ready/error status, versions, Windows elevation, Codex home and summarized tool/feature probes.                                 |
| `host.reconnect`, `host.runtime.restart`             | Reattach, or restart an idle independent worker. Returns `ready`.                                                                      |
| `files.list`                                         | `projectId`, relative `path`; up to 1,000 directory entries.                                                                           |
| `files.read`                                         | `projectId`, relative `path`, byte `offset`, `length` up to 512 KiB; base64 `data`, `size`, `nextOffset` (null at end).                |
| `files.upload`                                       | `name`, base64 `data`, `mime`; returns opaque attachment `id`, name, MIME, size. Maximum 6 MiB each.                                   |
| `queue.list`, `queue.add`, `queue.cancel`            | Add with owned thread `id`, `text`, optional `model`, `effort`, `attachments`; cancel a waiting job by job `id`.                       |
| `notifications.list`                                 | Latest 100 generic completion/input notices with thread IDs and timestamps.                                                            |
| `notifications.status`, `.subscribe`, `.unsubscribe` | Current device's web-push status/VAPID public key; subscribe with browser `subscription`. Keys remain on Host.                         |
| `events.since`                                       | Prior `epoch`, `sequence`; lightweight queue/notice/preference replay or `reset: true`. Fetch a snapshot on reset.                     |
| `request.execute`, `request.status`                  | Durable mutation receipt protocol below.                                                                                               |

Workspace file paths must resolve inside a known project. Outbound attachments
are saved under Host data using opaque IDs, never supplied absolute paths. Uploaded
attachments are retained for conversation resume; removing them manually can break
old local-image references. Files are not added to the vault or committed to Git.

## Conversation methods

Existing create/read/send/steer/interrupt, approval response and lifecycle methods
remain supported. New methods include:

| Method            | Parameters                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `thread.rename`   | `id`, `name` (1–200 characters after trimming).                                                                                                                             |
| `thread.bulk`     | `ids` (1–100), `action`: archive/unarchive/delete. Delete additionally requires `confirm` equal to the deduplicated ID list. Returns individual `{id, ok, error?}` results. |
| `thread.recovery` | `id`; returns verified persistence, runtime path/home and CLI resume command.                                                                                               |
| `thread.fork`     | `id`; forks history into an AgentView-owned conversation.                                                                                                                   |
| `thread.compact`  | `id`; starts compaction.                                                                                                                                                    |
| `thread.project`  | `id`, `projectId`; assigns runtime project metadata.                                                                                                                        |
| `thread.goal`     | `id`, `action`: read/set/clear; optional `objective`, `tokenBudget`, `status` for set.                                                                                      |
| `thread.review`   | `id`, `target`; uses the installed runtime review target schema.                                                                                                            |

`thread.send` accepts up to eight `{id}` attachment references. Supported image
files become local-image runtime inputs; other files are named as host-local
attachments in the message. Steering requires the expected active turn ID and
does not change its model or permissions. Active conversations cannot be archived
or deleted. Runtime descendant semantics apply to those lifecycle calls.

`thread.read` may return `historyPending: true` with cached live turns while a
new rollout's metadata is not yet readable. Keep the current page and retry this
read; do not resend the accepted message. `thread.send` also returns `thread`
metadata so clients can display its accepted turn before the first history read.

Send/steer accept `clientUserMessageId` for reconciliation with runtime user-message
items. The durable wrapper uses `requestId` as that identity; clients creating
optimistic messages should use the same ID for both. A successful steer response
confirms runtime acceptance, while the user-message event confirms input delivery.

`thread.autoApprove` accepts `{ id, enabled }` and returns the saved choice.
Enabling requires Full access and an AgentView-owned chat. Disabling is allowed
even while the agent runtime is disconnected. The Host serializes concurrent
changes and persists them before acknowledging. New snapshots include optional
`autoApproveThreads: string[]`; its presence advertises support to clients.
`autoApprove` events replace that list via `threads`. Older hosts omit the field
and clients hide the control. Full access gates every automatic response;
permission changes broadcast the ordinary `preferences` event. Automatic decisions
appear as `activity` events with `action: "auto-approved"` and the exact `threadId`.
The saved setting applies only to that conversation, without inheritance to forks
or descendants. See [Host operation](host-operation.md#permissions-and-computer-use)
for pause/resume, persistence and supported request types.

`approval.respond` accepts `id` and `allow`. For a form-mode MCP elicitation, Allow
also accepts `content`, an object matching `requestedSchema`; Host checks required
fields, primitive types and choices. Decline needs no content. URL-mode acceptance
has null content. Extended OpenAI forms are not enabled by this client.

## Runtime discovery adapters

`runtime.models`, `.skills`, `.plugins`, `.apps`, `.mcp`, `.features`, `.permissions`,
`.requirements`, `.projects`, `.sections`, `.account` and `.limits` map to the
corresponding Codex list/read APIs. They accept the runtime's own paging/filter
parameters and preserve its response shape. Adapter input is bounded to 16 KB.
This is an explicit, expandable allowlist, not unrestricted arbitrary RPC access.
Codex's generated app-server schema is the contract for version-dependent fields.

## Durable requests and state

Wrap `thread.create/send/steer/rename/bulk`, `files.upload` or `queue.add` in:

```json
{
  "method": "request.execute",
  "params": {
    "requestId": "a-unique-uuid-for-this-action",
    "method": "thread.send",
    "params": { "id": "thread-id", "text": "Continue" }
  }
}
```

IDs are scoped to the authenticated device. The host persists a pending receipt
before executing, then an accepted result or failure. Reusing an ID for different
content is rejected. `request.status` returns pending/accepted/failed/uncertain or
missing. Pending receipts recovered after a crash become uncertain. Never blindly
replay uncertain work: inspect history and let the user decide. The latest 1,000
finished receipts are retained; missing does not prove an old action never ran.

Queue states are waiting/running/completed/failed/uncertain. Uncertain jobs never
auto-repeat. Up to 100 active jobs and 200 recent jobs are retained. Control events
have monotonically increasing sequence numbers within a Host epoch, with a 200
event replay buffer. Conversation history is read from Codex, not this event ring.

See [host operation](host-operation.md) for persistence and recovery boundaries,
and [PWA](pwa.md) for browser storage and notification permission behavior.
