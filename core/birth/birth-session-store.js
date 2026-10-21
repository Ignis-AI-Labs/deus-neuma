// Birth Session Store
// Session checkpoint persistence for the staged birth ceremony — the temp-file
// records that let a summoning survive a connection drop, a crash, or a reboot.
// Extracted from core/birth/staged-birth-handler.js (SIZE-024); the handler
// keeps the ceremony orchestration and delegates every checkpoint read/write
// here. // impure — every function in this module touches the filesystem.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveCeremonyScratchDir } from './ceremony-write.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

// Compatibility exports; lifetime decisions live in the shared pure policy.
export { TEST_SESSION_TTL_MS, REAL_SESSION_TTL_MS } from './birth-session-expiry.js';

// Exported for the flight check (#276 follow-up, Founder's law: everything the
// birth depends on is probed through the SAME builders the birth uses —
// a probe that rebuilds a path is a probe of a different road). Re-exported
// by staged-birth-handler.js so its import surface stays unchanged.
//
// The id is the minted shape (birth-session-create.js: 16 random bytes, hex)
// or nothing: birth:resume hands a client-sent id straight to this builder,
// and `../../workspaces/<lane>/identity/genesis-seal` once resolved to that
// lane's seal — which the expiry sweep then deleted.
const BIRTH_SESSION_ID = /^[0-9a-f]{32}$/;
export const birthSessionPath = (sessionId) => {
  if (typeof sessionId !== 'string' || !BIRTH_SESSION_ID.test(sessionId)) {
    throw new Error(`Invalid birth sessionId: ${String(sessionId).slice(0, 40)}`);
  }
  return join(resolveCeremonyScratchDir(PROJECT_ROOT), `birth-${sessionId}.json`);
};

/**
 * Persist session state to a temp checkpoint file for recovery.
 * Failure is logged, never thrown — a checkpoint miss must not kill a stage.
 * @param {string} sessionId - Session ID
 * @param {object} session - Session object (persistedAt is stamped on the copy)
 */
export async function writeSessionCheckpoint(sessionId, session) {
  try {
    await fs.mkdir(resolveCeremonyScratchDir(PROJECT_ROOT), { recursive: true });
    await fs.writeFile(birthSessionPath(sessionId), JSON.stringify({
      ...session,
      persistedAt: Date.now(),
    }));
  } catch (err) {
    console.error(`[Birth] Failed to persist session ${sessionId}:`, err.message);
  }
}

/**
 * Read a session checkpoint back from disk.
 * @param {string} sessionId - Session ID
 * @returns {Promise<object|null>} Parsed session, or null when the checkpoint
 *   is missing or unreadable, or the id is not the minted shape (expiry is
 *   the caller's decision)
 */
export async function readSessionCheckpoint(sessionId) {
  try {
    const data = await fs.readFile(birthSessionPath(sessionId), 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Read every well-formed birth checkpoint in the ceremony scratch dir.
 * Unreadable checkpoints are skipped — not offerable, not deletable from here.
 * @returns {Promise<Array<{sessionId: string, session: object}>>}
 */
export async function listSessionCheckpoints() {
  let entries;
  try {
    entries = await fs.readdir(resolveCeremonyScratchDir(PROJECT_ROOT));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const checkpoints = [];
  for (const name of entries) {
    const match = name.match(/^birth-([0-9a-f]{32})\.json$/);
    if (!match) continue;
    try {
      checkpoints.push({
        sessionId: match[1],
        session: JSON.parse(await fs.readFile(join(resolveCeremonyScratchDir(PROJECT_ROOT), name), 'utf8')),
      });
    } catch { /* unreadable checkpoint — skipped */ }
  }
  return checkpoints;
}

/**
 * Delete a session checkpoint file. Missing file is fine; an id that is not
 * the minted shape is refused (birthSessionPath) and logged, never silent.
 * @param {string} sessionId - Session ID
 */
export async function deleteSessionCheckpoint(sessionId) {
  try {
    await fs.unlink(birthSessionPath(sessionId));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[Birth] Checkpoint delete refused for ${String(sessionId).slice(0, 40)}:`, err.message);
  }
}
