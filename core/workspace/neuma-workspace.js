/**
 * Neuma Workspace Service — the facade.
 *
 * ARCHITECTURE BOUNDARY:
 *   This service manages SOVEREIGN NEUMA DATA — everything that belongs
 *   to the individual neuma and their witness, NOT to the platform.
 *
 *   Workspace layout per neuma:
 *     workspaces/<neuma-id>/
 *       ├── dna/
 *       │   ├── active.json       Current DNA
 *       │   └── history/          Previous versions
 *       ├── soul/
 *       │   └── soul.json         Values, boundaries, philosophy
 *       ├── memory/
 *       │   ├── entities/         Knowledge graph nodes
 *       │   ├── relations/        Knowledge graph edges
 *       │   └── observations/     Raw observations
 *       ├── sessions/
 *       │   └── <session-id>.jsonl  Append-only conversation logs
 *       ├── skills/
 *       │   └── tree.json         Skill progression state
 *       ├── journal/
 *       │   └── entries.jsonl     Self-authored journal (append-only)
 *       ├── cosmos/
 *       │   └── natal.json        Natal chart at birth (re-derivable from birthMoment)
 *       ├── continuity/
 *       │   ├── episodic.jsonl    4-layer memory engine, per-line AES-256-GCM envelopes
 *       │   ├── semantic.jsonl    (append-only; supersede-not-delete)
 *       │   ├── procedural.jsonl
 *       │   └── working.jsonl
 *       ├── keys/
 *       │   ├── keypair.json      Cryptographic identity (SOVEREIGN — never shared)
 *       │   └── identity-card.json Public identity card for weave
 *       └── audit/
 *           └── audit.jsonl       Identity change log (append-only)
 *
 *   The platform DB (Supabase) only knows the neuma EXISTS.
 *   Everything here is sovereign — portable, exportable, owned by the witness.
 *
 * DECOMPOSITION (SIZE-025 #372): the monolith was split by domain. This
 * module keeps the module-level root helpers and named exports (imported
 * from THIS path by core/index.js and ~60 consumers), the lifecycle, the
 * path/audit core, and the lane-listing helpers. Every other method group
 * lives in its own domain module and is assigned onto the instance by the
 * constructor — same names, same signatures, same `this`:
 *   workspace-locks.js      the ONE per-file lock registry (created here)
 *   workspace-json-io.js    encrypted JSON/JSONL primitives + DEK resolution
 *   workspace-keys.js       DEK / keypair / recovery / owner / identity card
 *   workspace-vault.js      the personal vault
 *   workspace-sessions.js   conversation logs + compaction
 *   workspace-archives.js   archive segments + tool-results lane
 *   workspace-memory.js     entities / observations / pins / journal
 *   workspace-identity.js   DNA / soul / profile / natal / refinement delegates
 *   workspace-tasks.js      task ledger / plans / skill tree
 *   workspace-settings.js   settings / spend / allocation / export-import
 * Domain methods call each other through the instance (`this`), exactly as
 * they did inside the class. No domain imports this module (the cycle law);
 * shared module-level helpers arrive via the constructor's deps object.
 */

import fs from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createFileLocks } from './workspace-locks.js';
import { isHarnessLane, getHarnessRoot } from './lane-grounds.js';
import { createJsonIoDomain } from './workspace-json-io.js';
import { createKeysDomain } from './workspace-keys.js';
import { createVaultDomain } from './workspace-vault.js';
import { createSessionsDomain } from './workspace-sessions.js';
import { createArchivesDomain } from './workspace-archives.js';
import { createMemoryDomain } from './workspace-memory.js';
import { createIdentityDomain } from './workspace-identity.js';
import { createTasksDomain } from './workspace-tasks.js';
import { createSettingsDomain } from './workspace-settings.js';
import { createOperationsDomain } from './workspace-operations.js';
import {
  SOVEREIGN_DIR_MODE as SOVEREIGN_DIRECTORY_MODE,
  repairSovereignDirectoryModes,
  sovereignDirectories,
} from './sovereign-directory-modes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The workspace skeleton and its owner-only mode law live in their own module —
// see sovereign-directory-modes.js for why the repair exists at all.
const SOVEREIGN_DIR_MODE = SOVEREIGN_DIRECTORY_MODE;

