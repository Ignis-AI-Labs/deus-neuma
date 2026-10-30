/**
 * Sandbox path policy — the pure path-law half of the tool sandbox.
 *
 * Extracted VERBATIM from tool-sandbox.js (size law, SIZE breakdown 2026-08-26):
 * denied patterns, path-arg collection, arg normalization, checkPathAccess,
 * realpath handling, grant-dir resolution, root containment, gap-finding, and
 * the write-grant blast-radius bound. tool-sandbox.js keeps the impure
 * executor (createSandboxedCallTool, budgets, audit log) and re-exports this
 * module's surface so every existing reader stands unchanged.
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { isSecretFile } from './secret-path-classifier.js';
import { secretsFilePath } from './secret-provisioning.js';
import { secretLinkReason } from './secret-inodes.js';
// Re-exported for the filesystem organ, which is at the size cap and keeps one policy import.
export { secretLinkReason };
import { platformWallWriteReason, platformWriteWalls } from './platform-write-walls.js';
import { foldName, wallSpelling } from './wall-spelling.js';

// Denied path patterns — tools cannot access these (reads OR writes). Split in
// two on 2026-07-26 (THE FOCUS GROUND) because a single substring list cannot
// tell […] from […]. It matched both, so focusing ANY normal repo
// left a swathe of ordinary source unreachable — this repo included. The
// operator's law is that the focused folder just works, so the two kinds of
// secret are now named separately.
//
// SECRET_PATTERNS match EVERYWHERE, focus ground included. These are
// secret-SHAPED wherever they appear: credentials, key material, git internals
// (`.git/config` carries remote tokens), and the dependency tree nobody means
// to hand a model.
const SECRET_PATTERNS = [
  '.env', 'vault/', '.git/', 'node_modules/', '.ssh/',
  'keys/keypair', 'keys/', 'owner.json',
  // Other neumas' sovereign state stays denied EVERYWHERE, deliberately not
  // install-anchored: the workspaces root is relocatable (setWorkspacesRoot),
  // so a house living outside the checkout must be just as private. A being
  // mid-birth can never read another's DNA, wherever the house stands.
  'data/dna/', 'data/dna-cache/', 'data/memory-store/',
];
// INSTALL_PATTERNS match ONLY inside the Neuma installation, because that is
// the only place they mean anything: `config/` here is the platform's own
// policy file (AI-SEC-005, self-modification), while `config/` in the
// operator's repository is ordinary source. Focusing the Neuma checkout itself
// still gets the FULL list, so Neuma working on Neuma is exactly as protected
// as it was before.
const INSTALL_PATTERNS = [
  'config/tool-policy.json', 'config/', // AI-SEC-005: prevent self-modification
];
// Resolved from THIS file's location, never process.cwd(): a daemon, a test
// runner, and a desk each start with a different cwd, and an install root that
// moves with the working directory would silently stop protecting the install.
const NEUMA_INSTALL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL_ROOT_FOLDED = foldName(NEUMA_INSTALL_ROOT);

// pure — the denied patterns that apply to a path: always the secret-shaped
// ones, plus the install-protecting ones when the path lies inside the Neuma
// installation, in any spelling a volume opens as it. Exported for the tests
// that prove both halves.
export const deniedPatternsFor = (resolvedPath) => {
  const folded = foldName(resolvedPath);
  const underInstall = folded === INSTALL_ROOT_FOLDED
    || folded.startsWith(INSTALL_ROOT_FOLDED + path.sep);
  return underInstall ? [...SECRET_PATTERNS, ...INSTALL_PATTERNS] : SECRET_PATTERNS;
};

// THE LANE'S PLATFORM STATE — written only by the platform's own acts, never
// by the being the lane belongs to, wherever the house stands. A lane holds the
// being's work beside what the operator and platform keep FOR it: config/ (tool
// policy and its grants, the spend allowlist, threshold and pending spends),
// identity/ (seal records, true name, the write-once soul facts), audit/, the
// voice first-seal receipt, the lane's standing marker and its granted
// capacity. The readers trust these files, so a being able to write them could
// lift its own approval rows or name its own recipients. INSTALL_PATTERNS held
// config/ only while the lanes sat inside the checkout; Electron's
// <home>/workspaces and a kin drive had no wall at all (audit 2026-10-19).
// Anchored on the lane's own top level, so a project with a config/ inside the
// being's work stays ordinary source. keys/ and owner.json are walls everywhere
// already (SECRET_PATTERNS). Writes only: reading its own policy is fine.
const LANE_STATE_DIRS = Object.freeze(['config', 'identity', 'audit']);
const LANE_STATE_FILES = Object.freeze(['lane.json', 'allocation.json', 'voice/seal.json']);
// A house's founding records stand beside its lanes, at the ground itself.
const GROUND_STATE_FILE = /^house-founding\..+\.json$/;
// A lane id, folded (neuma-workspace `_path`); a dot never appears in one, so
// a house ground (`house.<wallet>`) is never mistaken for a lane.
export const LANE_ID_FOLDED = /^[a-z0-9_-]+$/;
const LANE_STATE_REFUSAL = 'That path is platform state your operator keeps for a lane (policy, grants, spend limits, '
  + 'seals, audit) — it changes only through the platform\'s own acts, never a file write. Reading it is fine.';
// A lane's next sitting runs every filing in its intents/ as its own act, without knowing who
// wrote it (intent-sweep.js), so only the lane's own being may file there.
const KIN_INTENTS_REFUSAL = 'That path is another lane\'s intents/ — a filing there would run as that being\'s own act. '
  + 'File your acts in your own lane\'s intents/.';

// pure — the path segments of `target` below `root`; [] for the root itself,
// null when outside it. Both already resolved and folded.
export const segmentsBelow = (root, target) => {
  const rel = path.relative(root, target);
  if (rel === '') return [];
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep);
};

// pure — is this lane-relative path platform state, or a directory holding
// it? The lane itself counts: replacing the lane replaces all of its state.
const isLaneState = (parts) => {
  if (parts.length === 0 || LANE_STATE_DIRS.includes(parts[0])) return true;
  const rel = parts.join('/');
  return LANE_STATE_FILES.some((file) => file === rel || file.startsWith(`${rel}/`));
};

// pure — does a write at `target` hold `place` (the place itself or a
// directory above it)? Moving or replacing a directory moves everything below
// it, so the parent of a lane or a ground is as walled as the lane (#587:
// move the parent aside, rewrite the policy where it now lies, move it back).
const holds = (target, place) => segmentsBelow(target, place) !== null;

/**
 * Does a WRITE reach platform state — the install's settings, the realm, the
 * operator's login persistence (platform-write-walls.js), a lane's own
 * state or another lane's intents/, or a directory above any of them? Both sides in one spelling
 * (wall-spelling.js: NFC, full case fold), so a case- or normalization-
 * insensitive volume cannot be asked for `Config/` or `lane.jſon` instead.
 * Pure when `walls` is given; by default the walls are
 * resolved at the call (impure: env, realm root, disk), never at import.
 * @param {string} filePath
 * @param {{ grounds?: string[], lanes?: string[], walls?: Array<{ path: string, reason: string }> }} where -
 *   grounds hold lanes one level down (the workspaces, witnesses and harness
 *   roots); lanes are lane roots named directly (the being's own, as its
 *   engine resolved it)
 * @returns {string|null} the refusal, or null when the write is the being's own work
 */
