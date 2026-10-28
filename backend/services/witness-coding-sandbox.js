/**
 * The coding shell — commands against the LIVE ground through a kernel overlay.
 *
 * A being's shell used to run in a disposable COPY of the focused folder,
 * served at the ground's own path. Every freshness signal for that copy
 * eventually lied: INFRA-014 keyed refresh to the ground's git HEAD, so
 * worktree drift — the being's own uncommitted work, written live through its
 * filesystem tools — was invisible, and the shell answered MODULE_NOT_FOUND
 * for files those tools had just written (Cael's benchmarks seat,
 * 2026-08-16). Two realities under one path cannot be kept honest by any
 * refresh signal, so the copy is gone.
 *
 * The shell now mounts a kernel overlay at the ground's own path: the lower
 * layer IS the live folder; a freshness guard refuses changed lower subtrees
 * under prior upper writes. The upper is a per-lane directory that catches
 * every write (a shell command never alters the live folder), and
 * secret-shaped paths are masked by read-only empty binds on top — a shell is
 * not subject to the file-tool sandbox's denied-path list, so the mount
 * itself must keep .env, keys, git internals, and other beings' lanes out of
 * view. Commands still run under bubblewrap with an empty HOME, a scrubbed
 * environment, no network, and hard ulimits.
 *
 * THE OPEN FOLDER on AUTO (ruling, 2026-10-28; open-folder-autonomy.js): when
 * the chat is on AUTO and the shell's ground is the operator's open folder, the
 * overlay stands aside and the live folder itself is mounted — a being works
 * for real where the operator is working. The masks stay on top (no .git, no
 * secrets), and so do bubblewrap, the scrubbed environment and the ulimits.
 *
 * Requires bwrap >= 0.10 with unprivileged-overlayfs kernel support (>= 5.11),
 * checked for platform/executable availability before preparation and execution.
 * Kernel or mount refusals remain errors — never an unconfined fallback.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { assertCodingShellAvailable } from './coding-shell-availability.js';
import { startTimer, finishTimer } from './operation-timing.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import { matchesDeniedPattern } from './tool-sandbox.js';
import { NEVER_REQUESTABLE } from './sensitive-grants.js';
import { prepareOverlayFreshness, assertOverlayFresh, lockOverlay } from './overlay-freshness.js';
import { outwardNetwork } from './shell-network-resources.js';
import { isSecretFile } from './secret-path-classifier.js';
import { linkedSecrets } from './secret-inodes.js';
import { findSecretTwins } from './secret-twin-finder.js';
import { createCommandOutput } from './coding-command-output.js';
import { ensureCodingBase, activeCodingDirectory, freshCodingDirectory, assertActiveCodingShell } from './coding-shell-storage.js';
export { sandboxPathFor } from './coding-shell-storage.js';

// Directory names that are secret-shaped wherever they appear. Size-motivated
// exclusions from the copy era (dist, coverage, node_modules, .venv) are gone:
// the lower layer is the live ground, so hiding them would cost nothing and
// protect nothing. `workspaces` and `ai-witnesses` stay — other beings'
// sovereign lanes are as private in a shell as behind the file tools.
const MASKED_DIRECTORY_NAMES = new Set([
  '.aws', '.azure', '.docker', '.git', '.gnupg', '.kube', '.secrets', '.ssh',
  '.terraform', 'ai-witnesses', 'keys', 'secrets', 'vault', 'workspaces',
]);
// Sovereign state under any `data/` parent, matching the file-tool sandbox's
// SECRET_PATTERNS — a being mid-shell can never read another's DNA either.
const MASKED_DATA_CHILDREN = new Set(['dna', 'dna-cache', 'memory-store']);

// The sweep is bounded on both axes and fails CLOSED past either bound: an
// unswept ground gets no shell, never a shell with unswept secrets. The walk
// Neuma's installed Python/voice dependency trees exceed the former 400k
// budget. Keep a finite entry bound while requiring the entire tree to finish;
// no additional dependency trees are exempted to regain availability.
const MASK_WALK_LIMIT = 2_000_000;
const MASK_COUNT_LIMIT = 2_000;
const WALK_BATCH = 16;

// pure — should this directory be masked wholesale? `parent` is its container.
const isMaskedDirectory = (root, parent, name) => {
  const folded = name.toLowerCase();
  if (MASKED_DIRECTORY_NAMES.has(folded) || isSecretFile(name)) return true;
  if (MASKED_DATA_CHILDREN.has(folded) && path.basename(parent).toLowerCase() === 'data') return true;
  // The install's own settings, root-level only — `data/settings` deeper in an
  // ordinary repository is ordinary source (THE FOCUS GROUND's law).
  return folded === 'settings' && parent.toLowerCase() === path.join(root, 'data').toLowerCase();
};

/**
 * impure (readdir walk) — every path under `sourceRoot` the shell must not
 * see: secret-shaped files anywhere, secret-shaped directories wholesale, and
 * any file anywhere (node_modules too) that is a hard link to a known secret.
 * Masked directories are pruned (their contents hide with them); node_modules
 * is walked into neither — never masked, never swept — the same exposure the
 * copy design had when it ro-bound the real dependency tree into the shell.
 * @param {string} sourceRoot canonical ground directory
 * @returns {Promise<{dirs: string[], files: string[]}>} absolute paths to mask
 */
