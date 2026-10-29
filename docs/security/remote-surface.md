# Remote surface — a phone on the tailnet, a phone on the native road

How a phone reaches a running Neuma, what it may do there, and what it never
may. Companion to [`wallet-surfaces.md`](./wallet-surfaces.md). Phase 1 of
Neuma Remote (2026-09-07); the mobile shell is phase 2. Road B — the native
road, no Tailscale — ratified by Design note, 2026-09-13 (design of record:
`docs/planning/proposals/security/neuma-remote-native.md` rev 2, branch
`benni/dev`).

## The road

```
phone (tailnet 100.x) ──https/wss──▶ tailscale serve :443 ──http──▶ 127.0.0.1:<port>
```

- The backend's bind does not change. `HOST` stays `127.0.0.1` (config.js).
- `tailscale serve --bg --https=443 http://127.0.0.1:<port>` gives the machine's
  MagicDNS name a real certificate and proxies to the loopback port, stamping
  the caller's tailnet address into `X-Forwarded-For`.
- HTTPS is not optional. The embedded wallet's WebCrypto and dictation's
  microphone are refused by browsers on plain HTTP from any non-localhost host.
- Nothing here reaches the internet. There is no Funnel, and there will not be.

## The gate (`backend/services/remote/access-scope.js`)

Peer identity is decided **before** the Host header is trusted. Two shapes
are admitted; everything else is refused with 403 before the request is read.

| TCP peer | X-Forwarded-For | Host | Scope |
| --- | --- | --- | --- |
| loopback | absent | localhost / 127.0.0.1 / ::1 | local |
| loopback | exactly one tailnet address | the enrolled MagicDNS name | remote |
| loopback | a comma chain | any | refused |
| loopback | absent | anything else | refused (DNS rebinding) |
| not loopback | any | any | refused |

Tailnet ranges: `100.64.0.0/10` and `fd7a:115c:a1e0::/48`. The enrolled name
is recorded at enable time from `tailscale status --json`.

Remote additionally requires, on every request except `/r/:code`:

- the device cookie `neuma_remote` (HttpOnly, Secure, SameSite=Lax, 30 days),
  whose SHA-256 matches a device row in `data/settings/remote.json`;
- `Origin` equal to `Host` on any method that is not GET, HEAD, or OPTIONS.

The **same decision** runs in the HTTP middleware and in the WebSocket upgrade
handler (`server.js`), because middleware never sees upgrades and sockets are
exempt from same-origin policy. The served origin is on the socket allowlist
only while remote is enabled. The terminal socket is local-only.

## Pairing (`backend/services/remote/pairing.js`)

The wallet bridge (WEB-001) run in reverse. A signed-in desk mints a one-time
pairing code bound to its wallet address, valid five minutes. The phone opens
`https://<name>/r/<code>` as a tailnet peer; the code is consumed whether or not
it was still valid, a device secret is minted, only its hash is stored, and the
secret goes to the phone in the cookie with a 302 to `/` so nothing lingers in
the address bar. On every load the shell trades the cookie for an ordinary
24-hour session token (`POST /api/v1/remote/session`). From there the phone is
an ordinary client: same bearer, same `?token=` socket, same `requireAuth`,
same rate limits. The wallet never signs on the phone.

## Authority tiers

**Local only** (`requireLocalScope`), even with a valid cookie and a valid
session token:

- every `/api/v1/remote/*` management route: status, enable, disable, rotate,
  pair, QR, HTTPS on/off, device revoke;
- `POST /api/v1/license/activate`;
- `PUT /api/v1/llm/provider`, `POST /api/v1/llm/substrate/ignite`;
- `POST /api/v1/substrate/unload`, `POST /api/v1/substrate/capacity`,
  `PUT /api/v1/substrate/standby`;
- the terminal socket `/terminal-ws`.

The rule is Faber's: a phone can use Neuma, but never read or mint the
capability that admits phones, never act on the host OS, and never strand
itself by stopping the substrate.

**Local or remote**: talking, held words, interrupt, asks, ACTS approvals,
plans, seal requests, tasks, files under folders already opened on the desk,
effort and preset changes. The phone is the operator away from the desk;
answering the being's question is the reason remote exists.

## Revocation