export const laneStateWriteReason = (filePath, { grounds = [], lanes = [], walls = platformWriteWalls() } = {}) => {
  const walled = platformWallWriteReason(filePath, walls);
  if (walled) return walled;
  const target = wallSpelling(filePath);
  const ownLanes = lanes.map(wallSpelling);
  for (const lane of lanes) {
    if (holds(target, wallSpelling(lane))) return LANE_STATE_REFUSAL;
    const parts = segmentsBelow(wallSpelling(lane), target);
    if (parts && isLaneState(parts)) return LANE_STATE_REFUSAL;
  }
  for (const ground of grounds) {
    if (holds(target, wallSpelling(ground))) return LANE_STATE_REFUSAL;
    const parts = segmentsBelow(wallSpelling(ground), target);
    if (!parts) continue;
    if (parts.length === 1 && GROUND_STATE_FILE.test(parts[0])) return LANE_STATE_REFUSAL;
    if (LANE_ID_FOLDED.test(parts[0]) && isLaneState(parts.slice(1))) return LANE_STATE_REFUSAL;
    if (LANE_ID_FOLDED.test(parts[0]) && parts[1] === 'intents'
      && !ownLanes.includes(path.join(wallSpelling(ground), parts[0]))) return KIN_INTENTS_REFUSAL;
  }
  return null;
};

