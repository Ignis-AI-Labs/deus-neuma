/**
 * The substrate's machine-level markers, all rooted at the claim directory: the
 * pid/port claim sibling NEUMA backends read, the stop-intent marker that keeps
 * a sibling-requested stop from relighting, and the retained server log path.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from './logger.js';

const log = createLogger('SubstrateClaim');

// Machine claims let sibling NEUMA backends stop each other's substrate.
// Ceremony sealing is stricter: it requires this backend's live prepared child,
// never a pid/port claim alone.
const claimPath = () => path.join(
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR || path.join(os.homedir(), '.neuma'),
  'substrate-claim.json',
);

// Each boot retains llama-server's output and rotates the previous crash log.
export const serverLogPath = () => path.join(
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR || path.join(os.homedir(), '.neuma'),
  'llama-server.log',
);

// A stop-intent marker keeps a sibling-requested stop from triggering relight.
export const STOP_INTENT_TTL_MS = 15_000;
const stopIntentPath = () => path.join(
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR || path.join(os.homedir(), '.neuma'),
  'substrate-stop-intent.json',
);
export const writeStopIntent = () => {
  try {
    mkdirSync(path.dirname(stopIntentPath()), { recursive: true });
    writeFileSync(stopIntentPath(), JSON.stringify({ at: Date.now() }));
  } catch { /* best-effort — worst case is one unwanted relight */ }
};
export const freshStopIntent = (now = Date.now()) => {
  try {
    const { at } = JSON.parse(readFileSync(stopIntentPath(), 'utf8'));
    return Number.isInteger(at) && now - at < STOP_INTENT_TTL_MS;
  } catch {
    return false;
  }
};

export const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// The operator's LAST LAUNCHED model — the selection marker. Unlike the claim
// (which names what a live pid serves and dies with it), the selection
// survives process death, backend restarts, and reboots: what the operator
// launched stays the resting target until they launch something else
// (2026-08-20: a terminal stop group-killed a fresh qwen serving; the next
// boot relit the env default because the choice lived only in memory).
const selectionPath = () => path.join(
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR || path.join(os.homedir(), '.neuma'),
  'substrate-selection.json',
);

/** Persist the operator's launched model. Best effort. */
export const writeSelection = (modelPath, key = null) => {
  try {
    mkdirSync(path.dirname(selectionPath()), { recursive: true });
    writeFileSync(selectionPath(), JSON.stringify({ path: modelPath, key, at: new Date().toISOString() }));
  } catch (err) {
    log.warn('could not persist the model selection — it will not survive a restart', { err: err.message });
  }
};

/** The persisted selection, or null when none stands. Impure.
 * @returns {{path: string, key: string|null}|null} */
export const readSelection = () => {
  try {
    const sel = JSON.parse(readFileSync(selectionPath(), 'utf8'));
    return typeof sel?.path === 'string' && sel.path.length > 0
      ? { path: sel.path, key: typeof sel.key === 'string' ? sel.key : null }
      : null;
  } catch {
    return null;
  }
};

/** Drop the selection. Impure, best-effort. */
export const clearSelection = () => {
  try { rmSync(selectionPath(), { force: true }); } catch { /* already gone */ }
};

/** Record the server pid and port for machine-wide NEUMA ownership. Best effort. */
export const writeClaim = (pid, port, identity = {}) => {
  try {
    const file = claimPath();
    // A LIVE claim held by another server is never overwritten: a second
    // launch onto a served machine dies (out of memory, port bound) and its
    // exit would then clear the claim of the server still answering
    // (2026-10-05: a backend's doomed relight erased the live server's claim
    // twice in one afternoon, and every identity benchmark arm refused to start).
    // The claim file is the MACHINE's, one per box: any live holder keeps it,
    // whatever port the new launch aims at (2026-10-06: a test backend aimed at
    // :9 overwrote the :8089 server's claim, failed to bind, and cleared it).
    const held = readClaim();
    if (held && held.pid !== pid) {
      log.warn('a live server already holds the machine claim — leaving it', { held: held.pid, heldPort: held.port, launched: pid, port });
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    // The claim carries WHAT serves, not just where: a backend relight onto a
    // surviving server inherits a serving it otherwise knows nothing about —
    // the spawning process is the only one that ever held the identity
    // (2026-08-15: an adopted serving's display fell back to the kernel fd
    // table and surfaced a staged artifact's role-name, llmModel: "bytes").
    const declared = Object.fromEntries(['model', 'servingModel']
      .filter((k) => typeof identity?.[k] === 'string' && identity[k].length > 0)
      .map((k) => [k, identity[k]]));
    writeFileSync(file, JSON.stringify({ pid, port, at: new Date().toISOString(), ...declared }));
  } catch (err) {
    log.warn('could not record the substrate claim — cross-process ownership degrades', { err: err.message });
  }
};

/**
 * Drop the claim. Impure, best-effort. Given a pid, only that server's claim
 * is dropped: an exiting launch never erases the claim of a server it does not own.
 */
export const clearClaim = (pid = null) => {
  try {
    if (pid !== null && JSON.parse(readFileSync(claimPath(), 'utf8'))?.pid !== pid) return;
  } catch { /* unreadable or absent: nothing of ours to keep */ }
  try { rmSync(claimPath(), { force: true }); } catch { /* already gone */ }
};

/**
 * Pin the spawner-witnessed serving authority onto THIS process generation's
 * claim (#506 contract 3). The pid/port guard is the whole law: a claim that
 * moved to a newer boot never inherits proof it did not witness. Best-effort —
 * a claim without authority attests as AUTHORITY_UNAVAILABLE, never as boot
 * failure.
 */
export const writeClaimAuthority = (pid, port, authorityFields) => {
  try {
    const file = claimPath();
    const claim = JSON.parse(readFileSync(file, 'utf8'));
    if (claim?.pid !== pid || claim?.port !== port) return false;
    writeFileSync(file, JSON.stringify({ ...claim, ...authorityFields }));
    return true;
  } catch (err) {
    log.warn('could not pin the serving authority onto the claim', { err: err.message });
    return false;
  }
};

/** Read a live machine claim. A pid/port claim alone never attests artifacts.
 * @returns {{pid: number, port: number}|null} */
export const readClaim = () => {
  try {
    const claim = JSON.parse(readFileSync(claimPath(), 'utf8'));
    if (!Number.isInteger(claim?.pid) || !pidAlive(claim.pid)) return null;
    return claim;
  } catch {
    return null;
  }
};

/**
 * Does NEUMA own the server answering on this port — from ANY of its
 * processes? Pure decision over the two facts. Exported for the gnosis test.
 * @param {{inProcess: boolean, claim: ({port: number}|null), port: number}} s
 */
export const ownedByNeuma = ({ inProcess, claim, port }) =>
  inProcess || Boolean(claim && claim.port === port);