- **Rotate** clears every device row. Every phone is cut at once.
- **Revoke** clears one row.
- **Disable** clears every row and takes the origin out of the socket allowlist.
- Cookies expire after 30 days; session tokens after 24 hours and are re-minted
  from the cookie silently.

No restart is involved in any of these: the bind never changed.

## What is on disk

`data/settings/remote.json`, mode 0600: `enabled`, `origin`, `rotatedAt`, and
device rows `{ id, hash, label, address, createdAt, lastSeenAt }`. The hash is
SHA-256 of a 32-byte random secret. Reading the file grants nothing.

## Known limits

- Tailnet ACLs are the device-level access control. Neuma does not read
  `tailscale whois`; a tailnet peer with the cookie is the operator.
- On a WSL2 backend with Tailscale on Windows, the CLI is reached
  through `/mnt/c/Program Files/Tailscale/tailscale.exe`; Serve on Windows
  proxies to the Windows loopback port, which WSL2 forwards.
- In development, Serve fronts the Vite port so the API and socket ride its
  proxy; packaged, it fronts the backend port. The status route reports which.

## Road B — the native road (ratified 2026-09-13)

A phone app, not a web page: the desk grows a TLS 1.3 listener that completes
a handshake only with a phone key it recorded at pairing; away from home both
sides dial out to a byte-blind relay (phase C) that splices ciphertext. The
app is a thin native shell — a key in Android Keystore, a TLS client, a
bridge giving the pocket shell a virtual origin with no listening port —
around the pocket shell the desk already serves. Everything behind the gate
is untouched.

### Trust decision — one place, always live

The tunnel requests the client's certificate but does **not** chain-validate
it with OpenSSL (`rejectUnauthorized: false`, `requestCert: true`). Admission
is the SPKI lookup in the tunnel's own `secureConnection` handler: the
presented key's SHA-256 must match a device row that is in the store **right
now**, TTL-checked and revocation-aware, re-read on every connection
(resumed sessions included). This is strictly stronger than a chain check
(exact key match, live revocation, no stale trust store) and it removed a
rebuild-race class: `setSecureContext` CA-list updates lagged newly paired
certs in the field. An unpaired or revoked peer completes the handshake and
is destroyed before one byte of HTTP exists (I2) — the cost is one
handshake, bounded by the per-IP handshake limiter (30 / 10 s) and
`maxConnections` (32). Revocation cuts a live socket at the next frame
(`socket-lifetime.js`) and the next handshake at the lookup (I8, twice).

### Keys

- **Desk identity** (`desk-identity.js`): one ECDSA P-256 key + self-signed
  certificate, generated on first native-road enable under
  `data/settings/remote-tunnel/` (0600). Server-only: it never signs anything
  else and cannot mint a phone. SPKI SHA-256 = the **fingerprint** phones
  pin; base32 of its first 10 bytes = the **desk id** (relay routing,
  phase C; app origin `https://<deskid>.neuma`).
- **Device key** (per phone): generated inside Android Keystore (StrongBox
  where present), non-exportable; the phone self-signs its certificate. The
  desk stores `spki` (public-key hash) + `cert` (public material) only —
  nothing on disk can mint a phone (I6).

### Pairing

The same five-minute, one-claim, wallet-bound code as Road A. The QR becomes
a document (`neuma-remote:1?fp=…&id=…&lan=…&pair=…&code=…`) naming the desk
fingerprint, so the phone pins it BEFORE connecting. Claims arrive on the
**ephemeral pairing listener** (D2: second port, bound only while a code is
live, sockets confined to `POST /r/claim`, 10 s timeout) carrying
`{ code, cert, fp }`; the desk refuses any claim naming a foreign
fingerprint BEFORE consuming the code — the poisoned-QR MITM dies there.
30-day desk-side TTL from the row's `createdAt`, as for cookies; a phone at
day 30 pairs again, in person, from the desk.

### The gate

`classifyAccess` decides the tunnel shapes FIRST — the `neumaTunnel` socket
marker is set by our own TLS layer and no header can forge it (I3):