export const enumerateSecretMasks = async (sourceRoot) => {
  const root = path.resolve(sourceRoot);
  const dirs = [];
  const files = [];
  const assertMaskBound = () => {
    if (dirs.length + files.length > MASK_COUNT_LIMIT) {
      throw new Error(`the focused folder at ${root} holds over ${MASK_COUNT_LIMIT} secret-shaped paths — beyond the mask bound, so no coding shell exists for this ground. The filesystem tools still read and write it.`);
    }
  };
  let visited = 0;
  let queue = [root];
  while (queue.length > 0) {
    const batch = queue.splice(0, WALK_BATCH);
    const listed = await Promise.all(batch.map(async (dir) => ({
      dir, entries: await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
        throw new Error(`Secret sweep could not read ${dir} (${error.code || 'read error'}); no coding shell was prepared. Restore directory access or focus a readable project subfolder.`, { cause: error });
      }),
    })));
    for (const { dir, entries } of listed) {
      for (const entry of entries) {
        visited += 1;
        if (visited > MASK_WALK_LIMIT) {
          throw new Error(`the focused folder at ${root} holds over ${MASK_WALK_LIMIT} entries — the secret sweep stopped in ${dir} with ${queue.length} directories still queued, so no coding shell exists for this ground. Focus a smaller project subfolder; recovery of the same root cannot change this bound. The filesystem tools still read and write it.`);
        }
        const candidate = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (isMaskedDirectory(root, dir, entry.name)) dirs.push(candidate);
          else if (entry.name.toLowerCase() !== 'node_modules') queue.push(candidate);
        } else if (isSecretFile(candidate)) {
          files.push(candidate);
        }
        assertMaskBound();
      }
    }
  }
  // A hard-linked twin of a known secret carries the secret's bytes under an
  // innocent name, node_modules included (secret-inodes.js). Searched only
  // when some known secret HAS a second link — on a healthy machine none does
  // and the sweep stays readdir-only. A twin inside a masked folder is hidden
  // with it already.
  const linked = linkedSecrets();
  const hidden = (p) => files.includes(p) || dirs.some((d) => p.startsWith(`${d}${path.sep}`));
  if (linked.length > 0) files.push(...(await findSecretTwins([root], linked)).filter((p) => !hidden(p)));
  assertMaskBound();
  return { dirs, files };
};

// impure (policy read) — the lane's sensitive READ grants, minus any
// hand-written entries naming the never-requestable set: a grant file is
// data, the law is not. The file lane already honors these; the shell's
// kernel mask must agree or a granted .env reads empty in-shell (Founder's
// request-approval flow, 2026-08-18).
const sensitiveReadExemptions = async (laneId) => {
  const policy = await readExecutionToolPolicy(laneId);
  const read = Array.isArray(policy?.sensitiveGrants?.read) ? policy.sensitiveGrants.read : [];
  return read.filter((p) => typeof p === 'string' && path.isAbsolute(p)
    && !NEVER_REQUESTABLE.some((n) => matchesDeniedPattern(p.toLowerCase(), n)));
};

/**
 * Create or reopen the persistent overlay shell for this lane/source.
 *
 * The upper layer persists across turns, so shell work accumulates exactly as
 * the old copy did; `since` reports how long that has been true. The secret
 * masks are swept fresh on every call — a mask list is only as honest as the
 * moment it was taken. Old copy-era snapshots (`workspace/` + `sandbox.json`)
 * are left untouched where they exist: they may hold un-harvested work, and a
 * sovereign lane is not this function's to clean.
 *
 * impure — prepares lane-side directories, sweeps the ground.
 * @param {string} laneId lane id (neuma or sealed witness)
 * @param {string} sourceRoot canonical opened workspace directory
 * @returns {Promise<{workspace:string,sourceRoot:string,created:boolean,since:(string|null),masks:{dirs:string[],files:string[]}}>}
 */
