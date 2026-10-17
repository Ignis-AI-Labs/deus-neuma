/**
 * FILESYSTEM ROOTS AUTHORITY — which ground the native filesystem organ may
 * touch, and when that ground changes.
 *
 * The being's filesystem tool is the platform's own native organ
 * (native-filesystem.js) — in-process since 2026-08-15, when the spawned MCP
 * child died with a power-loss reboot and every file tool answered "Not
 * connected" mid-work. The organ can only touch paths under its allowed
 * roots. A neuma's sovereign lane lives under the workspaces root — the
 * operator-chosen home, often a dedicated external drive (e.g. /mnt/external)
 * and DYNAMIC (the pre-flight BROWSE can repoint it). So the roots MUST be
 * re-declared when that home changes, or the per-neuma sandbox would "allow"
 * a lane write the organ then physically refuses — exactly the contradiction
 * that failed Galen's crystallization.
 *
 * This is not birth-specific: a LIVING neuma writing into its own workspace
 * needs the same reach. The per-neuma confinement to ONE lane is enforced
 * separately in tool-sandbox.js; this module only widens the organ's reach
 * to include the house, never narrows the sandbox.
 */
import fs from 'fs/promises';
import path from 'path';
import { mcpService } from './mcp.js';
import { getWorkspacesRoot, getWitnessesRoot } from '../../core/index.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { resolveCeremonyScratchDir } from '../../core/birth/ceremony-write.js';
import { nativeFilesystemClient } from './native-filesystem.js';
import { setNativeFilesystemRoots, checkRootUsable } from './native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from './native-fs-catalog.js';
import { createLogger } from './logger.js';
import { trackFilesystemFocus, filesystemFocusRoots } from './filesystem-focus-owners.js';

const log = createLogger('MCP-FS');

/** True when `dir` is the project dir or nested under it (path-aware, so no
 *  string-prefix false matches like /x/data vs /x/database). */
