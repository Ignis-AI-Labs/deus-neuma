// cdp-pipe — a Chromium spoken to over the two pipes --remote-debugging-pipe opens (it reads
// commands on fd 3 and writes answers on fd 4, each message ending in a NUL byte).
//
// Why a pipe and not a port: a DevTools port on loopback is a door any program on this computer can
// walk through and drive the browser, logins and all. A pipe belongs to the process that spawned
// it — nothing else on the machine can attach to a neuma's browser. impure (child process, pipes)
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const CALL_TIMEOUT_MS = 30_000;
const STDERR_TAIL = 2_000;

// impure — end the browser and every helper process it started
const killTree = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
};

/**
 * Start a Chromium and open its DevTools pipe. impure
 * @param {string} executable
 * @param {string[]} args - launch flags (the pipe flag is added here)
 * @param {Record<string,string>} env
 * @returns {{send: (method: string, params?: object, sessionId?: string) => Promise<object>,
 *   events: EventEmitter, kill: () => void, isClosed: () => boolean, stderrTail: () => string}}
 *   `events` emits 'event' for every protocol event and 'exit' once when the browser ends.
 */
export const openCdpPipe = (executable, args, env) => {
  const child = spawn(executable, [...args, '--remote-debugging-pipe'], {
    env,
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    // its own process group, so ending it ends the renderers and helpers it spawned
    detached: process.platform !== 'win32',
  });
  const events = new EventEmitter();
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  let stderr = '';
  let closed = false;
  const [, , errOut, toBrowser, fromBrowser] = child.stdio;

  const failAll = (error) => {
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    pending.clear();
  };

  errOut.setEncoding('utf8');
  errOut.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_TAIL); });
  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\0'); end !== -1; end = buffer.indexOf('\0')) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try { message = JSON.parse(raw); } catch { continue; }
      const call = message.id ? pending.get(message.id) : null;
      if (call) {
        pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
        else call.resolve(message.result || {});
      } else if (message.method) {
        events.emit('event', message);
      }
    }
  });
  // A pipe error is the browser going away; the exit handler below says so to every caller.
  toBrowser.on('error', () => {});
  fromBrowser.on('error', () => {});
  child.on('error', (error) => { stderr += `\n${error.message}`; });
  child.once('exit', () => {
    closed = true;
    failAll(new Error('the browser closed'));
    events.emit('exit');
  });

  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error('the browser closed'));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer, method });
    toBrowser.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });

  return {
    send,
    events,
    kill: () => killTree(child),
    isClosed: () => closed,
    stderrTail: () => stderr,
  };
};
