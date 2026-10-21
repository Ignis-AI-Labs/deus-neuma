/**
 * workspace-run — the team's EXECUTABLE review layer (#171).
 *
 * A QA verdict on unexecuted code is advisory, not assurance (proven
 * 2026-07-15: a reviewed artifact passed py_compile and QA reading, then
 * escaped its hexagon at frame 497). This runs the team's own deliverable
 * INSIDE the assigned workspace and returns the honest report — exit code,
 * stderr, or […] (the pass
 * signal for a game/render loop that never exits by design).
 *
 * Confinement: the being wrote this code, so it runs under the coding
 * shell's bubblewrap (witness-coding-sandbox `confinedBaseArgs`): no network,
 * an empty environment, the system read-only, and of the host only the arena
 * itself, its secret-shaped paths masked. It used to run as the backend on
 * the host with the backend's whole environment, AUTH_SECRET included, so a
 * script could mint an operator session for any wallet (audit 2026-10-19).
 * Only files inside the arena run; only known runnable extensions; headless
 * env (SDL dummy video, Agg matplotlib) so game loops run without a display.
 * The bytes that run are the bytes the operator's card showed (`readScript`).
 * Without bwrap the run is refused, never run unconfined.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { createLogger } from './logger.js';
import { assertCodingShellAvailable } from './coding-shell-availability.js';
import { confinedBaseArgs, CONFINED_ULIMITS, enumerateSecretMasks } from './witness-coding-sandbox.js';
import { helperEnvironment } from './agent-terminal-environment.js';

const log = createLogger('WorkspaceRun');

// python runs WITHOUT -I: isolated mode hides user site-packages, and the
// libraries a deliverable legitimately needs (pygame et al.) live there —
// witnessed 2026-07-15: every visual artifact crashed at import under -I
// while the same file ran fine by hand. The sandbox's HOME is empty, so the
// operator's user site-packages are bound in read-only (`userSiteBinds`).
const RUNNERS = Object.freeze({
  '.py': Object.freeze(['python3']),
  '.js': Object.freeze(['node']),
  '.mjs': Object.freeze(['node']),
});

export const WORKSPACE_RUN_DEFAULT_TIMEOUT_MS = 20_000;
export const WORKSPACE_RUN_MAX_TIMEOUT_MS = 60_000;
const OUTPUT_TAIL_CHARS = 1500;

/**
 * Validate a run request against the workspace. Pure. Throws the correction
 * the being can act on.
 * @param {string} root - the team workspace root (absolute)
 * @param {*} file - the requested file (relative to the root, or absolute inside it)
 * @returns {{abs: string, argv: string[]}}
 */
export const resolveRunTarget = (root, file) => {
  const text = typeof file === 'string' ? file.trim() : '';
  if (!text) throw new Error('workspace_run needs a file — the deliverable inside the assigned workspace.');
  const abs = path.resolve(root, text);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error('workspace_run only runs files INSIDE the assigned workspace.');
  }
  const runner = RUNNERS[path.extname(abs).toLowerCase()];
  if (!runner) {
    throw new Error(`workspace_run executes ${Object.keys(RUNNERS).join(', ')} files. An .html deliverable is verified in a browser — put verifiable logic in a runnable file if you need an executed check.`);
  }
  return { abs, argv: [...runner, abs] };
};

const tail = (s) => {
  const text = String(s || '').trim();
  return text.length > OUTPUT_TAIL_CHARS ? `…${text.slice(-OUTPUT_TAIL_CHARS)}` : text;
};

const SCRIPT_MAX_BYTES = 1024 * 1024;
const CARD_HEAD_CHARS = 400;

/**
 * Read the file a run would execute, for the operator's card and the run.
 * impure — reads the file.
 * @param {string} root - the team workspace root (absolute)
 * @param {*} file - the requested file
 * @returns {Promise<{abs: string, argv: string[], bytes: Buffer, sha256: string, head: string}>}
 */
export const readScript = async (root, file) => {
  const target = resolveRunTarget(root, file);
  const stat = await fs.stat(target.abs).catch(() => null);
  if (!stat?.isFile()) throw new Error(`workspace_run found no file at ${target.abs} — write the deliverable first.`);
  if (stat.size > SCRIPT_MAX_BYTES) throw new Error(`workspace_run runs files up to ${SCRIPT_MAX_BYTES} bytes; ${target.abs} holds ${stat.size}.`);
  const bytes = await fs.readFile(target.abs);
  const text = bytes.toString('utf8');
  return {
    ...target,
    bytes,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    head: text.length > CARD_HEAD_CHARS ? `${text.slice(0, CARD_HEAD_CHARS)}\n[… ${text.length - CARD_HEAD_CHARS} more characters in the file]` : text,
  };
};

