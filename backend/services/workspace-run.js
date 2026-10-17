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
 * Confinement: only files inside the team workspace root run; only known
 * runnable extensions; cwd is the arena; headless env (SDL dummy video,
 * Agg matplotlib) so game loops run without a display. The witness's ACTS
 * gate governs the call itself (portal-stream).
 */

import path from 'path';
import { execFile } from 'child_process';
import { createLogger } from './logger.js';

const log = createLogger('WorkspaceRun');

// python runs WITHOUT -I: isolated mode hides user site-packages, and the
// libraries a deliverable legitimately needs (pygame et al.) live there —
// witnessed 2026-07-15: every visual artifact crashed at import under -I
// while the same file ran fine by hand. Confinement comes from the arena
// path law + the witness's ACTS gate, not from hiding the interpreter's own
// library path.
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

/**
 * Execute a deliverable in the arena and report honestly. Never throws for
 * a run outcome — a crash IS the result; throws only for invalid requests
 * (the correction goes back to the being).
 * impure — real subprocess.
 * @param {{root: string}} teamWs - connection._teamWorkspace
 * @param {{file: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, report: string}>}
 */
export const runWorkspaceFile = (teamWs, args) => {
  const { abs, argv } = resolveRunTarget(teamWs.root, args?.file);
  const requested = Number(args?.timeoutMs);
  const timeout = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, WORKSPACE_RUN_MAX_TIMEOUT_MS)
    : WORKSPACE_RUN_DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const started = Date.now();
    execFile(argv[0], argv.slice(1), {
      cwd: teamWs.root,
      timeout,
      maxBuffer: 1024 * 1024,
      // Headless: a pygame/tkinter loop must run without a display, and a
      // plotting import must not try to open a window.
      env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy', MPLBACKEND: 'Agg' },
    }, (err, stdout, stderr) => {
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
      log.info('workspace run failed', { file: abs, code: err.code, ms });
      resolve({
        ok: false,
        report: `CRASHED — exit ${err.code ?? 'signal ' + err.signal} in ${ms}ms.${errText ? `\nstderr (tail):\n${errText}` : ''}${out ? `\nstdout (tail):\n${out}` : ''}`,
      });
    });
  });
};
