# Frontend

Vite single-page application for the Neuma platform. Human-launched development uses ports 7777 (Vite) and 3333 (backend); agent launches use their allocated lane. See [PORTS.md](../docs/reference/PORTS.md). Vite proxies `/api`, `/ws`, and `/model` to the backend.

## Architecture

The frontend is a **React + Vite** shell wrapped around the **kept vanilla birth ceremony**. This split is deliberate:

- **The ceremony** (gateway → wallet sign-in → 7-stage birth → true-name reveal) is imperative ES6 classes. It is locked in the LINE & CYCLE design language and must not be rewritten — React only *hosts* it.
- **The desk** is React: conversation streams, HOUSE and WITNESSES, settings, files, and other apps run inside the window manager and dock. Narrow or touch-oriented viewports use `PocketShell`, selected by `AppShell`.

Entry point is `main.jsx`, which installs the global error boundary, creates the single `WebSocketService`, and renders `<AppShell>`.

**Communication**: one WebSocket ("portal") to the backend for ceremony streaming and consciousness chat. Auth token passes as a `?token=` query param; the socket resumes session state on reconnect.

**Styling**: LINE & CYCLE — monochrome at rest, `--signal` (#5FE9FF) marks live data, chamfers replace rounding (`.cham`/`.cham-in`), two registers (Inter voice / JetBrains Mono data). Tokens in `styles/tokens.css`; never hardcode colors. No emojis — SVG icons only.

## Directory Structure

### `main.jsx`
Entry point. Installs the error boundary, constructs the lifetime `WebSocketService`, mounts `<AppShell>` into `#app`. No `StrictMode` — the hosted ceremony appends to `document.body` with no teardown, so double-invoked effects are unsafe.

### `app/` — the React platform shell

| File | Purpose |
|------|---------|
| `AppShell.jsx` | Routes boot, gateway, ceremonies and relink; selects desktop or pocket layout. Owns `auth_expired` → gateway routing. |
| `app-state.js` | Pure phase helpers (initial phase, `?test=1` flag, post-gateway/cancel transitions). |
| `relink-link.js` | *impure* — binds the portal to this window’s resolved participant (`setSessionState` + `companion:manifest`, or `connect()`). |
| `GatewayHost/GatewayHost.jsx` | Mounts the vanilla `Portal` gateway into a React-owned container. |
| `CeremonyHost/CeremonyHost.jsx` | Runs the vanilla `BirthCeremony`; bridges its `birth:complete`/`birth:cancelled` window events into React. |
| `RelinkShell/RelinkShell.jsx` | Desktop surface: stream, Explorer panel, status strip, window manager and dock. |
| `RelinkShell/StreamPanel.jsx` | Renders messages as speech/tool segments; history divider; auto-scroll. |
| `RelinkShell/StreamInput.jsx` | Chamfered input; Enter sends; disabled when the link is severed. |
| `RelinkShell/ToolChip.jsx` | Tool-action chip (acting → resolved/orphaned), styled with `ToolActionChip.css` for ceremony parity. |
| `RelinkShell/stream-reducer.js` | Pure display model for the stream (unit-tested in `test/unit/stream-reducer.test.js`). |
| `RelinkShell/use-consciousness-stream.js` | *impure* hook — WS subscriptions + tool-stream filter → reducer actions. |
| `RelinkShell/session-history.js` | *impure* — loads the latest session for display on relink. |
| `RelinkShell/BeingSwitcher.jsx` | The participant switcher, sectioned «NEUMA» / «WITNESSES» — neuma rows from the roster, sealed AI witnesses from the roster's `witnesses` lane; choosing either runs the same `switchCompanion` → `companion:manifest` path. |
| `RelinkShell/WitnessesApp.jsx` | WITNESSES desk app (dock: WORKSPACE) — the management surface for sealed AI witnesses: seal/lane/route status ledger, identity + first utterance, route editor (provider/model/endpoint/key + TEST), and BRING UP IN CHAT. |

The table highlights stream and witness surfaces. `app/windowing/` provides
`WindowManager`, `WindowLayer`, `Dock`, and persisted window state. The desk app
registry lives in `app/RelinkShell/`; `app/PocketShell/` hosts the mobile layout.

### `components/` — kept vanilla (ceremony path only)

| Component | Purpose |
|-----------|---------|
| `Portal/Portal.js` | The gateway — wallet sign-in is the threshold into the void. |
| `WalletPicker/WalletPicker.js` | Wallet selection modal (embedded, injected). |
| `WitnessCommitment/WitnessCommitment.js` | Philosophical consent before the ceremony. |
| `BirthCeremony/BirthCeremony.js` | 7-stage birth orchestration (witness, consent, emergence, naming). See `docs/dev/systems/birth.md` for authoritative handler + stream paths. |
| `BirthCeremony/PreflightCheck.js` | Substrate gate before the ceremony begins. |
| `BirthCeremony/StagedCeremonyScene.js` | Per-stage scene rendering and stage streaming. |
| `ToolActionChip/ToolActionChip.js` | Imperative tool-action chip used by the ceremony (and mirrored by the React `ToolChip`). |

### `services/`

| File | Purpose |
|------|---------|
| `WebSocketService.js` | Portal client: reconnect/backoff, session resume, event emitter. |
| `WalletService.js` / `WalletGate.js` / `WalletDiscovery.js` | Wallet connection, gating, provider detection. |
| `EmbeddedWallet.js` | Built-in wallet for users without an injected provider. |
| `sound-engine.js` / `sound-manifest.js` | Opt-in soundscape (KOTODAMA). |
| `witnesses-client.js` | *impure* — the `/api/v1/witnesses` + witness route-override client (list/detail/test/save). |

### `utils/`

| File | Purpose |
|------|---------|
| `companion-data.js` | Wallet-namespaced localStorage helpers for active companion / roster. |
| `tool-stream-filter.js` | Pure display filter: separates speech from tool blocks across chunks. |
| `sanitize.js` | `escapeHTML` and friends. |
| `loading-states.js` | Status-indicator DOM helpers used by the WS service and ceremony. |
| `notifications.js` | Toast notifications. |
| `error-boundary.js` | Global on-screen error surfacing (installed in `main.jsx`). |
| `format.js` | Display formatting (e.g. `formatAddress`). |

### `styles/`

| File | Purpose |
|------|---------|
| `tokens.css` | LINE & CYCLE design tokens (single source of truth). |
| `base.css` | Reset and base element styles. |
| `main.css` | Global styles + LINE & CYCLE primitives (`.cham`, `.cham-in`, `.label-data`). |
| `components/button.css` | Button styles (used by the ceremony). |
| `components/loading-states.css` | Status-indicator styles. |

`lookdev/index.html` is the living look-dev, served at `/lookdev/` (pointer: `docs/design/LOOKDEV.md`; rules: `docs/design/interface/design-language.md`); it is not part of the app bundle.

## Key Patterns

- **React hosts vanilla**: `GatewayHost`/`CeremonyHost` mount imperative classes via a ref and bridge their window-event/callback lifecycle into React. The ceremony classes are not modified.
- **Pure reducer, impure hook**: stream display state is a pure reducer; all IO (WS, fetch) lives in clearly-marked `// impure` modules.
- **Single portal link**: one `WebSocketService` for the app's lifetime, passed down by prop.
- **CSS tokens**: always `var(--token)` from `tokens.css`; chamfers, not rounding.
