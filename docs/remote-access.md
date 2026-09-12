# Secure remote access

Every workspace belongs to one host. Different people run independent hosts with
independent vaults, runtime accounts, TLS identities and device stores. A paired
device has full access to its host's workspace; it cannot name another host or
choose an arbitrary filesystem path. This release has no shared cloud account
directory, billing system, hosted multi-tenant runtime or public registration.

## Pairing and transport

Use **Pair device** in Host 0.4.1 to create a named, five-minute, six-digit code.
Enter it in the iPhone PWA. Host first verifies the public TLS endpoint and its
encrypted host proof without redeeming the invitation. An optional QR opens the
PWA with the code filled in; scanning is no longer required. Generating
another invitation invalidates the previous unused invitation. Successful pairing
replaces it with an independent random credential, stored using Windows
safeStorage or encrypted browser-local storage. Host lists paired devices and can
remove one without changing other devices' credentials. Removing access closes active
sessions. Each host supports up to 100 paired devices. Windows
clients retain full invitations under **Older clients and local pairing**.

Six-digit discovery uses `agentviewapp.hardline-labs.com/api/pair`, a trusted Cloudflare
Worker with a SQLite Durable Object. It temporarily holds the invitation and
public route, not files, conversations, Codex credentials or permanent device
credentials. This expands initial-pairing trust to the directory operator;
workspace messages continue directly over the existing encrypted WSS protocol.
The code is never the encryption key. A random 256-bit invitation credential
authenticates the handshake, then Host issues an independent device credential.

Codes expire within five minutes and are claimed atomically by one random client
identifier. A retry by that same identifier can recover a lost lookup response;
another client cannot reuse it. The browser saves the identifier encrypted before
lookup. The directory permits 10 claims per caller per ten minutes and 30 globally
per minute, bounds active entries to 100, and rate-limits publishing. It removes
expired entries using scheduled cleanup, caches no API responses, and disables
Worker request logs. Codes remain access credentials; share only with the intended
device owner. Existing paired devices reconnect without using the directory.

Choose **Auto**, **LAN**, or **Remote** before scanning or pasting an invitation.
Remote skips LAN entirely; LAN never falls back to the internet. The selection
is remembered with a successful pairing. The connected route stays visible.
In Auto, clients try the paired LAN endpoint first. If it is unavailable, they use the
configured remote WSS endpoint. LAN validates the exact pinned host certificate;
remote validates the public certificate chain and hostname. Both paths additionally
use the same end-to-end encrypted protocol. A remote endpoint change requires an
updated pairing invitation. A valid remote connection stays in use until the next
connection cycle; reconnects try LAN first. A client never automatically repeats an
action whose outcome became uncertain during a disconnect.
Initial connection attempts stop after 30 seconds with guidance if neither route
works. A reachable host has a separate secure-handshake deadline; returning from
the scanner does not restart pairing already in progress.

If a remote client cannot pair, check that Host shows the configured remote
endpoint and that its tunnel is connected. Restart Host after external setup
changes. The host's listening port must match the tunnel's origin port. Create a
fresh invitation after restoring remote access; an earlier LAN-only invitation
does not gain the remote address automatically.

Protocol 3 uses Web Crypto P-256 ephemeral ECDH, HKDF-SHA-256, HMAC-SHA-256 peer
proofs and directional AES-256-GCM message keys. The 256-bit out-of-band credential
authenticates the handshake transcript, including host and device identifiers,
both ephemeral public keys and fresh nonces. Credentials never appear in plaintext
on the transport. Each direction has its own key and ordered sequence nonce;
tampered, reflected and replayed frames are rejected. The relay sees connection
metadata and encrypted message sizes, not workspace payloads. This private release
is tested software, not an independently audited cryptographic protocol.

The host stores device secrets and TLS keys in its Windows user-data directory.
Protect that account and directory. Pairing invitations grant workspace access;
do not publish them. Old 0.2 connection keys are deliberately unsupported. Upgrade
the host and all clients, then pair devices again.

## Browser clients

The [PWA](pwa.md) connects to the same remote WSS endpoint using protocol 3.
Its static web host delivers the interface and does not process workspace messages.
Its separate pairing routes handle only the temporary setup exchange described above.
Browser clients require a publicly trusted endpoint; the native pinned LAN route
is unavailable. Current host authentication does not use cookies or rely on browser
Origin headers: every session must prove possession of its per-device credential.
The client permits WSS connections to user-paired hosts, with no embedded host
address, credential or shared runtime.

## Cloudflare Tunnel

Host prefills an empty **Remote endpoint** field with
`wss://agentview.hardline-labs.com/`. A saved custom endpoint is preserved. Edit
the field for another host's tunnel or clear it for local-only access, then save
settings to apply. Opening the form does not change the active configuration;
an empty field is prefilled again the next time the window loads. The Hardline
Labs address requires a tunnel routed to that Host; prefilling it does not
provision a tunnel for another computer.

Remote traffic goes from the client through a dedicated Cloudflare hostname and
outbound tunnel to the host. The website application does not process these
messages. Tunnel credentials stay on the host, never in browser or desktop
clients. Local traffic does not use Cloudflare. Six-digit discovery adds a Worker
and SQLite Durable Object on the existing web deployment. It does not relay
workspace messages. The configuration uses resources available on the free plan;
no paid upgrade is provisioned.

Install `cloudflared`, authenticate it to a Cloudflare zone you own, and start
AgentView Host once. Then, from PowerShell 7 in this checkout:

```powershell
./scripts/configure-remote.ps1 -Hostname agentview.example.com -TunnelName my-agentview
```

This creates or selects the named tunnel, creates the hostname route, and writes
the host's local configuration. It explicitly isolates management commands from
any default Cloudflare tunnel configuration. It does not overwrite existing DNS
records. Restart Host afterward, then create invitations containing the remote
address. Host starts the configured tunnel executable, restarts it after exit,
and stops it when Host quits. **Connected** means the tunnel registered at
Cloudflare; it does not replace an end-to-end application connection check.

The generated ingress permits only the selected hostname and returns 404 for
others. The origin connection uses HTTPS with `host-cert.pem` as its CA pool and
`localhost` as its validated certificate name. No TLS verification bypass is used
for the tunnel origin. Keep host and tunnel ports consistent if changing them.

The endpoint setting is provider-independent. A future hosted relay can implement
the same opaque WSS transport with host routing, quotas and account provisioning;
it must preserve per-host identities and end-to-end device authentication. Scaling
to a public service also requires abuse controls, operations and security review.