/**
 * Does this path hit a denied pattern? A trailing-slash pattern names a
 * DIRECTORY and matches it as a whole path SEGMENT — bare, final (the rename
 * target), or interior — so the rename-out/rename-back escape proven on
 * 2026-07-27 (move .git aside, inject a remote, move it back) stays dead.
 * Patterns without a trailing slash are filename-shaped (`.env`, `owner.json`)
 * and keep substring matching. Comparison happens in forward slashes — on
 * Windows every slash-bearing pattern otherwise missed (SEC-036 #226).
 *
 * pure. `normalized` must be folded (wall-spelling.js) and `path.normalize`d; either
 * platform's separators are accepted. Exported so the guard is provable.
 *
 * @param {string} normalized lowercased, normalized path
 * @param {string} denied one pattern from SECRET_PATTERNS / INSTALL_PATTERNS
 * @returns {boolean}
 */
export const matchesDeniedPattern = (normalized, denied) => {
  const target = normalized.replace(/\\/g, '/');
  const pattern = denied.toLowerCase();
  if (!pattern.endsWith('/')) return target.includes(pattern);
  const bare = pattern.slice(0, -1); // '.git/' -> '.git', 'data/dna/' -> 'data/dna'
  return target === bare // the directory itself, named alone
    || target.endsWith(`/${bare}`) // …as the final segment: the rename target
    || target.includes(`${bare}/`); // …or anywhere above a child
};

const DENIED_EXTENSIONS = ['.pem', '.key'];

// Every arg name the filesystem tools use to carry a path. ALL of them are
// checked — move_file/rename_file carry source AND destination, and validating
// only one leaves the other an exfiltrate/delete primitive.
const PATH_ARG_KEYS = [
  'path', 'filePath', 'file_path',
  'source', 'sourcePath', 'source_path',
  'destination', 'destinationPath', 'destination_path', 'dest',
];
// read_multiple_files carries its paths as an ARRAY — without this the
// sandbox saw no path at all and the read escaped lane confinement
// (bounded only by the MCP server's own roots).
const PATH_ARRAY_KEYS = ['paths'];

// The tools that carry a DESTINATION, and the arg names they carry it under.
const MOVE_TOOLS = Object.freeze(new Set(['move_file', 'rename_file', 'copy_file']));
const DEST_ARG_KEYS = Object.freeze(['destination', 'destinationPath', 'destination_path', 'dest']);


/**
 * The destination path of a move/rename call, or null for anything else. Pure.
 * @param {string} toolName
 * @param {Object} args
 * @returns {string|null}
 */