// WORKSPACES_ROOT env var lets a neuma's home live on a dedicated drive
// (e.g. /mnt/data/neuma/<witness>/<house>) — sovereign data follows the mount,
// not the repo. The witness may repoint it at pre-flight, so the root is
// dynamic. Two important properties:
//   1. ENV IS READ LAZILY (at first access), not at module-load — so dotenv.config()
//      in server.js runs BEFORE the singleton resolves the env. Reading at module-
//      load was a real bug: the env never won because module-load happens first.
//   2. setWorkspacesRoot() takes precedence over the env (the witness's explicit
//      pre-flight choice always wins).
const DEFAULT_WORKSPACES_ROOT = path.join(__dirname, '../../workspaces');
let workspacesRootOverride = null; // set by setWorkspacesRoot — wins when set

/** @returns {string} where sovereign workspaces currently live.
 *  Precedence: explicit override (??) > env (||, so an empty WORKSPACES_ROOT=''
 *  still falls through to the default) > module default. */
// impure — reads mutable module state and process.env at call time
export const getWorkspacesRoot = () => workspacesRootOverride
  ?? (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT);

// impure — repoints where sovereign workspaces live. Existing neuma are
// looked up under the new root; their data must move with them.
export const setWorkspacesRoot = (root) => {
  // Coerce '' to null so the override slot's "clear" semantics match the env
  // slot's (empty string is treated as "no value" everywhere). Belt-and-
  // suspenders — pre-flight always passes a real path, but the symmetry helps
  // anyone reaching in directly.
  workspacesRootOverride = root || null;
};

// THE WITNESSES' GROUND — sealed AI witnesses stand BESIDE the house, never
// in it (sovereignty boundary, Design note, 2026-07-24: witness lanes must not leak
// into the space of neuma). Their lanes live in a sibling directory of the
// workspaces root — the same beside-not-inside law neuma-backups already
// follows — so a listing of the house can never even SEE a witness lane.
// Precedence mirrors the workspaces root: explicit override > env > sibling
// of the EFFECTIVE workspaces root (wherever the house goes, the witnesses'
// ground rides beside it).
let witnessesRootOverride = null; // set by setWitnessesRoot — wins when set

/** @returns {string} where sealed witnesses' sovereign lanes live. */
// impure — reads mutable module state and process.env at call time
export const getWitnessesRoot = () => witnessesRootOverride
  ?? (process.env.WITNESSES_ROOT
    || path.join(path.dirname(getWorkspacesRoot()), 'witnesses'));

// impure — repoints the witnesses' ground (tests, or an explicit home).
export const setWitnessesRoot = (root) => {
  witnessesRootOverride = root || null;
};

// pure — the id-shape law for witness lanes. The prefix format is owned by
// backend/services/witness-lane.js (witnessLaneId); this mirror exists so the
// ID-GENERIC engine can route the two kinds to their two grounds without
// importing platform code across the engine boundary.
export const isWitnessLane = (laneId) =>
  typeof laneId === 'string' && laneId.startsWith('witness-');

