# AgentView on iPhone and the web

## Address migration

Host 0.4.2 uses `agentviewapp.hardline-labs.com` for pairing and QR links.
If you installed AgentView from `app.hardline-labs.com`, add the new address to
your Home Screen, open its new icon, pair again and enable notifications again.
Saved pairing, local drafts and push subscriptions do not transfer between origins;
workspace files and conversation history remain on Host.

The old web address temporarily redirects to the new one. Its `/api/pair/*`
endpoints remain on the same Worker and pairing directory for older hosts, whose
requests reject redirects. Keep those API routes until older hosts have updated;
the generic address can later become a PWA directory while preserving that route.
The scanner accepts QR links from either address during migration.

The PWA shares AgentView's React interface, graph and encrypted workspace protocol
with the Windows client. Its static deployment delivers application
files. Each phone pairs with its own Windows host; that host retains its vault,
repositories, agent sign-in and execution. There is no shared hosted agent account.

## Writing messages

The message draft sits in its own bubble above the attachment, model and send
controls. It starts at one line and grows toward Context as you type, then scrolls
inside the bubble when the available space is full. It adapts to the keyboard and
screen rotation. When Host accepts a send, the bubble floats into the conversation
and a fresh one expands in its place. Reduced-motion preferences skip this motion.
While delivery is pending the draft is read-only; failed or uncertain sends keep
it for recovery. This composer behavior is specific to the PWA.
While a message will steer a running agent, the draft and its send animation use
the same muted, dashed style as the pending message in chat. The draft returns to
its normal appearance when that agent finishes or when Queue is selected.

## Install and pair

