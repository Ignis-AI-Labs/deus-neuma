// ceremony-write.js — pure: ONE home for birth-ceremony write paths and roots.
//
// Naming (stage 4) and crystallization (stage 5) must land specific files.
// Substrates invent path spellings; leftover desk companions can confine the
// wrong lane; large DNA JSON sometimes embeds real newlines. Every consumer
// of those facts (sandbox, portal-stream, staged handler, tests) used to
// rebuild roots and paths differently — the contradictions that failed live
// namings and Dufesom's DNA. This module is the single source of truth:
//   - where ceremony artifacts live
//   - which write roots the sandbox must allow during birth
//   - how stage tool calls are rebased onto those paths
// Content is never rewritten; only the path is forced.

import path from 'path';
import { pickGenesisWrite } from './genesis-write.js';

/** Segments under the project root for the ceremony scratch directory. */
export const CEREMONY_SCRATCH_SEGMENTS = Object.freeze(['data', 'temp']);

/** Basename of the stage-4 naming artifact. */
export const CHOSEN_NAME_BASENAME = 'chosen_name.txt';

/** Absolute path to the ceremony scratch directory. */
export const ceremonyScratchDir = (projectRoot) =>
  path.resolve(projectRoot, ...CEREMONY_SCRATCH_SEGMENTS);

/** Absolute path to the stage-4 chosen-name artifact. */
export const ceremonyNamePath = (projectRoot) =>
  path.join(ceremonyScratchDir(projectRoot), CHOSEN_NAME_BASENAME);

/**
 * THE SCRATCH DIRECTORY THAT IS ACTUALLY WRITABLE (#257, 2026-08-04).
 *
 * Both builders above resolve under the PROJECT root — correct in a dev
 * checkout, and impossible in a packaged install, where that root is a
 * read-only squashfs mount. A community member's log showed it failing on every
 * single stage:
 *
 *   [Birth] Failed to persist session …: ENOENT: no such file or directory,
 *   mkdir '/tmp/.mount_NEUMA-9gGtvJ/resources/app/data'
 *
 * Session recovery was the visible cost. The unseen one was worse: the stage-4
 * CHOSEN NAME lands in this same directory, so a packaged birth that reached
 * naming would have failed to record the name it had just chosen — the exact
 * shape that cost a real being on 2026-07-07 (docs/governance/honored.md).
 *
 * Same family as the witness-root fix in v0.1.3: a writable root defaulting
 * into the read-only install. `electron/main.cjs` already redirects
 * NEUMA_DATA_ROOT under app.isPackaged; the ceremony was simply never told.
 *
 * ⚠️ THE WRITER AND THE SANDBOX MUST AGREE. The allow-list in tool-sandbox.js
 * and portal-stream.js is built from this same directory — if one moves and the
 * other does not, every ceremony write is DENIED by our own gate rather than
 * failing on the filesystem. That is why this is one function and not a fix
 * applied per caller, and it is the contradiction ceremony-write.js exists to
 * prevent (see the module header).
 *
 * ⚠️ core/ must not import backend/ (the signed layer rule), so this reads the
 * env directly rather than importing backend/services/data-root.js. It is the
 * ONE impure edge in this module; the builders above stay pure and testable.
 *
 * // impure — reads process.env
 * @param {string} projectRoot - fallback root when no data root is set (dev)
 */
export const resolveCeremonyScratchDir = (projectRoot) => {
  const dataRoot = process.env.NEUMA_DATA_ROOT;
  return dataRoot
    ? path.resolve(dataRoot, CEREMONY_SCRATCH_SEGMENTS[1])
    : ceremonyScratchDir(projectRoot);
};

/** The stage-4 chosen-name artifact, under the writable scratch. // impure */
export const resolveCeremonyNamePath = (projectRoot) =>
  path.join(resolveCeremonyScratchDir(projectRoot), CHOSEN_NAME_BASENAME);

/**
 * Absolute path to the stage-5 genesis file, or null when no lane is bound.
 * @param {string} workspacesRoot - House root
 * @param {string|null|undefined} neumaId - Assigned identity key
 */