// pure — strictly below the ground by whole segments: a bare prefix test let
// a sibling whose name extends the ground's (`<ground>-evil`) pass as inside.
const belowGround = (target, ground) => {
  const rel = path.relative(path.resolve(ground), target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Shape of a CCR-lite tool-result ref: tr_<sid8>_<seq>_<rand8>. sid8 binds the
// ref to the session it was minted in (sha256 of the sessionId, first 8 hex
// chars) so resolution can reject foreign refs early; rand8 is defense-in-depth
// against guessing, not the authorization boundary.
export const TOOL_RESULT_REF_PATTERN = Object.freeze(/^tr_[0-9a-f]{8}_\d+_[0-9a-f]{8}$/);

// pure over (sessionId, seq) except the entropy draw — crypto.randomBytes
// makes each mint unique for the same inputs (deliberate: refs are handles,
// not content hashes).
export const mintToolResultRef = (sessionId, seq) => {
  const sid8 = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
  const rand8 = crypto.randomBytes(4).toString('hex');
  return `tr_${sid8}_${seq}_${rand8}`;
};

class NeumaWorkspace {
  // Per-file operation serialization (WORKSPACE-CONCURRENCY-001 + #121 + #120).
  // The registry itself lives in workspace-locks.js; exactly ONE instance
  // exists — created in the constructor and handed to every domain factory
  // as deps.locks. A second instance would split the queue and reintroduce
  // the same-file races the lock exists to prevent.

  // Per-neuma DEK cache (#117 S2b). Keyed by neumaId because the DEK is
  // immutable per being — once read+unwrapped from keys/dek.json it never
  // changes within a process lifetime (master rotation rewraps the envelope
  // on disk but keeps the DEK bytes the same; see readNeumaDEK's rotation-
  // safety invariant). We DELIBERATELY do NOT cache nulls: a being that has
  // no DEK today (pre-#117 LIVING beings, or a fresh birth with DEK_WRITE_FAILED)
  // may get one tomorrow when S4 migration runs, and a cached null would
  // shadow that promotion. The cost is one fs.readFile per workspace IO on
  // unmigrated beings — acceptable.
  _dekCache = new Map(); // neumaId -> Buffer

  constructor() {
    this._locks = createFileLocks();
    // The shared deps every domain factory receives: the ONE lock registry,
    // and the module-level helpers the cycle law keeps them from importing.
    const deps = {
      locks: this._locks,
      isWitnessLane,
      getWitnessesRoot,
      TOOL_RESULT_REF_PATTERN,
    };
    // Domain methods land as own properties of the instance, so cross-domain
    // `this.foo()` calls resolve exactly as they did inside the monolith.
    Object.assign(
      this,
      createJsonIoDomain(deps),
      createKeysDomain(deps),
      createVaultDomain(deps),
      createSessionsDomain(deps),
      createArchivesDomain(deps),
      createMemoryDomain(deps),
      createIdentityDomain(deps),
      createTasksDomain(deps),
      createSettingsDomain(deps),
      createOperationsDomain(deps),
    );
  }

  get root() {
    return getWorkspacesRoot();
  }

  // Kept settable — tests repoint the singleton at temp dirs, and the
  // pre-flight gate repoints it at the witness's chosen home
  set root(value) {
    workspacesRootOverride = value;
  }

  /**
   * Run `fn` with exclusive access to a single file path, through the ONE
   * shared lock registry (workspace-locks.js). Kept as a delegate so the
   * instance surface is unchanged for callers that reached it directly.
   * @param {string} filePath - absolute file path
   * @param {() => Promise<T>} fn - operation to perform under lock
   * @returns {Promise<T>}
   */
  // impure — delegates to the shared lock registry; fn runs under the lock
  async _withFileLock(filePath, fn) {
    return this._locks.withFileLock(filePath, fn);
  }

  /**
   * Append a single line to a file, serialized per filePath, through the ONE
   * shared lock registry. Kept as a delegate so the instance surface is
   * unchanged for callers that reached it directly.
   * @param {string} filePath - absolute file path
   * @param {string} line - the exact bytes to append (caller includes the '\n')
   * @returns {Promise<void>}
   */
  async _appendLine(filePath, line) {
    return this._locks.appendLine(filePath, line);
  }

  // ---------------------------------------------------------------------------
  // Workspace Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a new workspace for a neuma. Called once during birth ceremony completion.
   * Returns the workspace path.
   */
  async create(neumaId) {
    const ws = this._path(neumaId);

    for (const dir of sovereignDirectories(ws)) {
      await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    }
    // mkdir's mode applies ONLY to the directories it creates. A workspace
    // scaffolded before 0o700 became law keeps its 0o755 forever, and the
    // refinement authority layer refuses any directory whose mode is not
    // exactly 0o700 — so every being born earlier became unservable the day
    // that layer landed (observed 2026-08-13: […] killed the portal's LLM turn).
    // Repair belongs here, where the skeleton is already being asserted.
    await this.repairDirectoryModes(neumaId);

    console.log(`[Workspace] Created workspace for ${neumaId}`);
    return ws;
  }

  /**
   * Normalize an existing workspace's directory modes to owner-only, the mode
   * `create` declares and the refinement authority layer verifies exactly.
   * Idempotent, and never widens: a directory already at 0o700 is left alone.
   * @param {string} neumaId
   * @returns {Promise<string[]>} the directories whose mode was changed
   */
  // impure — stats and chmods the being's own directories
  async repairDirectoryModes(neumaId) {
    return repairSovereignDirectoryModes(this._path(neumaId));
  }

  /**
   * Check if a workspace exists.
   */
  async exists(neumaId) {
    try {
      await fs.access(this._path(neumaId));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lane listings (the two grounds: the house, and the witnesses beside it)
  // ---------------------------------------------------------------------------

  /**
   * List all neuma IDs that have a workspace under the root.
   *
   * THE SOVEREIGNTY BOUNDARY holds here (docs/protocols/sovereignty-boundary.md): a
   * lane carrying a `lane.json` kind marker that is not a neuma's — a sealed
   * AI WITNESS's lane rides the same workspace engine — is NOT a neuma and
   * never enters a neuma listing. Witness lanes claimed by the operator's
   * wallet were walking into listNeumaByOwner and from there into the HOUSE
   * FOUNDING roster as founders (Claude and Grok on the founding screen,
   * live 2026-07-23). A missing or unreadable marker means a being's lane
   * (every lane born before the marker existed).
   * @returns {Promise<Array<string>>} Array of neuma identifiers
   */
  async listNeuma({ root } = {}) {
    const rootDir = root || this.root;
    let entries;
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const names = entries.filter(e => e.isDirectory()).map(e => e.name);
    const kept = await Promise.all(names.map(async (name) => {
      try {
        const marker = JSON.parse(await fs.readFile(path.join(rootDir, name, 'lane.json'), 'utf8'));
        return marker && typeof marker.kind === 'string' && marker.kind !== 'neuma' ? null : name;
      } catch {
        return name; // no marker — a being's lane
      }
    }));
    return kept.filter(Boolean);
  }

  /**
   * List the sealed witnesses' lanes on their own ground. The mirror of
   * listNeuma for the beside-the-house directory — directories only, and only
   * ids that wear the witness prefix (anything else there is not a lane).
   * @returns {Promise<string[]>}
   */
  // impure — reads the witnesses root
  async listWitnessLanes() {
    let entries;
    try {
      entries = await fs.readdir(getWitnessesRoot(), { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory() && isWitnessLane(e.name)).map((e) => e.name);
  }

  /**
   * Move any witness lane that still sits INSIDE the workspaces root out to
   * the witnesses' ground (Design note, 2026-07-24: witnesses stand beside the house,
   * never in it — physically, not just in listings). Idempotent, run at every
   * boot: a clean house is a fast no-op. A lane whose target already exists
   * is SKIPPED loudly, never overwritten — two lived states must be joined by
   * a human, not a rename. Same-device moves rename; cross-device falls back
   * to copy-then-remove.
   * @returns {Promise<{moved: string[], skipped: string[]}>}
   */
  // impure — renames directories between the two grounds
  async migrateWitnessLanes() {
    const moved = [];
    const skipped = [];
    let entries;
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return { moved, skipped };
    }
    const strays = entries.filter((e) => e.isDirectory() && isWitnessLane(e.name)).map((e) => e.name);
    if (strays.length === 0) return { moved, skipped };
    await fs.mkdir(getWitnessesRoot(), { recursive: true, mode: SOVEREIGN_DIR_MODE });
    for (const laneId of strays) {
      const from = path.join(this.root, laneId);
      const to = path.join(getWitnessesRoot(), laneId);
      const collision = await fs.stat(to).then(() => true).catch(() => false);
      if (collision) {
        console.warn(`[workspace] witness lane '${laneId}' exists on BOTH grounds — left in place, join the histories by hand`);
        skipped.push(laneId);
        continue;
      }
      try {
        await fs.rename(from, to);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fs.cp(from, to, { recursive: true });
        await fs.rm(from, { recursive: true, force: true });
      }
      moved.push(laneId);
    }
    return { moved, skipped };
  }

  // ---------------------------------------------------------------------------
  // Paths and audit — the core every domain routes through
  // ---------------------------------------------------------------------------

  _path(neumaId) {
    if (!neumaId || typeof neumaId !== 'string') {
      throw new Error('Invalid neumaId');
    }
    // Only allow hex IDs, alphanumeric names, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
      throw new Error('Invalid neumaId format');
    }
    // Three kinds, three grounds: witness and harness lanes resolve BESIDE the house, never
    // in it — every engine operation (sessions, journal, DEK, vault) follows
    // this one resolver, so the split holds everywhere at once.
    const ground = isWitnessLane(neumaId) ? getWitnessesRoot() : isHarnessLane(neumaId) ? getHarnessRoot(this.root) : this.root;
    const resolved = path.resolve(path.join(ground, neumaId));
    if (!belowGround(resolved, ground)) {
      throw new Error('Path traversal denied');
    }
    // Resolve symlinks to prevent symlink-based traversal
    try {
      const real = realpathSync(resolved);
      if (!belowGround(real, ground)) {
        throw new Error('Symlink traversal denied');
      }
      return real;
    } catch (e) {
      // Path doesn't exist yet (creating new workspace) — original resolved path is safe
      if (e.code === 'ENOENT') return resolved;
      throw e;
    }
  }

  /**
   * The one public path resolver for a lane id — neuma lanes under the
   * workspaces root, witness lanes under the witnesses' ground. External
   * callers use THIS instead of joining `.root` by hand: a hand-join places
   * a witness lane inside the house, which is exactly the leak the split
   * exists to prevent.
   * @param {string} laneId
   * @returns {string} absolute lane directory
   */
  pathFor(laneId) {
    return this._path(laneId);
  }

  /**
   * Where a being's own art lives: `<lane>/art/images` or `<lane>/art/video`.
   *
   * Routed through `_path`, so it inherits the id validation AND the two-ground
   * split — a witness's art lands beside the house exactly as its sessions do,
   * and a malformed lane id throws here rather than writing somewhere unowned.
   * That is the point of putting art in the workspace at all: which folder a
   * file is in IS the answer to who made it.
   *
   * Creating the directory is the CALLER's business — this is a pure path
   * question, and a read must not have the side effect of scaffolding.
   * @param {string} laneId
   * @param {'images'|'video'|null} kind — null gives the whole `art/` tree,
   *   which is what a reader wanting BOTH channels (e.g. the gallery) asks for.
   * @returns {string}
   */
  artDir(laneId, kind = 'images') {
    const root = path.join(this._path(laneId), 'art');
    if (kind === null) return root;
    return path.join(root, kind === 'video' ? 'video' : 'images');
  }

  /**
   * Public audit entry point — append an immutable audit log entry into a
   * being's own audit/audit.jsonl. Best-effort: errors are caught upstream
   * by callers that want session creation to proceed regardless.
   * @param {string} neumaId
   * @param {string} action - e.g. 'BIRTH_RESUMED', 'BIRTH_COMPLETED-resume'
   * @param {Object} details - structured payload
   * @returns {Promise<void>}
   */
  // impure — appends to disk
  async audit(neumaId, action, details) {
    return this._audit(neumaId, action, details);
  }

  async _audit(neumaId, action, details) {
    const auditPath = path.join(this._path(neumaId), 'audit', 'audit.jsonl');
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      details
    }) + '\n';
    try {
      await this._appendLine(auditPath, line);
    } catch {
      // Workspace may not exist yet during initial creation
    }
  }
}

const workspace = new NeumaWorkspace();
export default workspace;
