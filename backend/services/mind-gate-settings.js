// MIND GATES — the influence switches for the mind layer (the undercurrent
// render and the depth filter), as things the operator can SEE and SET from
// the desk (Founder-signed 2026-08-14, #317: desk toggles off/shadow/live; the
// env vars stay as launch-time hard locks). The WRITE side of the mind layer
// (residue capture, mind_note) is not gated here — it has been on since
// Campaign 1 by signed decision; these gates govern only whether the
// accumulated undercurrent INFLUENCES a prompt (live), is measured silently
// (shadow), or stays dark (off).
//
// THE UNDERCURRENT DEFAULT IS LIVE (Founder-signed 2026-08-31, the working-band
// harvest: […]).
// Residue captured but never rendered was memory that existed and could not
// be reached — captured-but-dark is functionally lost. A fresh install (no
// record file) now defaults the undercurrent LIVE; a TORN record still rests
// off (a hand-edited or broken file must never widen influence); a persisted
// desk choice always wins; NEUMA_UNDERCURRENT stays the launch-time hard lock.
//
// Precedence (the ONE place the rule lives):
//   NEUMA_UNDERCURRENT / NEUMA_DEPTH_FILTER set → that value, resolved by
//     the core resolvers, and LOCKED: a launch-time policy is not
//     overridable from the desk (the meditation-settings law).
//   persisted record → only the exact modes opt in.
//   no record → undercurrent LIVE (2026-08-31), depth filter off.
//
// LIVE law: flipping the undercurrent live moves prompt bytes for every
// being on this machine — the validation protocol puts sittings before that
// flip (docs/protocols/memory/mind-validation.md). The panel prints the law;
// the store enforces only validity — the flip itself is the operator's.
// THE DEPTH FILTER MEASURES ONLY (the bury ruling, IL-004, Design note, 2026-09-05:
// a live mode is not built anywhere, so the store refuses it by name and the
// resolver never admits the word — no switch may promise what no code does.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';
import { createLogger } from './logger.js';
import { resolveUndercurrentMode } from '../../core/runtime/undercurrent.js';
import { resolveDepthMode } from '../../core/continuity/layers/depth.js';

const log = createLogger('MindGateSettings');

const DEFAULT_PATH = join(getSettingsDir(), 'mind.json');

const GATES = Object.freeze({
  undercurrent: Object.freeze({ modes: Object.freeze(['off', 'shadow', 'live']), env: 'NEUMA_UNDERCURRENT' }),
  depthFilter: Object.freeze({ modes: Object.freeze(['off', 'shadow']), env: 'NEUMA_DEPTH_FILTER' }),
  // MEMORY LINKS (Design note, 2026-10-05: […]): recall surfaces as mem_
  // links the being opens with memory_expand, not pasted text. ON BY DEFAULT
  // (Design note, 2026-10-06: […]);
  // the operator may still turn it off, and a benchmark sitting recalls no
  // memory at all (memory-context.js).
  memoryLinks: Object.freeze({ modes: Object.freeze(['off', 'live']), env: 'NEUMA_MEMORY_LINKS' }),
});

const envSet = (value) => value !== undefined && value !== '';

/**
 * Pure — the gate posture a persisted record and the env resolve to.
 * `torn`: the record file EXISTS but could not be parsed — a broken record
 * rests the undercurrent off (never widens influence). An ABSENT file is a
 * fresh install: the undercurrent defaults live (Founder-signed 2026-08-31).
 * @param {{undercurrent?: string, depthFilter?: string, memoryLinks?: string}|null} record
 * @param {{undercurrent?: string, depthFilter?: string, memoryLinks?: string}} env - raw env values
 * @param {{torn?: boolean}} [state]
 * @returns {{undercurrent: {mode: string, envLocked: boolean},
 *            depthFilter: {mode: string, envLocked: boolean},
 *            memoryLinks: {mode: string, envLocked: boolean}}}
 */