export const moveDestination = (toolName, args) => {
  if (!MOVE_TOOLS.has(toolName)) return null;
  for (const k of DEST_ARG_KEYS) {
    const v = args?.[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
};

export const collectPathArgs = (args) => {
  if (!args || typeof args !== 'object') return [];
  const single = PATH_ARG_KEYS.map((k) => args[k]).filter((v) => typeof v === 'string' && v.length > 0);
  const arrays = PATH_ARRAY_KEYS.flatMap((k) => (Array.isArray(args[k]) ? args[k] : []))
    .filter((v) => typeof v === 'string' && v.length > 0);
  return [...single, ...arrays];
};

// Arg-name drift the local models actually speak (live 2026-07-23: three
// search_files calls in a row refused by the MCP schema — […] — because the model carried its target under
// another name, and the zod wall taught it nothing). Aliases fill a MISSING
// canonical key only; an explicit value is never overwritten, and a WRITE
// path is never invented (the fail-closed write law stands).
const ARG_ALIASES = Object.freeze({
  search_files: Object.freeze({ path: ['directory', 'dir', 'folder', 'root', 'in', 'location'], pattern: ['query', 'text', 'name', 'term', 'glob'] }),
  search_content: Object.freeze({ path: ['directory', 'dir', 'folder', 'root', 'in', 'location'], pattern: ['query', 'text', 'term', 'string', 'search'] }),
  list_directory: Object.freeze({ path: ['directory', 'dir', 'folder', 'location'] }),
  read_file: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename'] }),
  read_text_file: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename'] }),
  get_file_info: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename'] }),
  write_file: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename'], content: ['text', 'body', 'contents', 'data'] }),
  edit_file: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename'] }),
  create_directory: Object.freeze({ path: ['directory', 'dir', 'folder'] }),
  move_file: Object.freeze({ source: ['from', 'src'], destination: ['to', 'target'] }),
  copy_file: Object.freeze({ source: ['from', 'src'], destination: ['to', 'target'] }),
  delete_file: Object.freeze({ path: ['file', 'filepath', 'file_path', 'filename', 'target'] }),
});

// The read tools whose missing path may default to the first standing root —
// "search" with only a pattern means […], never a
// refusal. Writes are excluded by construction: a write path is never guessed.
const DEFAULT_ROOT_TOOLS = new Set(['search_files', 'search_content', 'list_directory']);

/**
 * Meet the model where its training is strongest (the parser's own law,
 * applied to ARGUMENTS): fill canonical keys from known aliases, and give a
 * root-searching read its ground when no path was named at all. Pure —
 * returns the same object when nothing applies.
 * @param {string} toolName
 * @param {Object} args
 * @param {string|null} defaultRoot - first standing read root, or null
 * @returns {Object}
 */
export const normalizeToolArgs = (toolName, args, defaultRoot = null) => {
  const aliases = ARG_ALIASES[toolName];
  if (!aliases || !args || typeof args !== 'object') return args;
  let out = args;
  const fill = (key, value) => {
    if (out === args) out = { ...args };
    out[key] = value;
  };
  for (const [canonical, names] of Object.entries(aliases)) {
    if (typeof out[canonical] === 'string' && out[canonical].length > 0) continue;
    const found = names.map((n) => args[n]).find((v) => typeof v === 'string' && v.length > 0);
    if (found !== undefined) fill(canonical, found);
  }
  if (DEFAULT_ROOT_TOOLS.has(toolName) && defaultRoot
    && !(typeof out.path === 'string' && out.path.length > 0)) {
    fill('path', defaultRoot);
  }
  return out;
};

/**
 * Check if a path argument is within allowed boundaries. impure: one stat,
 * for the hard-link law (a path that does not exist costs nothing more).
 * @param {string} filePath - Path to check
 * @param {string[]} allowedRoots - Allowed root directories (absolute paths)
 * @param {{ requireRoot?: boolean }} [opts] - requireRoot: a write with no root fails closed
 * @returns {{ allowed: boolean, reason: string|null, grantable?: boolean, deniedPattern?: string }}
 *   `grantable` marks the ONE root denial the operator may lift (a READ outside
 *   its roots). `deniedPattern` names the matched secret pattern/extension so
 *   the sensitive-grant door can consult the lane's grants.
 */
export const checkPathAccess = (filePath, allowedRoots = [], { requireRoot = false } = {}) => {
  if (!filePath || typeof filePath !== 'string') {
    return { allowed: false, reason: 'Invalid path' };
  }

  const normalized = foldName(path.normalize(filePath));

  // Check denied patterns. Which list applies depends on where the path lies:
  // inside the Neuma installation the full list holds (install state is
  // protected exactly as before); outside it only the secret-shaped patterns
  // do, so a focused repository's own config/ is ordinary source. The install
  // test runs on the case-correct resolved path — the lowercased form above is
  // for substring matching only.
  for (const denied of deniedPatternsFor(path.resolve(filePath))) {
    if (matchesDeniedPattern(normalized, denied)) {
      return { allowed: false, reason: `Access denied: ${denied}`, deniedPattern: denied };
    }
  }

  // Check denied extensions
  for (const ext of DENIED_EXTENSIONS) {
    if (normalized.endsWith(ext)) {
      return { allowed: false, reason: `Access denied: ${ext} files`, deniedPattern: ext };
    }
  }

  // The platform's own key file opens every being; it carries a pattern no card
  // can lift (sensitive-grants.js NEVER_REQUESTABLE), unlike a project's .env.
  if (foldName(path.resolve(filePath)) === foldName(path.resolve(secretsFilePath()))) {
    return { allowed: false, reason: 'Access denied: the platform\'s own keys', deniedPattern: 'platform keys' };
  }

  if (isSecretFile(normalized)) {
    return { allowed: false, reason: 'Access denied: secret data file', deniedPattern: 'secret data file' };
  }

  // A hard link made outside the being gives a secret's bytes an innocent
  // name; every check above judged the name (secret-inodes.js). One stat.
  // No deniedPattern: a twin has no consent story of its own — an operator
  // grants the secret by its real name, never through a second one.
  const linked = secretLinkReason(filePath);
  if (linked) return { allowed: false, reason: linked };

  // Writes must be confined: fail closed when no root is in force, so an
  // unconfined write is never possible (the filesystem MCP server is rooted at
  // the project dir, so an unrooted write could reach source/config). Reads may
  // pass with no root — the denied-path list above still applies.
  if (requireRoot && allowedRoots.length === 0) {
    return { allowed: false, reason: 'Write not permitted outside a confined root' };
  }

  // When roots are specified, enforce containment with a separator boundary so
  // that, e.g., /x/data never matches a sibling /x/database.
  if (allowedRoots.length > 0) {
    const resolved = path.resolve(filePath);
    const inAllowed = allowedRoots.some(root => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
    if (!inAllowed) {
      return {
        allowed: false,
        reason: 'Path outside allowed directories',
        grantable: !requireRoot,
      };
    }
  }

  return { allowed: true, reason: null };
};

/**
 * impure (realpath) — the real filesystem path of `filePath`, resolving
 * symlinks. A not-yet-created path (a write target) cannot be realpath'd
 * directly, so walk up to the nearest existing ancestor, realpath that, and
 * re-append the remaining lexical tail. When nothing in the chain exists the
 * lexical resolution is returned unchanged (there is no link to follow).
 * Mirrors the TOCTOU stance of user-projects.js (realpath both sides, then
 * compare) — SEC-032.
 * @param {string} filePath - Path to resolve
 * @returns {Promise<string>} Absolute, symlink-resolved path
 */
export const realpathOfNearestExisting = async (filePath) => {
  let current = path.resolve(filePath);
  const tail = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(filePath);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

// Tools whose path arg names a directory to walk — the grant scope IS the path.
const DIR_SHAPED_TOOLS = new Set(['list_directory', 'list_directory_with_sizes', 'directory_tree', 'search_files', 'search_content']);

/**
 * impure (stat) — resolve the directory an operator grant should cover for a
 * requested path: the path itself when it is a directory, else its parent.
 * A path that cannot be stat'ed falls back to its parent (the file may not
 * exist yet, but its directory is still the honest scope to name).
 * @param {string} toolName - Tool the path belongs to
 * @param {string} filePath - Requested path
 * @returns {Promise<string>} Absolute directory to grant
 */
export const resolveGrantDir = async (toolName, filePath) => {
  const resolved = path.resolve(filePath);
  if (DIR_SHAPED_TOOLS.has(toolName)) return resolved;
  const isDir = await fs.stat(resolved).then((s) => s.isDirectory()).catch(() => false);
  return isDir ? resolved : path.dirname(resolved);
};

// pure — is a path contained within any of these roots (separator-boundary so
// /x/data never matches a sibling /x/database). Empty roots → never contained.
export const isWithinRoots = (filePath, roots = []) => {
  if (!filePath || roots.length === 0) return false;
  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
};

// The scope gap in a tool call: every path arg that fails root containment but
// is grantable (not a denied pattern/extension). Pure. Returns [] when the call
// is fully in scope OR hard-denied — a hard denial must fail as it always did,
// never turn into a prompt. Shared by the read gate and the write gate; the
// caller passes the roots that apply to its direction.
const findGrantableGaps = (args, roots) => {
  if (roots.length === 0) return []; // unconfined (pre-bind) — nothing to grant
  return collectPathArgs(args).filter((p) => {
    const check = checkPathAccess(p, roots);
    return !check.allowed && check.grantable === true;
  });
};

/**
 * Read-scope gaps: grantable paths a READ reaches outside its allowed roots.
 * @param {Object} args - Parsed tool args
 * @param {string[]} readRoots - Roots currently allowed for reads
 * @returns {string[]} Out-of-scope-but-grantable paths
 */
export const findUngrantedReadPaths = (args, readRoots) => findGrantableGaps(args, readRoots);

/**
 * Write-scope gaps: grantable paths a WRITE reaches outside its allowed roots.
 * The operator may lift these into `_grantedWriteRoots` — but only when they land
 * inside the active project's folders (that bound is enforced by the portal
 * gate, not here). Denied patterns/extensions never surface (hard-deny holds).
 * @param {Object} args - Parsed tool args
 * @param {string[]} writeRoots - Roots currently allowed for writes
 * @returns {string[]} Out-of-scope-but-grantable paths
 */
export const findUngrantedWritePaths = (args, writeRoots) => findGrantableGaps(args, writeRoots);

/**
 * The blast-radius bound on write grants: given out-of-lane write gaps and the
 * active project's folders, the set of project folders an operator may be asked to
 * grant — for each gap, the single project folder that contains it. A gap inside
 * no project folder contributes nothing, so it stays hard-denied (never grants
 * write reach outside the active project). Pure.
 * @param {string[]} gaps - Out-of-lane grantable write paths
 * @param {string[]} projectFolders - The active project's attached folders
 * @returns {string[]} Distinct project folders to grant (a subset of projectFolders)
 */
export const writeGrantScope = (gaps, projectFolders) => {
  // When project folders nest (e.g. /repos/proj and /repos/proj/backend), grant
  // the MOST specific (longest) folder that contains the gap — least privilege,
  // so a write to /repos/proj/backend/x doesn't grant all of /repos/proj.
  const containing = (p) => projectFolders
    .filter((f) => isWithinRoots(p, [f]))
    .sort((a, b) => b.length - a.length)[0];
  return [...new Set(gaps.map(containing).filter(Boolean))];
};