const isUnderProject = (dir, projectPath) => {
  const rel = path.relative(projectPath, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Root updates mutate one shared validation wall; serialize them through a
// promise chain so two updates can never interleave (e.g. a startup +
// pre-flight race), which would leave the wall reflecting neither caller.
let reconnectChain = Promise.resolve();

// Witness-granted extra roots (read-scope approvals). The organ is shared, so
// these widen it globally — but per-being confinement still holds: tool-sandbox
// only passes a path when THAT connection carries the grant.
const grantedRoots = new Set();
// What the organ was last stood up with — lets ensureFilesystemRoots skip the
// update when every requested root is already in force.
let activeRoots = [];
let activeFocusRoots = [];

// impure — re-declares the organ's allowed roots and (re)registers it in
// mcpService; mutates module-level reconnectChain, mkdir's the workspaces root.
/**
 * Stand the native filesystem organ on the project dir AND the current
 * sovereign-workspaces root. Safe to call again when the home changes: the
 * allowed-roots wall is replaced so a repointed root takes effect. Calls are
 * serialized. Best-effort — a failure is logged loudly (never silent, Rule 3)
 * and rethrown so the caller can decide, since without its filesystem organ a
 * neuma cannot write its own DNA. The exported name keeps the verb every
 * caller has always used; nothing is spawned anymore.
 * @returns {Promise<string[]>} the allowed roots now in force
 */
export const connectFilesystemServer = async () => {
  const run = reconnectChain.then(async () => {
    const projectPath = process.cwd();
    const workspacesRoot = getWorkspacesRoot();

    const roots = [projectPath];
    const focusRoots = filesystemFocusRoots();
    // Add the workspaces root only when it is a distinct location outside the
    // project — if it already lives under the project dir, projectPath covers it.
    if (workspacesRoot && !isUnderProject(workspacesRoot, projectPath)) {
      // The house may not be created yet at startup; a root that does not
      // exist is skipped by the organ's wall, so ensure it stands first.
      await fs.mkdir(workspacesRoot, { recursive: true });
      roots.push(workspacesRoot);
    }
    // The witnesses' ground stands BESIDE the house — a sealed witness's own
    // lane must be reachable by its file tools exactly as a neuma's is.
    const witnessesRoot = getWitnessesRoot();
    if (witnessesRoot && !roots.some((r) => isUnderProject(witnessesRoot, r))) {
      await fs.mkdir(witnessesRoot, { recursive: true });
      roots.push(witnessesRoot);
    }
    // …and the harness ground beside them (harness-lane.js): a harness lane's
    // own folder — its chats, its intents — is reachable by its file tools as
    // a witness's is. Without it every write there was refused as […] (found 2026-10-14; harness-tool-batch had read red
    // since the harness lanes landed).
    const harnessRoot = workspacesRoot ? getHarnessRoot(workspacesRoot) : null;
    if (harnessRoot && !roots.some((r) => isUnderProject(harnessRoot, r))) {
      await fs.mkdir(harnessRoot, { recursive: true });
      roots.push(harnessRoot);
    }
    // THE CEREMONY SCRATCH — chosen_name.txt (#272, Aether 2026-08-06). On a
    // packaged install the scratch lives under NEUMA_DATA_ROOT, OUTSIDE every
    // root above — so the stage-4 naming write that #257 correctly re-aimed
    // was then refused by the wall itself: […], on the operator's screen, mid-naming. The
    // write-scope gate, the sandbox, and the prompt all agreed on the path;
    // the THIRD gate — the allowed set — was never told. In dev the scratch
    // sits under the project root and this is a no-op.
    const scratchDir = resolveCeremonyScratchDir(projectPath);
    if (scratchDir && !roots.some((r) => isUnderProject(scratchDir, r))) {
      await fs.mkdir(scratchDir, { recursive: true });
      roots.push(scratchDir);
    }
    // Witness-granted read scopes. Never mkdir'ed — a grant names a place that
    // exists; one the platform cannot actually read is dropped, and SAID.
    //
    // The check is the wall's own predicate, never a second opinion. It used
    // to be `stat().isDirectory()` here and in the wall, and that let `/root`
    // through both: stat succeeds on a directory this process cannot open, so
    // an unusable grant was accepted, advertised, and then failed on every
    // read. One predicate, consulted twice, cannot disagree with itself.
    for (const dir of grantedRoots) {
      if (roots.some((r) => isUnderProject(dir, r))) continue;
      const { ok, reason } = await checkRootUsable(dir);
      if (ok) roots.push(dir);
      else {
        grantedRoots.delete(dir);
        log.warn('Granted folder dropped — the platform cannot reach it', { dir, because: reason });
      }
    }

    // Focus is read from live owners on every rebuild, never persisted as a grant.
    for (const dir of focusRoots) {
      if (!roots.some((r) => isUnderProject(dir, r))) roots.push(dir);
    }

    try {
      const active = await setNativeFilesystemRoots(roots);
      if (active.length === 0) {
        throw new Error('No allowed root is a reachable directory — the filesystem organ cannot stand');
      }
      // Registration is idempotent-by-replacement; the organ appears in
      // mcpService.clients under the name every consumer already checks.
      mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
      log.info('Filesystem organ standing', { roots: active });
      activeRoots = active;
      activeFocusRoots = focusRoots;
      return active;
    } catch (err) {
      log.error('Filesystem organ failed to stand — a neuma cannot write its own workspace without it', {
        roots, error: err.message,
      });
      throw err;
    }
  });
  // Keep the chain alive regardless of this call's outcome, but don't let a
  // rejection poison the next update.
  reconnectChain = run.catch(() => {});
  return run;
};

/**
 * impure — make sure the organ's reach covers `dirs` (witness read-scope
 * grants). No-op when everything is already in force; otherwise one
 * serialized update carries all the new roots. A grant the wall cannot honor
 * (dir missing) is dropped inside connectFilesystemServer.
 * @param {string[]} dirs - Absolute directories the witness granted
 * @returns {Promise<string[]>} the roots now in force
 */
export const ensureFilesystemRoots = async (dirs = []) => {
  const wanted = dirs.filter((d) => typeof d === 'string' && path.isAbsolute(d));
  // A deliberate grant must survive even when an existing transient owner covers it.
  for (const d of wanted) grantedRoots.add(d);
  const missing = wanted.filter((d) => !activeRoots.some((r) => isUnderProject(d, r)));
  if (missing.length === 0) return activeRoots;
  return connectFilesystemServer();
};

/** impure — refresh transient reach from every live owner, including cleared focus. */
export const ensureFilesystemFocus = async (connection) => {
  trackFilesystemFocus(connection);
  const wanted = filesystemFocusRoots();
  if (wanted.length === activeFocusRoots.length && wanted.every((root) => activeFocusRoots.includes(root))
    && wanted.every((root) => activeRoots.some((active) => isUnderProject(root, active)))) return activeRoots;
  return connectFilesystemServer();
};