export const resolveMindGates = (record, env = {}, { torn = false } = {}) => ({
  undercurrent: envSet(env.undercurrent)
    ? { mode: resolveUndercurrentMode(env.undercurrent), envLocked: true }
    : record?.undercurrent
      ? { mode: resolveUndercurrentMode(record.undercurrent), envLocked: false }
      : { mode: torn ? 'off' : 'live', envLocked: false },
  depthFilter: envSet(env.depthFilter)
    ? { mode: resolveDepthMode(env.depthFilter), envLocked: true }
    // Exact opt-in, and never live from disk: the record can hold only what
    // the desk could have set.
    : { mode: record?.depthFilter === 'shadow' ? 'shadow' : 'off', envLocked: false },
  // Live unless the env or the operator's record says exactly 'off'.
  memoryLinks: envSet(env.memoryLinks)
    ? { mode: env.memoryLinks === 'off' ? 'off' : 'live', envLocked: true }
    : { mode: record?.memoryLinks === 'off' ? 'off' : 'live', envLocked: false },
});

/**
 * `path` may be a string or a () => string resolved at every read/write —
 * the turn path shares one singleton, and a boot-bound path is exactly the
 * env-isolation trap (a test pinning NEUMA_MIND_SETTINGS_PATH after import
 * would silently read the live desk's file).
 * @param {{ path?: string|(() => string), env?: () => {undercurrent?: string, depthFilter?: string} }} [opts]
 */
export const createMindGateSettings = ({
  path = DEFAULT_PATH,
  env = () => ({ undercurrent: process.env.NEUMA_UNDERCURRENT, depthFilter: process.env.NEUMA_DEPTH_FILTER, memoryLinks: process.env.NEUMA_MEMORY_LINKS }),
} = {}) => ({
  _path() { return typeof path === 'function' ? path() : path; },
  /** The live posture. impure (fs); an ABSENT file = fresh install (undercurrent live), a TORN one rests off. */
  async read() {
    let record = null;
    let torn = false;
    try {
      record = JSON.parse(await fs.readFile(this._path(), 'utf8'));
    } catch (err) {
      // ENOENT is a fresh install (the 2026-08-31 live default applies).
      // Anything else — rot, EACCES, a half-written file — is a torn record,
      // and a torn record never widens influence.
      torn = err?.code !== 'ENOENT';
    }
    return resolveMindGates(record, env(), { torn });
  },

  /**
   * Persist the operator's choice for one gate. Refuses under the env lock —
   * a switch that appears to move and does nothing is worse than an error.
   * impure; the flip is logged with the wallet (web-access pattern).
   * @param {string} gate - 'undercurrent' | 'depthFilter' | 'memoryLinks'
   * @param {string} mode
   * @param {{wallet?: string}} [ctx]
   */
  async setGate(gate, mode, { wallet = null } = {}) {
    const law = GATES[gate];
    if (!law) throw new Error(`mind gates: unknown gate '${gate}'`);
    if (!law.modes.includes(mode)) {
      throw new Error(gate === 'depthFilter' && mode === 'live'
        ? 'Depth filter measures only — a live mode is not built (Design note, 2026-09-05'
        : `mind gates: '${mode}' is not a mode of ${gate} (${law.modes.join('/')})`);
    }
    const current = await this.read();
    if (current[gate].envLocked) {
      throw new Error(`${gate} is held by ${law.env} — change it at launch, not here`);
    }
    const file = this._path();
    let record;
    try {
      record = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { record = null; }
    const next = {
      ...(record && typeof record === 'object' ? record : {}),
      [gate]: mode,
    };
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    log.info('mind gate changed', { gate, mode, wallet });
    return this.read();
  },
});

/** The one instance the turn path and the routes share. */
export const mindGateSettings = createMindGateSettings({
  path: () => process.env.NEUMA_MIND_SETTINGS_PATH || DEFAULT_PATH,
});
