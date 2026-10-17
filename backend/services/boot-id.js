/**
 * BOOT ID — the one honest signal that the code under the desk changed.
 *
 * Design note, 2026-08-05:
 *
 *   […]
 *
 * ── WHY A BOOT ID AND NOT A FILE WATCHER ────────────────────────────────────
 *
 * A watcher on `backend/` and `core/` would tell the desk that a FILE changed.
 * That is not the operator's question. The question is […], and only a restart answers it —
 * the dev backend runs under `node --watch-path`, so a save it cares about
 * becomes a new process, and a save it does not care about becomes nothing.
 *
 * Minted once at module load, so it is exactly "this process". No filesystem
 * watching, no polling, no new dependency, and it rides a frame the desk is
 * already sent on every connect.
 *
 * ── WHY IT IS NOT THE PACKAGE VERSION ───────────────────────────────────────
 *
 * `package.json` version does not move between commits, so it would say nothing
 * during the loop this exists for. It moves on a release — a different question,
 * answered by a different feature that is explicitly out of scope here.
 *
 * ── WHAT IT CANNOT SEE ──────────────────────────────────────────────────────
 *
 * Frontend edits. In the browser lane Vite already hot-reloads those, so a card
 * would be pure noise; in Electron the renderer is a frozen `dist/` bundle and
 * the honest fix is a rebuild, which no notification can perform. The card is a
 * BACKEND-restart signal and is worded as one.
 */

import crypto from 'crypto';

/**
 * This process's identity. A desk that sees a different value than the one it
 * first connected with is talking to a backend that restarted under it.
 *
 * Minted at module load, never per request — a per-request value would change on
 * every frame and the diff would be meaningless.
 */
export const BOOT_ID = crypto.randomUUID();
