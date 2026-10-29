# Platform DB

The **platform DB** records platform-level facts: witness accounts, the neuma
registry (who exists), birth ceremonies + their stage history, and the platform
audit log. It does **not** hold sovereign neuma data — DNA, soul, memories,
skills, journal all live in the file-based workspace (`core/workspace/neuma-workspace.js`),
encrypted at rest under per-neuma DEKs. The platform DB is the […] graph, not the beings themselves.

## Local-first by default

On a fresh machine with no third-party credentials, the platform DB runs on an
**embedded SQLite database** (`better-sqlite3`) — no external service, no signup,
nothing to configure. Platform records persist locally and survive restarts.

Supabase is an **optional** convenience upgrade for operators who want a hosted
Postgres backend (e.g. to share a registry across machines). It is used **only**
when both `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set and reachable. If the
Supabase probe fails at startup, the platform **falls back to local SQLite** and
logs the downgrade — you are never left without persistence.

### Driver selection (`backend/services/platform-db.js` → `init()`)

| Condition | Driver |
|---|---|
| `SUPABASE_URL` **and** `SUPABASE_SERVICE_KEY` set, probe succeeds | Supabase |
| Both set but probe fails | **SQLite** (downgrade logged) |
| Either unset (the default) | **SQLite** |

Before this change, a machine without Supabase credentials ran in "file-only
mode" where every platform method silently returned `null`/`[]` and **no platform
records persisted at all**. Local SQLite replaces that no-op with real, durable
local persistence.

## Where the database file lives

Default path:

```
<workspaces-root>/../platform/platform.db     (+ WAL sidecars)
```

It is a **sibling** of the workspaces directory — so it rides the same sovereign
mount/home (and backs up atomically with the workspaces it describes), but sits
outside the directory that `listNeuma()` scans, so it never leaks into the neuma
registry enumeration. The dev default resolves to `<repo>/platform/` (gitignored).

### `PLATFORM_DB_PATH` override

Set `PLATFORM_DB_PATH` to relocate the database. It is used **verbatim** and must
be either an **absolute path** or the literal `:memory:`. Relative or `..`-bearing
values are rejected (this is the same trust class as `WORKSPACES_ROOT`). Tests set
`PLATFORM_DB_PATH=:memory:` or a temp-dir path for isolation.

## Architecture

```
backend/services/
  supabase.js                 # back-compat shim: re-exports the facade
  platform-db.js              # facade singleton: init() driver selection + 1:1 delegation
  drivers/
    platform-store.js         # the interface (17-method contract, row typedefs, guard constants)
    sqlite-platform.js        # local SQLite driver (default)
    supabase-platform.js      # optional Supabase driver
```

Both drivers implement the identical `PlatformStore` surface, so callers
(`backend/routes/portal-routes.js`, `core/birth/finalize-birth.js`,
`backend/server.js`) are unchanged and driver-agnostic.

## Security properties (SQLite driver)

- **Parameterized only** — every query uses bound prepared statements; no value is
  ever interpolated into SQL. `.exec()` is reserved for static schema DDL.
- **Path-guarded** — the DB path is validated (absolute/`:memory:` only) before any
  filesystem operation; the containing directory is created with restrictive mode.
- **Append-only audit log** — `platform_audit_log` has no update/delete method on
  the interface, and DB-level `BEFORE UPDATE`/`BEFORE DELETE` triggers abort any
  attempt, preserving the anti-gaslighting record. IDs and timestamps are set by
  the driver, not the caller.
- **WAL + foreign keys** — `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`
  set per connection; referential integrity enforced; lock/corruption errors are
  surfaced, never silently swallowed.
- **Bounded** — JSON columns (`settings`, `stage_data`, `details`) are size-capped
  and reject prototype-pollution keys; `getAuditLog` clamps `limit`; `severity` is
  clamped and empty audit events are rejected.

## Native module / ABI (better-sqlite3)

`better-sqlite3` is a native C++ addon, so its compiled binary is tied to a
specific Node.js **ABI** (`NODE_MODULE_VERSION`). This repo runs the backend under
**two different runtimes**:

- **System Node** — `npm start`, `npm run dev:backend`, and the whole vitest suite
  (system Node's ABI, e.g. 137 on Node 24).
- **Electron's bundled Node** — the packaged/dev Electron app spawns the backend
  with `ELECTRON_RUN_AS_NODE=1` (`electron/main.cjs`), so it runs under Electron's
  Node ABI (e.g. 149 on Electron 44 → Node 24.22).

A single install builds the binary for **one** ABI. `npm install` builds for system
Node, so the **Electron app** will fail to load it with:

```
The module '…/better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 149.
```

(The same is true of the repo's other native modules — `node-pty`, `onnxruntime-node`.)

**This is handled automatically — you don't rebuild by hand.** Every npm entry
point runs `scripts/ensure-native-abi.mjs` first via a `pre*` hook, which keeps the
ABI-bound natives (`better-sqlite3`, `node-pty`) matched to the runtime:

- `npm start` / `npm run dev` / `npm test` / `npm run test:*` → **node** ABI.
- `npm run electron:dev` / `npm run electron:build` / `npm run test:e2e:electron` → **electron** ABI.

The script is **marker-cached** (`node_modules/.native-abi`): it rebuilds only when
you actually switch context (node ↔ electron), and is an instant no-op (~20ms) when
already correct. So switching between the app and the tests just works — the first
run after a switch pays a short rebuild, subsequent runs in the same context don't.
(`onnxruntime-node` ships an ABI-stable prebuild and needs no rebuild.) Rebuilds use
the pinned `@electron/rebuild` devDependency for Electron and `npm rebuild` for Node
— no network fetch. `electron-builder` also rebuilds natives at package time, so a
**packaged** app ships correct binaries regardless.

**Graceful degradation (belt and suspenders):** even if a rebuild is skipped or
fails, a native-load failure no longer crashes the backend. The facade catches it,
logs a loud actionable error, and falls back to a no-op driver (platform persistence
disabled) so birth / portal / wallet / chat keep working. A `dbPath`
*misconfiguration* still surfaces as a hard error — only binding/open failures
degrade.

## Schema

Five tables mirror the platform contract: `witnesses`, `neuma_registry`,
`birth_ceremonies`, `birth_stage_history`, `platform_audit_log`. See the `CREATE
TABLE` statements and indexes in `backend/services/drivers/sqlite-platform.js`.
JSON-shaped fields (`settings`, `stage_data`, `details`) are stored as `TEXT`
(`JSON.stringify`/`JSON.parse`). IDs are `crypto.randomUUID()`; timestamps are ISO
strings.
