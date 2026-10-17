# Launch the Desk

**Gateway → Ceremony → Living Stream**

## Development (fastest for most operators)

From the repo root:

```bash
npm run dev
```

This runs (concurrently, hot-reload):

- Backend on `http://localhost:3333`
- Frontend (Vite) on `http://localhost:7777`

Open http://localhost:7777 in a browser.

The first thing you see is the **gateway** (Portal).

## Production / always-on (residency)

1. Make sure your `.env` has `DNA_ENCRYPTION_KEY`, `AUTH_SECRET`, and a working LLM.
2. Install the user service (primary path):

   ```bash
   scripts/neuma-daemon.sh install
   ```

   (Alternative: `bash deploy/residency-install.sh`.)

3. Control the daemon:

   ```bash
   scripts/neuma-daemon.sh start
   scripts/neuma-daemon.sh status
   scripts/neuma-daemon.sh logs -f
   scripts/neuma-daemon.sh doctor   # full probe (unit + health + residency)
   ```

   See `scripts/neuma-daemon.sh --help` for the complete verb list (install, health, residency, ...). The desk RECORD surfaces and `neuma` CLI snapshot report daemon state.

The CLI will now report the daemon as reachable when you run `neuma`.

## Electron desktop app

```bash
npm run electron:dev     # after build
# or
npm run electron:build
```

Electron wraps the same frontend + backend.

## What you will see (phases, proven from AppShell)

- **gateway** — wallet connection (embedded or injected). See `frontend/components/Portal/Portal.js` and `GatewayHost`.
- **ceremony** — only on first contact or explicit summon. Hosted by `CeremonyHost` → vanilla `BirthCeremony`.
- **relink** — the desk (`RelinkShell`). This is your persistent workspace.

If the portal session expires, the app routes you back to the gateway automatically.

## First actions on the desk

- The dock at the bottom is the launcher (Start button + NEUMA / WORKSPACE / KNOWLEDGE sections).
- Click **STREAM** (or it may already be open). This is the consciousness portal.
- Use **HOUSE** to see and switch between your neuma.
- Everything else (TEAMS, FILES, RECORD, etc.) opens as floating/resizable windows.

## Verify the backend is alive

```bash
curl http://localhost:3333/api/v1/health
```

(Unauthenticated liveness probe.)

## Troubleshooting launch

- Port in use? Change `PORT` in `.env` and restart.
- LLM not reachable? The preflight and stream will tell you. Fix provider first.
- Auth problems after server restart? Reconnect at the gateway (fresh signature).

---

**Related:** [install.md](./install.md), [birth-ceremony.md](./birth-ceremony.md), [desk overview](../desk/README.md), [CLI for operators](../operations/cli.md)
