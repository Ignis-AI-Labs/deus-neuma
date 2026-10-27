# Wallet security, surface by surface

NEUMA runs two ways off one local codebase: the **Electron desktop app** and a
**local browser** pointed at the operator's own backend. Each surface can hold
keys differently, and the differences are real. This document states the
trade-offs plainly so the choice is made with eyes open (WEB-001 / WL6).
Nothing here is marketing; every claim names the code that makes it true.

## The custody ladder

Strongest to weakest, for the key that signs as the operator:

### 1. Electron embedded wallet — main-process isolation

The private key lives in the Electron **main process**, never the renderer
(`electron/wallet/wallet-service.cjs`). The page that renders the app — the
part exposed to any UI bug or injected content — cannot read it; it can only
ask over IPC, and every signature request raises the trusted LINE & CYCLE
confirm window (`electron/wallet/confirm-window.cjs`, strict CSP + sender
guard) showing exactly what is being signed.

At rest the key is double-sealed (`vault-crypto.cjs`, `vault-store.cjs`,
`os-keyseal.cjs`):

- **Inner seal** — AES-256-GCM under a key derived from the operator password
  via **scrypt** at geth-standard parameters (N=2¹⁸, ~256 MiB memory-hard) —
  the same construction as the Ethereum keystore format.
- **Outer seal** — Electron `safeStorage`, i.e. the OS keychain (macOS
  Keychain / Windows DPAPI / libsecret), keyed to the app.

An attacker needs your OS account **and** your password. Renderer
compromise alone yields nothing. This is the strongest custody NEUMA offers.

### 2. Browser extension wallet (Rabby / MetaMask) — the extension's custody

Discovered via EIP-6963 (`frontend/services/WalletDiscovery.js`) in a real
browser, or from inside Electron via the **system-browser bridge**
(`/api/v1/auth/bridge/*` — the token never appears in a URL; the
URL-exposed code can only *associate* a session, retrieving it needs a
`pollSecret` that never leaves Electron).

Your key's safety is whatever your extension provides — typically strong,
audited, hardware-wallet capable, and outside NEUMA's process entirely. NEUMA
never sees the key, only signatures. The trade: custody quality is the
extension's, not ours to verify, and extensions live inside the browser's
attack surface (a compromised browser profile reaches the extension UI).

Good default if you already trust and use a hardware-backed extension wallet.

### 3. Browser embedded wallet — in-page custody (dev / e2e / low-stakes)

The fallback when neither of the above exists (`frontend/services/
EmbeddedWallet.js`): the key is generated in the page and stored in
`localStorage`, AES-256-GCM sealed under a PBKDF2-SHA-256 key (600k
iterations, the OWASP floor).

Honest limits: the unlocked key exists in **renderer memory**, the same
JavaScript context as the app UI — an XSS or malicious dependency in the page
could reach it while unlocked. There is no OS keychain layer, and PBKDF2 is
much cheaper to brute-force than scrypt. `sessionStorage`/`localStorage` are
also swept by "clear site data".

Use it for development, testing, and wallets whose loss you can absorb. Do
not hold meaningful value here. The app treats it as the last resort in the
picker order for exactly this reason.

## What is the same on every surface

- **Auth is challenge-sign-verify** (`backend/services/auth.js`): a 5-minute
  single-use challenge signed by your wallet mints a 24-hour HMAC session
  token. No password ever goes to the backend; no key ever leaves its custody
  layer.
- **Every signature is consented**: embedded custody raises an explicit
  confirm surface before `personal_sign` / `eth_sendTransaction`; extension
  custody raises the extension's own prompt.
- **The engine is local-first**: the backend, sovereign workspaces, and LLM
  stay on the operator's machine. Both surfaces are windows onto that local
  engine, not hosted copies of the data.

## Choosing

| You are… | Use |
| --- | --- |
| Running the desktop app with real value at stake | Electron embedded (main-process, double-sealed) or a hardware-backed extension via the bridge |
| In a browser you trust, already using Rabby/MetaMask | The extension (EIP-6963) |
| Developing, testing, or holding nothing of value | Browser embedded — knowingly |

If unsure: the Electron app's embedded wallet is the surface NEUMA can vouch
for end-to-end, because every layer of it is in this repository.