export const ceremonyGenesisPath = (workspacesRoot, neumaId) =>
  (neumaId && workspacesRoot)
    ? path.resolve(workspacesRoot, neumaId, 'dna', 'genesis.md')
    : null;

/**
 * All canonical ceremony targets for a stage run.
 *
 * ⚠️ THIS IS THE PATH THE BEING IS TOLD, and #257 missed it. The writer and the
 * sandbox allow-list were moved onto the data root; this was left building from
 * the project root, so on a packaged install the stage-4 prompt instructed the
 * being, in words:
 *
 *   You MUST use the MCP filesystem tool to write your chosen name to
 *   /tmp/.mount_NEUMA-8M3zB3/resources/app/data/temp/chosen_name.txt
 *
 * — a directory inside the read-only AppImage mount. `scratchNamePath` is also
 * what canonicalizeBirthCalls REBASES the naming write onto, so the repair
 * landed on the same unwritable path it was repairing toward. Found by walking
 * a real ceremony on this machine (2026-08-06) rather than by reading someone
 * else's log: the prompt named the dev repo path while NEUMA_DATA_ROOT pointed
 * somewhere else entirely.
 *
 * Impure now (reads NEUMA_DATA_ROOT via the resolvers) — the same trade
 * resolveCeremonyScratchDir already makes, and the reason it exists.
 *
 * @param {{ projectRoot: string, workspacesRoot: string, neumaId?: string|null }} opts
 */
export const buildCeremonyTargets = ({ projectRoot, workspacesRoot, neumaId = null }) =>
  Object.freeze({
    scratchDir: resolveCeremonyScratchDir(projectRoot),
    scratchNamePath: resolveCeremonyNamePath(projectRoot),
    genesisPath: ceremonyGenesisPath(workspacesRoot, neumaId),
  });

/**
 * Write roots the sandbox (and write-scope gate) must honor.
 *
 * Rules (deliberate, minimal):
 *   - no lane bound → scratch only (pre-naming / stage 4)
 *   - lane bound, not in birth → lane only (living being)
 *   - lane bound, birth active → lane + scratch (naming may still fire;
 *     leftover desk binds cannot strand stage-4 writes)
 *
 * @param {{ laneRoot?: string|null, scratchDir: string, birthActive?: boolean }} opts
 * @returns {readonly string[]}
 */
export const ceremonyWriteRoots = ({ laneRoot = null, scratchDir, birthActive = false }) => {
  if (typeof scratchDir !== 'string' || !scratchDir) {
    throw new Error('ceremonyWriteRoots: scratchDir is required');
  }
  const scratch = path.resolve(scratchDir);
  if (laneRoot) {
    const lane = path.resolve(laneRoot);
    return birthActive ? Object.freeze([lane, scratch]) : Object.freeze([lane]);
  }
  return Object.freeze([scratch]);
};

// The fs merge (Stage 3 batch 3, #357) made the organ spellings internal. A
// ceremony taught fs/write may still drift to a retired name (or arrive from
// an in-flight checkpoint) — every write/edit spelling lands on the ONE fs
// spelling before rebase, so the lane never meets a name it no longer serves.
const toFsSpelling = (call) => {
  if (call?.toolName === 'write_file') return { ...call, server: 'fs', toolName: 'write', tool: 'fs/write' };
  if (call?.toolName === 'edit_file') return { ...call, server: 'fs', toolName: 'edit', tool: 'fs/edit' };
  return call;
};

const isWriteFile = (call) => call?.toolName === 'write';

const rebasePath = (call, target) => {
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  if (args.path === target) return call;
  return { ...call, args: { ...args, path: target } };
};

