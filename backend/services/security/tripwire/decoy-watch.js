// Decoy watch — sees a decoy being opened. Two eyes, neither needs root:
//
//   inotify  — the kernel reports an open the instant it happens. Node's own
//              fs.watch cannot ask for open/read events, so this runs the
//              system's `inotifywait` (inotify-tools) when it is installed.
//              It is looked up at fixed system paths only, never through
//              PATH: a watch that runs whatever a user-writable folder named
//              `inotifywait` would be the door, not the guard.
//   atime    — the fallback. A planted file's access time is set before its
//              modify time, so the next read moves it; a stat each second
//              sees that. Blind on a `noatime` mount — `probeAtime` measures
//              it rather than assuming.
//
// A hit is `{ path, kind: 'read' | 'removed', at }`. The watch never reads a
// decoy itself.

import fs from 'fs/promises';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { armFile } from './decoy-store.js';

const INOTIFYWAIT_PATHS = Object.freeze(['/usr/bin/inotifywait', '/bin/inotifywait', '/usr/local/bin/inotifywait']);
const SAME_READ_MS = 2000;

/** The system's inotifywait, or null. impure. */
export const findInotifywait = async () => {
  for (const path of INOTIFYWAIT_PATHS) {
    const stat = await fs.stat(path).catch(() => null);
    if (stat?.isFile() && stat.uid === 0) return path;
  }
  return null;
};

/**
 * pure — one `%e|%w%f` line from inotifywait → a hit kind and path, or null.
 * OPEN and ACCESS are a read; DELETE_SELF and MOVE_SELF are a removal.
 */
export const parseInotifyLine = (line) => {
  const cut = line.indexOf('|');
  if (cut < 1) return null;
  const events = line.slice(0, cut).split(',');
  const path = line.slice(cut + 1);
  if (!path) return null;
  if (events.includes('DELETE_SELF') || events.includes('MOVE_SELF')) return { kind: 'removed', path };
  if (events.includes('OPEN') || events.includes('ACCESS')) return { kind: 'read', path };
  return null;
};

/**
 * Does this folder's filesystem move a file's access time on a read? Reads
 * one byte of the armed file and re-arms it. impure.
 */
export const probeAtime = async (path) => {
  const armed = await armFile(path);
  const handle = await fs.open(path, 'r');
  await handle.read(Buffer.alloc(1), 0, 1, 0);
  await handle.close();
  const after = await fs.stat(path);
  await armFile(path);
  return after.atimeMs > armed.atimeMs;
};

/**
 * Watch a set of decoy files.
 * @param {{paths: string[], onHit: Function, onDown?: Function, pollMs?: number, inotifywait?: ?string}} opts
 *   inotifywait — the binary to run, or null for the atime eye
 * @returns {{mode: 'inotify'|'atime', ready: Promise<boolean>, stop: () => void}}
 *   ready — true once the watch really stands (the kernel holds every watch,
 *   or the first access-time pass armed every file); false if it never did
 */
// impure
export const createDecoyWatch = ({ paths, onHit, onDown = () => {}, pollMs = 1000, inotifywait = null }) => {
  const lastRead = new Map();
  const gone = new Set();
  const report = (kind, path) => {
    const at = Date.now();
    if (kind === 'removed') {
      if (gone.has(path)) return;
      gone.add(path);
    } else {
      // An open and the read that follows it are one hit.
      if (at - (lastRead.get(path) || 0) < SAME_READ_MS) return;
      lastRead.set(path, at);
    }
    onHit({ path, kind, at });
  };

  if (inotifywait) {
    const child = spawn(inotifywait, [
      '-m', '-e', 'open', '-e', 'access', '-e', 'delete_self', '-e', 'move_self',
      '--format', '%e|%w%f', '--', ...paths,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stopped = false;
    // inotifywait says so on stderr once the kernel holds every watch; until
    // then an open goes unseen, so the caller waits on this.
    const ready = new Promise((resolve) => {
      createInterface({ input: child.stderr }).on('line', (line) => { if (line.includes('Watches established')) resolve(true); });
      child.on('exit', () => resolve(false));
      child.on('error', () => resolve(false));
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const hit = parseInotifyLine(line);
      if (hit) report(hit.kind, hit.path);
    });
    child.on('error', () => { if (!stopped) onDown('inotifywait could not start'); });
    child.on('exit', (code) => { if (!stopped) onDown(`inotifywait stopped (${code})`); });
    return { mode: 'inotify', ready, stop: () => { stopped = true; child.kill(); } };
  }

  const armed = new Map();
  let busy = false;
  const pass = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const path of paths) {
        const stat = await fs.stat(path).catch(() => null);
        if (!stat) {
          report('removed', path);
        } else if (!armed.has(path)) {
          armed.set(path, (await armFile(path)).atimeMs);
        } else if (stat.atimeMs > armed.get(path)) {
          report('read', path);
          armed.set(path, (await armFile(path)).atimeMs);
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => { pass().catch(() => {}); }, pollMs);
  timer.unref?.();
  const ready = pass().then(() => true, () => false);
  return { mode: 'atime', ready, stop: () => clearInterval(timer) };
};