// impure (directory reads) — the operator's python user site-packages, bound
// read-only at their own paths so a deliverable's libraries import inside the
// sandbox exactly as on the host; nothing else of the home directory shows.
const userSiteBinds = async () => {
  const base = process.env.PYTHONUSERBASE || path.join(os.homedir(), '.local');
  const lib = path.join(base, 'lib');
  const names = await fs.readdir(lib).catch(() => []);
  const sites = [];
  for (const name of names.filter((n) => /^python3(\.\d+)?$/.test(n))) {
    const site = path.join(lib, name, 'site-packages');
    if ((await fs.stat(site).catch(() => null))?.isDirectory()) sites.push(site);
  }
  if (sites.length === 0) return [];
  return [...sites.flatMap((site) => ['--ro-bind', site, site]), '--setenv', 'PYTHONUSERBASE', base];
};

// pure — the sandbox for one run: the shared confinement, the arena bound at
// its own path, its secret-shaped paths masked by empty read-only binds, and
// the approved bytes bound over the file so a rewrite after the card cannot
// change what runs.
const runArgs = ({ root, abs, argv, masks, scratch, siteBinds }) => [
  ...confinedBaseArgs({ network: false }),
  '--bind', root, root,
  ...masks.dirs.flatMap((dir) => ['--ro-bind', path.join(scratch, 'empty-dir'), dir]),
  ...masks.files.flatMap((file) => ['--ro-bind', path.join(scratch, 'empty'), file]),
  '--ro-bind', path.join(scratch, 'script'), abs,
  ...siteBinds,
  // Headless: a pygame/tkinter loop must run without a display, and a
  // plotting import must not try to open a window.
  '--setenv', 'SDL_VIDEODRIVER', 'dummy', '--setenv', 'SDL_AUDIODRIVER', 'dummy', '--setenv', 'MPLBACKEND', 'Agg',
  '--chdir', root,
  '/bin/bash', '-c', `${CONFINED_ULIMITS}; exec "$@"`, 'workspace-run', ...argv,
];

// impure — the run's scratch: the approved bytes and the empty mask sources.
const prepareScratch = async (bytes) => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-workspace-run-'));
  await fs.mkdir(path.join(scratch, 'empty-dir'));
  await fs.writeFile(path.join(scratch, 'empty'), '');
  await fs.writeFile(path.join(scratch, 'script'), bytes, { mode: 0o400 });
  return scratch;
};

/**
 * Execute a deliverable in the arena and report honestly. Never throws for
 * a run outcome — a crash IS the result; throws only for invalid requests
 * (the correction goes back to the being) and for a host that cannot confine.
 * impure — real confined subprocess.
 * @param {{root: string}} teamWs - connection._teamWorkspace
 * @param {{file: string, timeoutMs?: number, sha256?: string}} args - sha256:
 *   the bytes the operator's card showed; a file changed since is refused
 * @returns {Promise<{ok: boolean, report: string}>}
 */
export const runWorkspaceFile = async (teamWs, args) => {
  const root = path.resolve(teamWs.root);
  const script = await readScript(root, args?.file);
  if (args?.sha256 && args.sha256 !== script.sha256) {
    throw new Error(`${script.abs} changed after your operator's card showed it — file the run again so the card shows what runs.`);
  }
  await assertCodingShellAvailable().catch((err) => {
    throw new Error(`workspace_run runs only confined, and this host cannot confine it: ${err.message}`);
  });
  const requested = Number(args?.timeoutMs);
  const timeout = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, WORKSPACE_RUN_MAX_TIMEOUT_MS)
    : WORKSPACE_RUN_DEFAULT_TIMEOUT_MS;
  const masks = await enumerateSecretMasks(root);
  const scratch = await prepareScratch(script.bytes);
  const bwrap = runArgs({ root, ...script, masks, scratch, siteBinds: await userSiteBinds() });

  return new Promise((resolve) => {
    const started = Date.now();
    execFile('bwrap', bwrap, {
      timeout,
      maxBuffer: 1024 * 1024,
      env: helperEnvironment(process.env, process.platform),
    }, (err, stdout, stderr) => {
      fs.rm(scratch, { recursive: true, force: true })
        .catch((cause) => log.warn('workspace run scratch not removed', { scratch, err: cause.message }));
      const ms = Date.now() - started;
      const out = tail(stdout);
      const errText = tail(stderr);
      if (!err) {
        resolve({ ok: true, report: `RAN CLEAN — exit 0 in ${ms}ms.${out ? `\nstdout (tail):\n${out}` : ''}` });
        return;
      }
      if (err.killed) {
        // The time budget ended the process. For a game/render loop that
        // never exits by design, surviving the budget without stderr IS the
        // pass; anything on stderr before the cut is still a finding.
        resolve(errText
          ? { ok: false, report: `RAN the full ${timeout}ms budget but wrote errors before the cut:\n${errText}` }
          : { ok: true, report: `RAN the full ${timeout}ms time budget without crashing (a loop that outlives the budget is expected for games/renders).${out ? `\nstdout (tail):\n${out}` : ''}` });
        return;
      }
      log.info('workspace run failed', { file: script.abs, code: err.code, ms });
      resolve({
        ok: false,
        report: `CRASHED — exit ${err.code ?? 'signal ' + err.signal} in ${ms}ms.${errText ? `\nstderr (tail):\n${errText}` : ''}${out ? `\nstdout (tail):\n${out}` : ''}`,
      });
    });
  });
};