1. Open [agentviewapp.hardline-labs.com](https://agentviewapp.hardline-labs.com) in Safari on iPhone.
2. Open Share (sometimes under the ••• menu), select **Add to Home Screen**, keep
   **Open as Web App** enabled if shown, and tap **Add**.
3. Open AgentView from its new icon before pairing. Browser tabs and installed apps
   may have separate storage on iOS.
4. On your computer, run AgentView Host 0.4.1 or later for code pairing, select your vault and
   configure [Remote access](remote-access.md). Choose **Pair device**.
5. Enter the six-digit code in the PWA and choose **Connect to workspace**.
   No camera or host-address entry is required. Spaces and leading zeroes work.
   Codes last five minutes and pair one device. An optional QR fills the code;
   full invitations remain under **Have an older invitation or QR?**.

If an older invitation says to enable Remote access, it contains no remote
endpoint. Create a new code after configuring and restarting Host. Host now
checks public reachability before issuing codes. The phone shows progress as soon
as Connect is pressed and reports blocked/unavailable browser storage with a
bounded timeout. Close other AgentView tabs and retry if storage is blocked.

The same site works on Android and desktop browsers. Supporting browsers offer an
**Install app** prompt. No App Store account or native client reinstall is needed.

## Connection and device storage

With Host 0.4.3-dev.3 or later, each chat has an **Auto-approve** toggle. Full access
must be selected in Workspace settings, and the conversation must belong to
AgentView. Enabling accepts supported command, file-change and permission requests
for that chat even while your phone is away. Questions and sign-in flows still
come to you. The choice is saved on Host; new chats start with it off. See
[approval behavior](host-operation.md#permissions-and-computer-use) for its scope
and recent activity record.

The PWA uses the host's publicly trusted WSS endpoint, even on the same Wi-Fi.
Browser JavaScript cannot implement native certificate pinning for AgentView's
self-signed LAN certificate. It never disables certificate verification. Each
person must configure their own reachable endpoint; serving the PWA does not
automatically provision remote access for a new computer.

Pairing retains the existing per-device proof and end-to-end encryption. The host
can revoke one phone without affecting other devices. Every paired device has full
access to that host's workspace.

Saved pairing is encrypted in IndexedDB with a non-exportable Web Crypto key.
This is browser-origin protection, not an OS keychain promise:
code running on the app's origin can use that key. Use a trusted device. Clearing
website data removes pairing; create a fresh invitation afterward. **Disconnect &
change host** clears this browser's saved pairing, drafts, attachment previews and
outgoing receipts. Remove the
old device from Host as well if you want to revoke its credential.

Workspace snapshots and conversations are not saved in the service-worker cache.
Only the app shell, fonts and icons are cached. An offline shell cannot read live
workspace content or run an agent. Returning to the app reconnects and refreshes
the workspace; running work continues on the computer while the phone is away.
Text drafts, uploaded attachment references/previews, outgoing action receipts and
the selected chat are saved in encrypted IndexedDB, bound to the paired host.
Ordinary reloads restore them. Browser storage can still be cleared or evicted.

## Workspace controls

With Host 0.4, **Workspace settings → Host** saves the default permission mode,
checks actual runtime capabilities and provides reconnection controls. See
[host operation](host-operation.md) for Full Access and Windows elevation.
**Onboarding** saves your default instructions. **Onboard agent** appears only in
an empty conversation and sends those instructions using the selected workspace
and model; sending the first message removes it.

Use **Rename** in a conversation or **Select conversations** in the drawer to
archive, restore or permanently delete several chats. Active chats are protected;
partial failures retain the failed selection. Terminal and Agent workspace appear
as compact nodes below the brain network, without note links. Drag either station
independently to place it; its position lasts while the graph is open. They scale
with the notes during zoom, and Fit includes both stations. Tap a busy station to
open its active conversation.

Attach images or files from the composer. Images are converted on the device to
JPEG with a longest edge of 2,048 pixels; unsupported image decoding reports an
error. Up to eight attachments of 6 MiB each are uploaded over the paired encrypted
connection. Attachment previews and text survive reload. **Files** browses known
workspaces with text/image previews and downloads. **Queue** lists follow-ups sent
with the composer's queue option while an agent works.

**Inbox → Enable notifications** asks for browser permission. On iPhone this needs
the installed Home Screen app with Web Push support. The Host sends generic
completion/input notices through the browser's push provider; message content and
workspace files are omitted. Tapping a notification opens its conversation.
The PC and network Host must be online. Delivery is best effort; inbox/history
remain available without push. **Disable notifications** removes this subscription.

## Screen, scrolling and keyboard

The browser shell fills the visible screen, including in Home Screen mode, with
space for the iPhone's notch and home indicator. Chat, the conversation drawer and
dialogs scroll within their own boundaries. Reaching the end of a conversation
does not scroll the app into blank space; code blocks still allow sideways reading
without trapping vertical chat scrolling.

An installed app sizes its document and measures its baseline with explicit `100vh`,
instead of percentage heights or stretching a fixed frame between top and bottom.
Browser tabs continue using the dynamic viewport to respect Safari's toolbars. Header and composer
surfaces extend into the safe areas, while their controls clear the notch and home
indicator. Bottom spacing uses the larger of the normal margin and the safe inset,
instead of adding both. While editing,
the visual viewport resizes the shell and its dialogs above the keyboard. Focus
transitions are followed briefly to handle delayed Safari geometry before the first
keystroke, without preserving stale offsets after a picker or app switch. Model and
effort choices open inside the app. Short screens use compact controls. When reading
the latest messages, chat stays at the bottom as the keyboard changes; when reading
older messages, it keeps that position. Long drafts and attachment lists scroll
within bounded composer areas. The composer starts at one line and grows with the
draft. A thin **Context** meter expands on tap to show token counts and guidance.
Pinch zoom remains available.

During brief app switches or reconnects, the browser keeps the last known messages
visible and shows a small **Updating** indicator above the composer while refreshing.
Up to five recently opened conversations share a 4 MiB estimated content budget
in memory for the current session. Larger conversations remain readable while open
but are not retained in that recent-chat cache. Transcripts are not written to browser
storage. A cold reload or an app discarded by iOS still retrieves history from Host.

Long conversations render a moving window of individual messages and tool calls,
including when most of the work happened in one turn. Scroll upward and use
**Earlier messages** to read older history. Tool output enters the page when its
details are expanded; expansion is remembered while the chat remains open.
Typing does not rerender unchanged messages, and streamed updates are grouped by
animation frame. These browser optimizations do not change Host history or the
Windows client. Browser Find and text selection only cover currently mounted
messages in a long chat; use Copy on a visible message to copy its full text.

If a new conversation's saved history is still being written, the accepted turn
stays visible with **Loading saved history** until it can be read. Sending does
not reset the selected model or effort. Steering messages appear immediately in a
muted pending style, then become ordinary messages when the runtime reports the
input. **Waiting for agent** indicates queued input, not a read receipt.

WebKit has [reported viewport-height errors](https://bugs.webkit.org/show_bug.cgi?id=254868)
in installed apps that exclude safe areas from some height measurements. Applying
safe-area padding inside an already reduced height leaves unnecessary space.
The explicit standalone baseline avoids relying on an inset-reduced fixed frame.
This workaround still requires physical iPhone validation. The PWA already requests
`viewport-fit=cover` and a translucent status bar, following
[Apple's safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
Some iOS versions also have a separate [system-owned status-strip bug](https://bugs.webkit.org/show_bug.cgi?id=301994).
CSS cannot draw outside the viewport iOS grants the app; forcing `screen.height`
would put controls offscreen. The system clock and home indicator are not hidden.

## Rendering and battery use

The browser brain uses flat, subdued domain-colored nodes on a near-black surface.
Agent travel, animated connections, file-change pulses, dragging and zoom remain
live. A settled network is cached at the display's native pixel density while
agents animate over it; labels and links are rebuilt only when their scene changes.
Metadata-only graph refreshes retain the existing layout instead of reheating it.
The canvas and force simulation stop when the phone shows chat or the app is in
the background. A visible, idle brain stops drawing after layout and pulses settle.
Input, graph updates, foreground return, resize, font loading and display-density
changes wake it again. Returning to the same-sized view preserves pan and zoom.

Camera QR decoding loads only when the scanner opens. The install cache includes
that optional module for offline use, but excludes duplicate legacy WOFF fonts;
supported browsers use the same fonts in WOFF2. Connection suspension, encrypted
draft storage, update checks and notification behavior are unchanged.

The energy regression uses 160 notes, 620 links and three synthetic agents through
the encrypted Host. It compares idle brain, active brain, phone chat and background
states, checks layout retention and wake-up, and records three 3-second samples per
state. Run with `AGENTVIEW_PWA_ENERGY_ONLY=1` and `npm run pwa:smoke`; it also runs
in the full suite. `AGENTVIEW_PWA_CAPTURES` saves screenshots and measurement JSON.
`AGENTVIEW_ENERGY_BASELINE=1` permits the old continuous-rendering behavior when
measuring an earlier client build; set `AGENTVIEW_PWA_BUILD` to that checkout's
`dist/client` directory. Baselines allow 60 seconds for slow software-rendered
layouts to settle; current clients must become idle within 45 seconds.
Canvas work and Chromium main-thread time are
performance/battery-cost proxies on the test workstation, not measured phone
battery life. Physical iPhone validation remains separate.

## Updates

The app checks for updates when opened, returned to the foreground, brought online
and periodically while visible. **Update & reload** first saves an encrypted,
short-lived copy of the current text drafts and selected conversation, then loads
the complete new build. Restoration is bound to the paired host, consumed once,
and expires after ten minutes. The durable draft store also handles ordinary reloads. Finish a
pending request before updating. UI-only releases need no host update; changes to
host capabilities still require a compatible host release.

## Build and validate

```powershell
npm ci
npm run check
npm run pwa:build
npx playwright install chromium webkit
npm run pwa:smoke
```

`npm run pwa:dev` serves the browser target locally. `pwa:build` emits only public
client assets into `dist/client`, including a content-versioned service worker and
install icons. Cloudflare Workers Static Assets serves the `hardline-agentview`
application at `agentviewapp.hardline-labs.com`; source is in this public repository.
To publish, build and validate the intended revision, sign into Wrangler for the
owning Cloudflare account, then run `npx wrangler deploy`. The tracked
`wrangler.jsonc` publishes the complete static build plus the six-digit pairing
directory at `/api/pair/*`. Keep the same custom domain and SQLite binding when
updating; an assets-only dashboard upload would remove code pairing. Static files
remain separately cached; pairing API responses are never cached. See
[remote access](remote-access.md) for the directory's trust and expiry boundaries.
Verify the public-path check below after publishing.

Never copy host settings, pairing invitations or tunnel credentials
into the web output. Browser-origin storage depends on keeping the deployment URL
stable; changing origins requires pairing again.

The smoke check uses ephemeral vaults and actual host TLS/encrypted WebSockets;
only the agent runtime is a deterministic fixture. Its certificate exemption is
restricted to the local fixture, never production. Chromium and WebKit checks
cover pairing, host separation, graph/chat interaction, reconnect, saved-device
recovery and revocation. Layout stress checks exercise empty-input focus before
typing, delayed visual-viewport geometry, scrolling past both ends of long and
empty chats, wide code blocks, growing/shrinking drafts, repeated model/effort choices,
slow reconnects with messages retained, repeated drawer/settings/brain changes,
search, small screens and rotation. Installed-mode checks include nonzero safe insets,
a shortened fixed frame and a web viewport smaller than the screen. The fixed-frame
fixture asserts that its bottom offset applies, so production selector specificity
cannot silently disable the regression condition.
Synthetic keyboard geometry changes separately
from the layout viewport; it is a regression test, not a real iOS keyboard.
Chromium uses wheel input to check scroll routing; mobile WebKit checks DOM scroll
geometry because Playwright cannot inject wheel input in that mode.
Chromium additionally exercises camera-frame QR decoding,
offline shell and update/draft recovery. These do not establish physical iPhone
camera, keyboard, installation or cellular behavior; verify those on an iPhone.

The long-conversation regression uses 1,200 items in one turn and checks mounted
message counts, input-to-frame timing against an empty chat, expanded tools, history pagination and
scrolling during streamed output in both browsers. Run it alone with
`AGENTVIEW_PWA_PERFORMANCE_ONLY=1` and `npm run pwa:smoke`; it also runs in the full
suite. Measurements describe the test computer, not physical iPhone performance.

The full suite also exercises chat auto-approval through the encrypted Host API
in Chromium and WebKit: pending approvals, command/file/permission responses,
questions remaining manual, isolation, an absent client, reload, permission-mode
pause and opt-out. `tests/auto-approve.test.ts` additionally verifies saved settings
across Host replacement and concurrent client changes. The runtime requests in
these checks are synthetic and never touch creator conversations.
Set `AGENTVIEW_PWA_BROWSER=chromium` or `webkit` to repeat one browser's full suite.

For a public-path check, install `cloudflared`, set `AGENTVIEW_PWA_URL` to the
published HTTPS client and run `npm run pwa:remote-smoke`. This starts a temporary
Cloudflare quick tunnel to an isolated synthetic vault, validates the origin with
its generated CA certificate, and checks both browsers with normal public TLS
validation. It closes the tunnel and removes the fixture afterward. It does not
use the developer's running host, vault or agent account.

If the test computer's DNS cannot resolve `trycloudflare.com`, setting
`AGENTVIEW_TEST_DNS=1.1.1.1` enables a Chromium-only diagnostic run. It resolves
only the temporary test hostname through that resolver and maps it inside the
test browser; public hostname/certificate checks remain enabled. This does not
change Windows networking or establish a successful public WebKit test.
