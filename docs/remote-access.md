# Secure remote access

Every workspace belongs to one host. Different people run independent hosts with
independent vaults, runtime accounts, TLS identities and device stores. A paired
device has full access to its host's workspace; it cannot name another host or
choose an arbitrary filesystem path. This release has no shared cloud account
directory, billing system, hosted multi-tenant runtime or public registration.

## Pairing and transport

Use **Pair device** in Host to create a named, five-minute, one-use invitation.
Scan the QR code on Android or paste the invitation in either client. Generating
another invitation invalidates the previous unused invitation. Successful pairing
replaces it with an independent random credential, stored using Windows
safeStorage or Android Keystore. Host lists paired devices and can remove one
without changing other devices' credentials. Removing access closes active
sessions. Each host supports up to 100 paired devices.

Clients try the paired LAN endpoint first. If it is unavailable, they use the
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

## Cloudflare Tunnel

Remote traffic goes from the client through a dedicated Cloudflare hostname and
outbound tunnel to the host. The website application does not process these
messages. Tunnel credentials stay on the host, never in Android or desktop
clients. Local traffic does not use Cloudflare. No Workers, Durable Objects,
database, relay VM or paid Cloudflare upgrade is required by this architecture.

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
