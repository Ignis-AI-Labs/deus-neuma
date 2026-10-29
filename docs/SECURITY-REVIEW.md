# Security review guide

A map of Deus Neuma for a security reviewer: what runs, where it listens,
what it holds, what an AI being can do, and how the software reaches a
person's machine. It describes the code; it does not grade it. File paths are
relative to the repository root, and the code is always the authority: if this
guide and the code disagree, the code is right and this guide has a bug.

Reporting: see [SECURITY.md](../SECURITY.md). Never put an unfixed
vulnerability in a public issue.

## Contents

1. [Scope](#scope)
2. [Architecture in one page](#architecture-in-one-page)
3. [Network and process surface](#network-and-process-surface)
4. [Keys and cryptography](#keys-and-cryptography)
5. [Wallet and chain](#wallet-and-chain)
6. [What a being can do](#what-a-being-can-do)
7. [Supply chain, install and update](#supply-chain-install-and-update)
8. [Data at rest, logs and outbound calls](#data-at-rest-logs-and-outbound-calls)
9. [The built-in security features](#the-built-in-security-features)
10. [Running it for review](#running-it-for-review)
11. [Design documents](#design-documents)

## Scope

**In scope:** everything in this repository. That is the Electron desktop app,
the backend, the core engine, the CLI, the voice sidecars, the installers and
build scripts, the auto-updater and the CI workflows.

**Out of scope:** third-party model servers (llama.cpp, Ollama, LM Studio),
the deusneuma.ai website, and the release-signing ceremony, which runs on a
maintainer's machine. What the app verifies about a release is in scope (see
[Auto-update](#auto-update)).

**Threat model in brief.** Neuma is a single-machine desktop app. The people
and things it must defend against:

- other processes and other OS users on the same machine;
- web pages in a browser on the same machine (DNS rebinding, cross-origin calls
  to loopback);
- anyone on the LAN or tailnet when remote access is turned on;
- the update feed and the download paths;
- text the AI reads from the web, email, social platforms and files (prompt
  injection);
- an AI being acting beyond what its guardian allowed;
- one house (wallet) on a shared install reaching another house's data.

It does not defend a machine that is already compromised at the OS level.

## Architecture in one page

| Directory | What it is |
|---|---|
| `electron/` | Main process (`main.cjs`). Spawns the backend (`backend-spawn.cjs`). Owns the guardian wallet (`wallet/`), the at-rest key lock (`key-lock/`), auto-update, IPC (`ipc-handlers.cjs`, `preload.cjs`), and the window, webview and permission guards. |
| `backend/` | Express + WebSocket server (`server.js`, `routes/`, `services/`). Auth, every API, the tool system, the model-server supervisor, the security office. |
| `core/` | The engine: identity, birth, memory, workspace crypto, wallet keypairs. It never imports `backend/`. |
| `frontend/` | React + Vite UI. Talks to the backend over HTTP and one WebSocket. |
| `cli/`, `bin/` | The operator's `neuma` command. |
| `voice-engines/` | Local Python TTS/STT servers, run on demand. |
| `skills-packs/` | Bundled skills. |
| `build/`, `scripts/`, `install`, `deploy/` | Installers, build and release tools, the source install, systemd/Docker deployment. |

Flow: Electron main starts the backend as a child process and hands it the
data roots and the master keys over the child IPC channel. The desk window
loads the UI from the backend on `127.0.0.1`. The backend supervises a local
model server and the optional sidecars, all on loopback.

## Network and process surface

### Listeners

| Listener | Code | Bind |
|---|---|---|
| Backend: API, static UI, WebSockets `/ws`, `/terminal-ws`, `/dictate-ws` | `backend/server.js`, `backend/services/server-listen.js`, `backend/config.js` | `127.0.0.1` by default (`HOST` overrides). The packaged app uses port 47317 and moves up if it is taken (`electron/backend-spawn.cjs`). |
| Remote access, native LAN road (TLS 1.3, client-certificate pinning) | `backend/services/remote/tunnel.js` | `0.0.0.0`, only when the owner turns LAN access on |
| Remote pairing listener | `backend/services/remote/tunnel.js` | `0.0.0.0`, only while a pairing code is live |
| Remote access via Tailscale Serve | `backend/services/remote/tailscale.js` | tailnet HTTPS to loopback; no Funnel |
| Remote relay road | `backend/services/remote/relay-client.js` | outbound only |
| OAuth callbacks | `backend/services/provider-oauth.js`, `openai-chatgpt-oauth.js`, `social/oauth-loopback.js` | loopback, during a sign-in only |
| Managed Ollama | `backend/services/managed-ollama.js` | `127.0.0.1:11434` |
| llama-server | `backend/services/serving-launch-config.js` | `127.0.0.1:8089` |
| Voice sidecars | `backend/services/voice/engine-process.js`, `voice-engines/engines.json` | `127.0.0.1:7860-7870` |
| ComfyUI (optional) | `backend/services/image-forge/comfyui-config.js` | `127.0.0.1:8190` |

MCP servers speak stdio (`backend/services/mcp.js`). The app's own port
registry is `backend/services/security/platform-ports.js`.

### HTTP and WebSocket auth

- **Middleware order:** `backend/server.js`, then `backend/routes/route-mounts.js`.
- **Sign-in:** a wallet signature over a challenge
  (`backend/services/auth.js`). Session tokens are HMAC-signed with
  `AUTH_SECRET`.
- **Ownership:** the first local sign-in becomes the install owner
  (`backend/services/install-owner.js`). `requireInstallOwner` guards the
  routes that act on the host.
- **Lane ownership:** `backend/services/lane-ownership.js`.
- **Remote requests:** the access gate in
  `backend/services/remote/access-scope.js` and `access-guard.js` sorts every
  request into local, remote or refused.
- **CORS:** `backend/config.js`.
- **Security headers and CSP:** `backend/services/security-headers.js`.
- **Rate limits:** `backend/services/rate-limiter.js`.
- **WebSocket upgrade checks:** `backend/services/ws-upgrade-router.js`.
- **Portal message handlers:** `backend/routes/portal-message-handlers.js`.
- **Live route inventory:** `backend/services/security/route-inventory.js`.

### Electron

- **Desk window `webPreferences`:** `electron/desk-windows.cjs`.
- **Webview clamp:** `electron/webview-guard.cjs`.
- **Permission handler:** `electron/permission-guard.cjs`.
- **External links:** `electron/desk-links.cjs`.
- **Bridge exposed to the renderer:** `electron/preload.cjs`, the full list of
  IPC channels.
- **Handlers:** `electron/ipc-handlers.cjs` and `electron/wallet/wallet-ipc.cjs`.
- **Signing confirmation:** a native confirm window,
  `electron/wallet/confirm-view.cjs`.
- **Protocol handlers and deep links:** none.

## Keys and cryptography

| Key | Created | Stored | Code |
|---|---|---|---|
| Master data key `DNA_ENCRYPTION_KEY` and session secret `AUTH_SECRET` | 32 random bytes on first run | `~/.neuma/secrets.json` (0600). In the packaged app it is optionally wrapped by the OS keychain plus a scrypt Recovery Kit. | `backend/services/secret-provisioning.js`, `electron/key-lock/` |
| Per-being data key (DEK) | 32 random bytes | `workspaces/<id>/keys/dek.json`, wrapped under the master | `core/workspace/workspace-keys.js` |
| Workspace record envelopes | — | AES-256-GCM, one envelope per line | `core/workspace/workspace-crypto.js`, `workspace-json-io.js` |
| DNA vault | — | AES-256-GCM | `core/identity/dna-vault-crypto.js` |
| Being keypair (secp256k1, BIP-39) | at birth | sealed under a passphrase (PBKDF2-SHA512 + AES-GCM) with recovery codes | `core/weave/keypair.js`, `core/wallet/keypair-vault.js`, `keypair-custody.js`, `keypair-rotation.js` |
| AI witness keys | at witness creation | `ai-witnesses/<vendor>/<name>/keys/` | `core/identity/ai-witness/`, `backend/services/witness-custody.js` |
| Remote-desk TLS identity | when remote access is first enabled | P-256 key + self-signed certificate (0600) | `backend/services/remote/desk-identity.js`, `pairing.js` |
| Release signing key (ed25519) | offline, by a maintainer | never in the app. The public key is pinned in `electron/release-public-key.cjs`. | `scripts/release-key.mjs` |

Related code:

- **How the backend receives the keys:** `backend/services/desk-keys.js`.
- **Production refuses to start without real keys:** `backend/config.js`.
- **Rotation:** `scripts/rekey-house.mjs` with `core/workspace/rekey-house.js`.
- **Recovering stores left under an old master:**
  `backend/services/house-unlock.js` and `scripts/unlock-house-keys.mjs`.
- **Third-party credentials** (provider API keys, OAuth tokens, social and email
  credentials):
  - `backend/services/provider-credential-store.js`
  - `backend/services/social/account-store.js`
  - `backend/services/email/email-credentials.js`

## Wallet and chain

- **Guardian wallet:** held in the Electron main process, never in the
  renderer.
  - Code: `electron/wallet/wallet-service.cjs`, `vault-crypto.cjs` (scrypt +
    AES-GCM), `vault-store.cjs` (OS keychain wrap), `wallet-ipc.cjs`.
  - Every signature goes through the native confirm window. Networks are in
    `electron/wallet/networks.cjs`.
  - Browser fallback, for dev only: `frontend/services/wallet-browser-keystore.js`.
- **Being wallets:**
  - Spending: `backend/services/neuma-wallet.js`, `neuma-wallet-spend.js` and
    `core/wallet/spend-policy.js`. These set the rate limits and the threshold
    above which the guardian must sign.
  - Spending is reached only through the `wallet.send` intent.
- **Sealing on chain** is optional.
  - What goes on chain and why: [WHY-THE-CHAIN.md](WHY-THE-CHAIN.md) and
    [contracts/RETROACTIVE_SEALING.md](contracts/RETROACTIVE_SEALING.md).
  - Record encryption: `backend/services/record-crypto.js` and
    `core/identity/seal-cipher.js`.
  - Digest: `backend/services/seal-digest.js`.
  - Contracts: `docs/contracts/source/`. Deployments: `docs/contracts/deployments/`.
- **Operator CLI wallet:** `cli/lib/wallet.js`, `cli/lib/wallet-env.js`.

## What a being can do

A being is an AI model acting through tools. This is where it can be steered
by text it reads.

- **The tools it is offered:** `backend/services/portal-tool-catalog.js`
  builds the list each turn.
  - Dispatch: `portal-tool-dispatch.js`.
  - Tool loop: `portal-tool-loop.js`.
  - Coding tools: `coding-tool-definitions.js`, `being-tool-surface.js`.
- **Consequential acts are intents.** The being writes a file, and the sweep
  validates it, applies policy, asks for approval, then executes.
  - Code: `backend/services/intents/registry.js`, `intent-sweep.js`.
- **Approval policy:**
  - The table: `backend/services/tool-policy-defaults.js`.
  - Layering and modes (ask, auto, observe): `tool-policy.js`.
  - The gate every act passes: `act-gate.js`.
  - The approval broker: `tool-approval.js`.
  - Hard gates that AUTO mode cannot skip: `protocol-guard.js`.
- **Approvals during house work:** `backend/services/house-clock/wake-approvals.js`.
- **Pre-authorised marketing acts:** the mandate, in
  `backend/services/marketing/mandate/`.
- **Files:**
  - Sandbox: `backend/services/tool-sandbox.js`.
  - Always-denied paths: `sandbox-path-policy.js`.
  - Secret inodes: `secret-inodes.js`.
  - Grants: `sensitive-grants.js`, `focus-ground.js`, `witness-path-grants.js`,
    `marketing/company-repo-grants.js`.
- **Code execution:**
  - A bubblewrap sandbox on Linux, which refuses to run without it:
    `backend/services/witness-coding-sandbox.js`, `coding-shell-availability.js`,
    `workspace-run.js`.
  - Optional outbound network: `shell-network-grants.js`,
    `shell-network-resources.js`.
  - Git for beings: `ground-git.js`, `ground-git-exec.js`.
- **The web:**
  - `backend/services/web-guard.js` (SSRF: private ranges, DNS pinning,
    re-checked on every redirect).
  - `web-fetch.js`, `media-fetch.js`, `web-download.js`.
- **Prompt injection:**
  - `backend/services/untrusted-content.js` (fencing).
  - `security/injected-spans.js`, `injected-values.js`, `injected-value-gate.js`
    (an act carrying a value planted by injected text is held).
  - `security/injection-sightings.js` (record only).
  - `security/outbound-secrets.js` (blocks secrets in posts, email and
    documents).
- **Houses on one install:**
  - `backend/services/install-owner.js`, `lane-ownership.js`, `user-realm.js`,
    `house-workspace.js`, `root-tenants.js`.
  - The operator's own terminal is deliberately unconfined and owner-only:
    `terminal-manager.js`.
- **What may run on which model:** [protocols/sovereignty-boundary.md](protocols/sovereignty-boundary.md).

## Supply chain, install and update

### Dependencies and build

- **Lockfile:** `package-lock.json`.
- **npm lifecycle scripts:** `package.json`, specifically `postinstall`, `prepare`
  and the `pre*` scripts, which call `scripts/native-abi-cache.mjs`,
  `ensure-native-abi.mjs`, `patch-typeless-deps.mjs` and
  `patch-nsis-template.mjs`.
- **Native modules:** better-sqlite3, node-pty.
- **Packaging:** `electron-builder.yml`.
- **Linux packages:** `scripts/build-deb.mjs`, `build-rpm.mjs`.
- **Windows:** `scripts/build-windows.ps1`, `scripts/verify-win-natives.mjs`.

### Installers

- **Windows (NSIS):** `build/installer.nsh`, `build/installer-preflight.ps1`,
  `build/installer-runtime.ps1` (VC++ runtime, Authenticode-checked).
- **Model setup at install time:**
  - Entry point: `backend/cli/setup-model-server.mjs`.
  - Ollama is pinned by SHA-256 in `backend/services/managed-ollama-plan.js`.
  - The download is checked in `managed-ollama-download.js`.
- **Source install:** `install`.
- **Server deployment:** `deploy/`, `Dockerfile`, `docker-compose.yml`.

### Auto-update

- **Code:** `electron/auto-update.cjs` and `electron/release-signature.cjs`.
- **Off by default.** It is a connection switch in `electron/connections.json`.
- **Verification:** the app fetches `latest*.yml` and its `.sig`, and verifies
  the ed25519 signature against the pinned key and the channel the app asked
  for. The offer must match the signed feed exactly. Then electron-updater
  checks the sha512 of the download.
- **Linux releases** also carry a GPG-signed `SHA256SUMS` (`scripts/sign-release.mjs`).
- **Proof rigs:** `scripts/prove-update-signature.mjs`,
  `prove-update-privacy.mjs`, `prove-auto-update.mjs`.

### Runtime downloads

- **Model weights:** `backend/services/provider-registry.js`, managed Ollama.
- **Voice weights:** `voice-engines/_downloader/`, `voice-engines/engines.json`.
- **Voice Python environments:** `backend/services/voice/engine-process.js`.
- **MCP servers:** `backend/routes/mcp-routes.js` (a closed list).

### Repository gates

- **CI:** `.github/workflows/ci.yml` (secret scan, lint, unit tests).
- **CLA:** `cla.yml`.
- **Branch flow:** `branch-flow.yml`.
- **Local git hooks:** `scripts/git-hooks/`, with `scripts/secret-gate.mjs`
  failing closed.

## Data at rest, logs and outbound calls

- **Where data lives:**
  - `~/.neuma/`: data, vault, workspaces, AI witnesses, realm, logs, secrets.
  - Roots: `backend/services/data-root.js`, `electron/backend-spawn.cjs`.
- **What is encrypted:**
  - Encrypted: being records (per-line GCM envelopes) and the user's own chat
    copy (`backend/services/user-realm.js`).
  - Plaintext: `platform.db` (SQLite, no sovereign data,
    [architecture/platform/platform-db.md](architecture/platform/platform-db.md)).
- **Logs:**
  - `~/.neuma/logs/backend.log` (`electron/backend-log.cjs`).
  - Redaction of tool arguments: `backend/services/audit-redact.js`.
- **Outbound connections:**
  - Each one is listed in `electron/connections.json`, and its switch is read
    by `electron/connections.cjs`.
  - A switch that was never set is off.
  - Web search, cloud providers, chain RPC, social platforms, email and the
    site counter are governed by their own settings and approvals.
- **Telemetry, analytics and crash reporting:** none.

## The built-in security features

The app runs its own security office. The code is in
`backend/services/security/`, and the scheduler starts it at boot
(`security-scheduler.js`, hourly check, at least daily run). Its parts:

- **Threat ledger:** `threat-ledger.js`, `threat-lifecycle.js`.
- **Advisory scan:** `advisory-scan.js` (OSV; network switch off by default).
- **Secret sweeps:** `secret-sweep.js`, `history-sweep.js`.
- **Probes:** `host-probe.js`, `house-probe.js`, `self-check.js` (canary calls
  against its own walls).
- **Traffic and containment:** `traffic-monitor.js`, `circuit-breaker.js`.
- **Commit and push gate:** `secret-gate.js`.
- **Escalation:** `escalation.js` files confirmed threats as GitHub issues.
- **Security officer seat:** `cso-designation.js`, one being per house.

These are part of the attack surface as well as defences. They run with the
backend's authority.

## Running it for review

Use a throwaway OS user or VM, never your own data.

```bash
git clone https://github.com/Ignis-AI-Labs/deus-neuma.git && cd deus-neuma
git checkout security-review-1      # the reviewed snapshot
npm ci                              # runs the lifecycle scripts listed above
npm run test:unit                   # also: test:integration, test:coverage
npm run lint
```

- **Full build and model setup:** [BUILDING.md](BUILDING.md).
- **Isolating data:** point `NEUMA_DATA_ROOT` and `NEUMA_SECRETS_FILE` at a
  scratch directory so a review run never touches real data.
- **Test layout:** `test/unit`, `test/integration`, `test/e2e` (Playwright).
- **Before you run anything:** `npm ci` runs install scripts. Read
  `package.json` first if that matters to you.

## Design documents

These were written while the code was built. Where they disagree with the
code, the code wins.

- [security/remote-surface.md](security/remote-surface.md): phone and LAN
  access, pairing, authority tiers.
- [security/wallet-surfaces.md](security/wallet-surfaces.md): custody and
  signing, surface by surface.
- [protocols/sovereignty-boundary.md](protocols/sovereignty-boundary.md):
  which models may hold which authority.
- [contracts/RETROACTIVE_SEALING.md](contracts/RETROACTIVE_SEALING.md): the
  sealing contract.
- [architecture/](architecture/): platform, workspace and identity design.