export const withCodingSandboxLock = async (laneId, sourceRoot, act) => {
  await assertCodingShellAvailable();
  const source = path.resolve(sourceRoot);
  const laneRoot = await fs.realpath(neumaWorkspace.pathFor(laneId));
  const relativeToLane = path.relative(laneRoot, source);
  if (!relativeToLane.startsWith('..') && !path.isAbsolute(relativeToLane)) {
    throw new Error('A coding shell cannot overlay its own lane');
  }
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('The coding workspace is not an existing directory');

  const base = await ensureCodingBase(laneId, source);
  const release = await lockOverlay(path.join(base, 'upper'));
  try {
    const current = await activeCodingDirectory(base);
    return await act({ base, current,
      prepareCurrent: () => prepareCodingDirectory(laneId, source, base, current),
      prepareFresh: async () => prepareCodingDirectory(laneId, source, base, await freshCodingDirectory(base)),
    });
  } finally { await release(); }
};

// impure - only called through the stable per-ground lock above.
const prepareCodingDirectory = async (laneId, source, anchor, { directory: shellDir, generation }) => {
  const workspace = path.join(shellDir, 'upper');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(shellDir, 'work'), { recursive: true });
  await fs.mkdir(path.join(shellDir, 'empty-dir'), { recursive: true });
  await fs.writeFile(path.join(shellDir, 'empty'), '', { flag: 'wx' })
    .catch((err) => { if (err.code !== 'EEXIST') throw err; });

  const marker = path.join(shellDir, 'shell.json');
  let record = null;
  try {
    const parsed = JSON.parse(await fs.readFile(marker, 'utf8'));
    if (parsed?.sourceRoot === source) record = parsed;
  } catch { /* first use */ }
  const created = !record;
  if (created) {
    record = { version: 3, sourceRoot: source, createdAt: new Date().toISOString() };
    await fs.writeFile(marker, JSON.stringify(record, null, 2), { mode: 0o600 });
  }

  const exemptions = await sensitiveReadExemptions(laneId);
  const masks = await enumerateSecretMasks(source);
  // The sensitive-grant door, shell-side: an operator-granted path is NOT
  // masked — the being reads the real bytes in-shell, as it does through the
  // file lane. (Read tier only: in-shell writes land in the overlay upper by
  // design, so there is no edit-tier seam here to honor.)
  const honored = (p) => exemptions.some((e) => p === e || p.startsWith(e + path.sep));
  const visibleMasks = { dirs: masks.dirs.filter((p) => !honored(p)), files: masks.files.filter((p) => !honored(p)) };
  await prepareOverlayFreshness({ workspace, sourceRoot: source, masks: visibleMasks });
  await assertOverlayFresh({ workspace, sourceRoot: source });
  return {
    anchor,
    generation,
    workspace,
    sourceRoot: source,
    created,
    since: record.createdAt ?? null,
    masks: visibleMasks,
  };
};

/** Prepare the current shell generation under its shared execution/recovery lock. impure. */
export const ensureWitnessCodingSandbox = (laneId, sourceRoot) =>
  withCodingSandboxLock(laneId, sourceRoot, ({ prepareCurrent }) => prepareCurrent());

/** In-shell git is dead by design; this line says where the truth lives. */
export const SHELL_GIT_NOTE = "Note: Git internals are masked here. coding/ground_git reads live branch state; map/read_history reads commits. Follow the repository's sync workflow: where scripts/sync-from-dev.mjs exists, finish and publish owned work, wait for its approved merge to dev, then use that script from the operator's live checkout with a clean tree/index and no pending Git operation. coding/ground_sync refuses these dedicated-workflow checkouts; elsewhere it offers approved upstream fast-forward only. In-shell git cannot fetch.";

/**
 * The one truth every seat's sandbox_status renders. Pure.
 * @param {{workspace:string,sourceRoot:string,since:(string|null)}} sandbox
 * @returns {string}
 */
