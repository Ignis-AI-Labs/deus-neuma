/**
 * The engine's memory box. On Linux with a systemd user session the ComfyUI
 * engine launches inside a transient scope with a hard RAM ceiling and no swap:
 * a job bigger than the machine can spare is killed INSIDE the box instead of
 * pushing the whole desktop into swap or the global OOM killer (measured
 * 2026-10-18: an LTX render boxed at 16 GB was killed alone, the rig untouched).
 * `--scope` execs the command in place, so the child pid IS the engine's.
 * Elsewhere (macOS, Windows, no user bus) the engine launches as before.
 */
import { spawnSync } from 'child_process';

let _available = null;

// impure — can this machine box a process? Probed once: one no-op scope.
export const memoryScopeAvailable = () => {
  if (_available === null) {
    _available = process.platform === 'linux'
      && spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true'], { timeout: 5000 }).status === 0;
  }
  return _available;
};

/**
 * The launch line, boxed when a ceiling is given. Pure.
 * @param {string} cmd @param {string[]} args @param {number|null} ceilingGb
 * @returns {{cmd: string, args: string[]}}
 */
export const boxedLaunch = (cmd, args, ceilingGb) => (Number.isFinite(ceilingGb) && ceilingGb > 0
  ? { cmd: 'systemd-run', args: ['--user', '--scope', '-q', '-p', `MemoryMax=${ceilingGb}G`, '-p', 'MemorySwapMax=0', '--', cmd, ...args] }
  : { cmd, args });