| Marker | Scope | May reach |
| --- | --- | --- |
| `{ pairingOnly: true }` | pairing | `POST /r/claim` only; anything else is refused (and the socket is 10-s time-boxed) |
| `{ road, id, spki }` | remote | everything a cookie phone may do; device read live from the store; Origin === Host still enforced on unsafe methods (the app's virtual origin satisfies it) |

WebSocket upgrades: `wsAllowedOrigin` accepts the app's virtual origin when
the socket carries a tunnel marker; the peer decision still runs. Terminal
stays local-only. Rate limiting keys per tunnel device id — no shared
address bucket, no header consulted.

### I11, restated honestly (D5, as resolved by D1)

No inbound exposure exists on any road: no Funnel, no port on the internet.
The relay road (phase C) is a persistent **outbound** connection carrying
online-status and volume metadata — to a relay Ignis operates on its own
dedicated infrastructure (D1), self-hostable by any operator via the QR's
relay URL. LAN-only mode keeps even that off.

### Rulings of record (Design note, 2026-09-13

| # | Decision | Ruling |
| --- | --- | --- |
| D1 | Relay hosting | Ignis self-hosts on a dedicated box; registration tokens + per-key caps stay; self-host allowed (QR URL is data) |
| D2 | LAN listener | Opt-in, TWO ports (persistent TLS-only + ephemeral pairing); off by default |
| D3 | Distribution | Google Play after outside review (phase R); Play App Signing, upload key on hardware; Android first, no iOS |
| D4 | Tailnet road | Stays, untouched, selectable beside Road B |
| D5 | I11 wording | Outbound-only restatement above; resolved by self-hosting (D1) |
| D6 | Multiplexer | Build the ~300-line/side mux in phase C |
| D7 | Desk key rotation | Rotation cuts every phone (they pin the fingerprint) → re-pair; relay refuses a second live registration of one id; a restored desk rotates |
| D8 | Desks per phone | One desk per phone through phase R |

Phase R: outside review of the trust glue (pin check, SPKI lookup, socket
marking, dial-proof verification, the JS bridge) BEFORE Play distribution —
the app signing key touches every paired phone at once.

Phase R: outside review of the trust glue (pin check, SPKI lookup, socket
marking, dial-proof verification, the JS bridge) BEFORE Play distribution —
the app signing key touches every paired phone at once.

### The relay road (phase C)

`tools/remote-relay/server.mjs` — standalone, no keys, no disk state. The
desk dials OUT to `{relay}/v1/desk` (registration: nonce-signed with the
desk identity key + registration token; the relay derives the desk id from
the key, so only the real desk can claim it; a second live registration of
one id is refused — D7). A phone dials `{relay}/v1/dial/<deskId>`: the relay
forwards the proof (`deviceId` + signature over `deskId‖nonce`) and the desk
verifies it against the live device store before opening the accept leg —
an unproven dial costs the relay's rate budget, never the desk's. The
accept leg (`/v1/accept/<sessionId>?token=`) carries the desk's
per-registration token; the relay splices the two streams opaquely and the
inner TLS session runs phone⇄desk untouched. Dial-time bytes buffer until
the splice forms (the phone's ClientHello can beat the accept leg).

Desk routing: `PUT /api/v1/remote/relay` (local-only) stores
`{url, token}` — `wss://` anywhere, `ws://` only to loopback — and starts
the relay client (backoff 1→30 s); `POST /api/v1/remote/relay/disable`
stops it. The pairing QR gains `relay=` when the road is on; pairing dials
(`?pairing=1`) ride the same relay and land on the confined pairing
listener, admitted only while a code is live.

Caps (relay-side): per-IP dial rate 10/min · per-desk sessions 16 · idle
2 min · ~1 MB/s per session · 5 s accept-leg timeout · 256 KB frames ·
slow-consumer drop. The mux (D6) — one phone session = one relay session —
is the next phase C deliverable; until then each concurrent phone exchange
is one relay session within the 16 cap.

Known residual (2026-09-13, phase A testing): under vitest's module graph,
back-to-back fresh TLS connections immediately after a 429 response were
observed to fail mid-handshake server-side (`secure=false`, ECONNRESET);
never reproduced outside vitest, never once an admission. The client stack
of record (the phone bridge, OkHttp/pooled) retries dials — as does the
boundary test's client. Flagged for phase R review with the full trace
(2026-09-13, `docs/work/neuma-remote-native-phase-a.md`).