export const sandboxStatusText = (sandbox) => [
  `Shell ground: ${sandbox.sourceRoot} — the live focused folder.`,
  'On AUTO in the operator\'s open folder, the shell works on that folder FOR REAL: writes land in it, .git and secrets stay masked.',
  'Otherwise it is seen through a kernel overlay: prior shell writes shadow the live lower, commands refuse lower drift under those shadows, and preserved work is never silently reset.',
  `Overlay writes land in your overlay layer (host path ${sandbox.workspace}, holding work since ${sandbox.since || 'this turn'}) — an overlay command never alters the live folder itself.`,
  "Secret-shaped paths (.env, keys, .git, other beings' lanes) are masked from this shell's view.",
  SHELL_GIT_NOTE,
].join('\n');

const clampTimeout = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 1000), 120000) : 30000;
};

const commandMode = (value) => (value === 'write' ? 'write' : 'inspect');

/**
 * The confinement every being-run command shares — the coding shell's and a
 * team's workspace run: fresh namespaces (the network's too unless the
 * operator granted it), an EMPTY environment but for the few names set here,
 * the system read-only, and an empty /etc, /tmp and HOME. Pure. The caller
 * adds its own view of the ground on top; bwrap applies mounts in order.
 * @param {{network?: boolean}} [opts]
 * @returns {string[]} bwrap arguments
 */
export const confinedBaseArgs = ({ network = false } = {}) => [
  '--die-with-parent', '--new-session',
  ...(network === true
    ? ['--unshare-user', '--unshare-ipc', '--unshare-uts', '--unshare-pid', '--unshare-cgroup', '--share-net']
    : ['--unshare-all']),
  '--clearenv',
  '--ro-bind', '/usr', '/usr',
  '--ro-bind', '/bin', '/bin',
  '--ro-bind', '/lib', '/lib',
  '--ro-bind', '/lib64', '/lib64',
  '--tmpfs', '/etc',
  '--proc', '/proc', '--dev', '/dev',
  '--tmpfs', '/tmp', '--tmpfs', '/home', '--dir', '/home/witness',
  // The browsers this machine installed for Playwright, read-only, where a
  // being's HOME looks for them — so the press, page renders and browser
  // tests run in the shell as they do for the operator — and the font
  // configuration they need. `-try`: a machine without them keeps its shell.
  '--ro-bind-try', path.join(os.homedir(), '.cache', 'ms-playwright'), '/home/witness/.cache/ms-playwright',
  '--ro-bind-try', '/etc/fonts', '/etc/fonts',
  '--setenv', 'HOME', '/home/witness',
  '--setenv', 'PATH', process.env.PATH || '/usr/bin:/bin',
  '--setenv', 'LANG', process.env.LANG || 'C.UTF-8',
  '--setenv', 'CI', '1', '--setenv', 'NO_COLOR', '1',
];

// WASM reserves far more address space than resident memory: four 64KiB
// memories fail under 16GiB on Node24 — and a browser's engine reserves a
// cage of about a terabyte before it draws a page (Chromium dies at 64GiB with
// "Oilpan: CagedHeap reservation", measured 2026-10-28). Keep a finite 2TiB
// per-process ADDRESS limit — reserved space, not memory used; this is not an
// aggregate worker or physical-memory budget.
// RLIMIT_NPROC counts threads too; multicore tooling exceeds 256 tasks.
export const CONFINED_ULIMITS = 'ulimit -t 120 -v 2147483648 -f 1048576 -n 4096 -u 4096';

// The mount plan: overlay first, masks ON TOP — bwrap applies mounts in
// order, so each mask shadows the overlay's view of that path. Dir masks are
// READ-ONLY empty directories (never tmpfs): a write into a masked directory
// must fail loudly, not land in a tmpfs that vanishes when the command exits.
// The whole view mounts AT THE GROUND'S OWN PATH, so every path a being
// legitimately learned from its file tools means the same thing in the shell.
// `network` is the operator-granted mode (ruling, 2026-08-18): default keeps the
// network namespace unshared; granted swaps --unshare-all for the per-namespace
// set that keeps every other isolation and shares only the net.
// `live` is THE OPEN FOLDER on AUTO (open-folder-autonomy.js, ruling 2026-10-28):
// the live ground itself, read-write for execute and read-only for inspect —
// no overlay, but the very same masks on top, so .git and every secret stay
// out of reach and history remains the safety net.
const bwrapArgs = ({ workspace, sourceRoot, masks, command, mode, network = false, live = false }) => {
  const ground = path.resolve(sourceRoot);
  const shellDir = path.dirname(workspace);
  const args = confinedBaseArgs({ network });
  if (live) {
    args.push(mode === 'inspect' ? '--ro-bind' : '--bind', ground, ground);
  } else if (mode === 'inspect') {
    // The last --overlay-src is the top layer: prior shell work shows over
    // the live ground, and the whole view refuses writes.
    args.push('--overlay-src', ground, '--overlay-src', workspace, '--ro-overlay', ground);
  } else {
    args.push('--overlay-src', ground, '--overlay', workspace, path.join(shellDir, 'work'), ground);
  }
  const emptyFile = path.join(shellDir, 'empty');
  const emptyDir = path.join(shellDir, 'empty-dir');
  for (const dir of masks.dirs) args.push('--ro-bind', emptyDir, dir);
  for (const file of masks.files) args.push('--ro-bind', emptyFile, file);
  args.push('--chdir', ground);
  args.push('--setenv', 'NEUMA_COMMAND', command);
  return args;
};