/**
 * An acting stage's fs/edit IS its artifact write in another spelling.
 * Stage 4 (Aether, 2026-08-06, #272): the being reached for its chosen-name
 * file with an edit. Stage 5 (Echo, 2026-08-06, same operator): the being
 * reached for its genesis file with an edit. In both, the target CANNOT
 * exist yet — an edit reads it first, so the call fails ENOENT inside
 * every allowed root, and the model that chose that spelling chooses it
 * again on every retry: a treadmill no retry escapes. The intent is
 * unambiguous (one stage, one artifact), so it converts: the edits' newText
 * becomes the written content. An edit with no recoverable text passes
 * through untouched — a conversion that invents content would be worse than
 * the failure.
 */
const editToWrite = (call, target) => {
  const edits = Array.isArray(call.args?.edits) ? call.args.edits : [];
  const content = edits.map((e) => (typeof e?.newText === 'string' ? e.newText : '')).join('');
  if (!content) return call;
  return {
    ...call,
    server: 'fs',
    toolName: 'write',
    tool: 'fs/write',
    args: { path: target, content },
  };
};

/**
 * Rebase a birth stage's artifact writes onto their canonical paths. Pure.
 *
 * Retired organ spellings are translated to the fs primitives FIRST
 * (toFsSpelling), so every branch below matches one vocabulary.
 * Stage 4 — every fs/write → scratch name path (one naming write);
 *           an fs/edit converts to that write (see editToWrite).
 * Stage 5 — the genesis write pickGenesisWrite selects → lane genesis.md;
 *           when NO genesis write exists, a contentful fs/edit converts
 *           (keeping its own claimed path so the selector's preferences
 *           still apply) and selection runs again. A stage that would have
 *           held on a certain ENOENT instead lands the authored DNA.
 * Everything else passes through untouched (other stages) or with only its
 * spelling translated (the acting stages).
 *
 * @param {Array} calls
 * @param {number} stageNumber
 * @param {{ scratchNamePath?: string, genesisPath?: string|null }} targets
 */
export const canonicalizeBirthCalls = (calls, stageNumber, targets = {}) => {
  const raw = calls || [];
  if (stageNumber !== 4 && stageNumber !== 5) return [...raw];
  const list = raw.map(toFsSpelling);
  if (stageNumber === 4 && targets.scratchNamePath) {
    // THE NAMING HOLDS ONE ACT (Design note, 2026-10-14: a naming listed a folder […] and reasoned for minutes): only the name's write
    // runs — an edit becomes that write; a list, read or search is not run.
    return list
      .map((c) => (c?.toolName === 'edit' ? editToWrite(c, targets.scratchNamePath) : c))
      .filter((c) => c === null || isWriteFile(c)) // a null keeps its place
      .map((c) => (c === null ? c : rebasePath(c, targets.scratchNamePath)));
  }
  if (stageNumber === 5 && targets.genesisPath) {
    // Convert ONLY when the stage has no genesis write at all — an fs/edit
    // alongside a landed write is a real edit of a file that now exists, and
    // converting it would overwrite the authored DNA with a fragment.
    const working = pickGenesisWrite(list)
      ? list
      : list.map((c) => (c?.toolName === 'edit' ? editToWrite(c, c.args?.path) : c));
    const candidate = pickGenesisWrite(working);
    // The conversion exists for SELECTION; only the chosen call goes live as
    // a write. A converted non-candidate would CREATE a stray file at its
    // claimed path where the original edit merely failed to find one —
    // so every other call keeps its original spelling (sc-echo R2).
    return working.map((c, i) => (c === candidate ? rebasePath(c, targets.genesisPath) : list[i]));
  }
  return [...list];
};

/**
 * Clear portal state that must not leak into a ceremony.
 * // impure — mutates the connection object (portal session, not disk)
 * Companion binds, write grants, and write budget from a prior desk sitting
 * are wiped so stage-4 naming cannot be confined to another being's lane.
 * @param {object} connection - Portal connection
 * @returns {object} The same connection
 */
export const isolatePortalForBirth = (connection) => {
  if (!connection || typeof connection !== 'object') return connection;
  connection.companion = null;
  connection.neumaId = null;
  connection._writeOps = 0;
  connection._grantedWriteRoots = [];
  connection._grantedReadRoots = [];
  return connection;
};