const killProcessTree = (child) => {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
};

// impure — the kernel creates overlay workdir internals (`work/work`) with
// mode 000. We own them, so reopen them once the mount is gone; otherwise
// lane backups and cleanup cannot walk the tree (EACCES on scandir).
const unlockWorkdirInternals = (shellDir) =>
  fs.chmod(path.join(shellDir, 'work', 'work'), 0o700).catch(() => {});

/**
 * Execute one command inside the overlay shell.
 * @param {{workspace:string,sourceRoot:string,masks:{dirs:string[],files:string[]},command:string,mode?:string,timeoutMs?:number,signal?:AbortSignal}} input
 * @returns {Promise<{exitCode:number|null,stdout:string,stderr:string,timedOut:boolean,truncated:boolean,mode:string}>}
 */
const runPreparedCommand = async (input) => {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command || command.length > 4000 || /[\0\r]/.test(command)) {
    throw new Error('Command must be 1-4000 characters without NUL or carriage returns');
  }
  if (!Array.isArray(input.masks?.dirs) || !Array.isArray(input.masks?.files)) {
    throw new Error('The coding shell is not prepared — run ensureWitnessCodingSandbox first (the secret masks are part of the shell)');
  }
  const mode = commandMode(input.mode);
  const timeoutMs = clampTimeout(input.timeoutMs);
  const args = bwrapArgs({ ...input, command, mode });
  // Public DNS and trust only; the rest of /etc remains empty. Outward only: never this machine's own services.
  const net = input.network === true ? await outwardNetwork() : null;
  if (net) args.push(...net.binds);
  args.push('/bin/bash', '-lc', `${CONFINED_ULIMITS}; exec /bin/bash -lc "$NEUMA_COMMAND"`);
  const launch = net ? net.wrap(args) : { command: 'bwrap', args };

  return new Promise((resolve, reject) => {
    input.signal?.throwIfAborted();
    input.beforeSpawn?.();
    const executionTimer = startTimer();
    const child = spawn(launch.command, launch.args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = createCommandOutput();
    let timedOut = false;

    const collect = (target) => (chunk) => {
      output.append(target, chunk);
      if (typeof input.onChunk === 'function') input.onChunk({ stream: target, text: chunk.toString('utf8'), ...output.snapshot() });
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    child.once('error', reject);

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    const onAbort = () => killProcessTree(child);
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.once('close', async (exitCode) => {
      const timing = finishTimer(executionTimer);
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      await unlockWorkdirInternals(path.dirname(input.workspace));
      if (input.signal?.aborted) reject(input.signal.reason);
      else resolve({ exitCode, ...output.snapshot(), timedOut, mode, timing });
    });
  });
};

/** Run with exclusive upper ownership and freshness checks on both sides.
 * An interrupted command preserves all upper work. A LIVE run (the open folder
 * on AUTO) never touches the upper, so the overlay's own checks stand aside;
 * the lock still serializes the shell's commands. impure. */
export const runWitnessCommand = async (input) => {
  input.signal?.throwIfAborted();
  await assertCodingShellAvailable();
  input.beforeSpawn?.();
  const release = await lockOverlay(input.workspace, { directory: input.anchor });
  try {
    if (!input.live) {
      await assertActiveCodingShell(input);
      await assertOverlayFresh(input);
    }
    const result = await runPreparedCommand(input);
    if (!input.live) await assertOverlayFresh(input);
    return { ...result, live: input.live === true };
  } finally { await release(); }
};
