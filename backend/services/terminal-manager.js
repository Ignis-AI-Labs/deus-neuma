/**
 * Terminal manager - wallet-owned, process-local PTYs.
 *
 * The operator runs their own shell from the desk (the VS Code-style
 * integrated terminal). This is arbitrary code execution BY DESIGN — it is
 * their machine and their shell — so it is gated upstream (auth token +
 * localhost only). Wallet ownership is an application boundary, NOT OS-user
 * isolation: every shell still runs under the same operator OS account.
 * Detached terminals expire after five minutes; explicit close kills at once.
 */
import os from 'os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';
import { agentTerminalEnvironment } from './agent-terminal-environment.js';

const log = createLogger('Terminal');
// THE TERMINAL REGISTRY (friction-map D3) — keyed by a stable terminal id,
// not by the socket. A dropped socket (network blip, renderer reload) used
// to KILL the PTY — and any agent running inside it. Now a terminal
// survives detached for TERMINAL_IDLE_MS: a reconnecting socket attaches by
// id and receives the buffered scrollback. Deliberate limits, stated: a
// BACKEND restart still reaps every PTY (they are children of this process
// — surviving THAT needs a session daemon, future work), and a terminal the
// operator closed deliberately (close code 1000) dies at once.
const terminals = new Map(); // terminalId -> { proc, sockets:Set<ws>, buffer:string[], bufferBytes, idleTimer, launch, exited }
const socketTerms = new Map(); // ws -> terminalId
const MAX_TERMINALS = 10;
const TERMINAL_IDLE_MS = 5 * 60_000;
const TERMINAL_BUFFER_BYTES = 128 * 1024;

const randomId = () => `term-${randomUUID()}`;

// node-pty is an ABI-bound native addon, and this module sits on the daemon's
// BOOT path (server.js → terminal-routes → here). A static import therefore
// turns an ABI mismatch into […] rather than […] — the whole backend held hostage by a feature.
// Resolved on first spawn instead, and cached: terminals degrade, nothing else
// does. (Sibling of the better-sqlite3 ABI isolation in drivers/
// sqlite-binding.js; node-pty offers no explicit-binding option, so lazy +
// fail-soft is the available protection.)
const require = createRequire(import.meta.url);
let ptyModule; // undefined = not tried; null = tried and unavailable
export const loadPty = () => {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = require('node-pty');
  } catch (err) {
    ptyModule = null;
    log.error('node-pty unavailable — terminals are disabled for this run; everything else is unaffected', {
      err: err.message,
      hint: 'Native addon built for a different runtime. Run: node scripts/ensure-native-abi.mjs node',
    });
  }
  return ptyModule;
};

const pickShell = () =>
  process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');

/**
 * Attach an authenticated owner to a terminal, or spawn when no ID was given.
 * Streams output as `terminal:data` (buffered chunks replayed
 * first on attach), reports the exit, and self-cleans.
 * @param {import('ws').WebSocket} ws
 * @param {{wallet: string, cwd?: string, cols?: number, rows?: number, launch?: {bin: string, id: string}|null,
 *          termId?: string|null}} opts
 *   `launch` is an agent-launch catalog entry (already validated upstream):
 *   the agent binary replaces the shell as the PTY process. `termId` names a
 *   live terminal to REATTACH to; unknown/foreign IDs refuse without spawn.
 * @returns {{ok: boolean, id?: string, attached?: boolean}}
 */
// impure - PTY custody and transport output
export const spawnTerminal = (ws, { wallet, cwd, cols = 80, rows = 24, launch = null, termId = null } = {}) => {
  const owner = typeof wallet === 'string' && /^0x[0-9a-f]{40}$/i.test(wallet) ? wallet.toLowerCase() : null;
  const existing = termId ? terminals.get(termId) : null;
  if (!owner || (termId !== null && (!existing || existing.exited || existing.owner !== owner))) {
    ws.send(JSON.stringify({ type: 'terminal:error', message: 'Terminal unavailable for this wallet', code: 'terminal_unavailable' }));
    return { ok: false, closeCode: 1008 };
  }
  if (existing && !existing.exited) {
    if (existing.idleTimer) { clearTimeout(existing.idleTimer); existing.idleTimer = null; }
    existing.sockets.add(ws);
    socketTerms.set(ws, termId);
    ws.send(JSON.stringify({ type: 'terminal:hello', id: termId, attached: true }));
    for (const chunk of existing.buffer) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'terminal:data', data: chunk }));
    }
    log.info('Terminal reattached', { id: termId, sockets: existing.sockets.size });
    return { ok: true, id: termId, attached: true };
  }
  if (terminals.size >= MAX_TERMINALS) {
    ws.send(JSON.stringify({ type: 'terminal:error', message: 'Too many terminals open' }));
    return { ok: false };
  }
  const pty = loadPty();
  if (!pty) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      message: 'Terminals are unavailable on this install — the PTY module could not load. The rest of NEUMA is unaffected.',
    }));
    return { ok: false };
  }
  let proc;
  try {
    proc = pty.spawn(launch ? launch.bin : pickShell(), [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || os.homedir(),
      env: launch ? agentTerminalEnvironment(process.env, process.platform) : { ...process.env },
    });
  } catch (err) {
    log.error('PTY spawn failed', { err: err.message, launch: launch?.id ?? null });
    ws.send(JSON.stringify({
      type: 'terminal:error',
      message: launch ? `Could not start ${launch.id} — is it installed?` : 'Could not start a shell',
    }));
    return { ok: false };
  }
  const id = randomId();
  const entry = {
    owner,
    proc,
    sockets: new Set([ws]),
    buffer: [],
    bufferBytes: 0,
    idleTimer: null,
    launch,
    exited: false,
  };
  terminals.set(id, entry);
  socketTerms.set(ws, id);
  ws.send(JSON.stringify({ type: 'terminal:hello', id, attached: false }));
  proc.onData((data) => {
    entry.buffer.push(data);
    entry.bufferBytes += Buffer.byteLength(data);
    while (entry.bufferBytes > TERMINAL_BUFFER_BYTES && entry.buffer.length > 1) {
      entry.bufferBytes -= Buffer.byteLength(entry.buffer[0]);
      entry.buffer.shift();
    }
    for (const socket of entry.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'terminal:data', data }));
    }
  });
  proc.onExit(({ exitCode }) => {
    entry.exited = true;
    for (const socket of entry.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'terminal:exit', code: exitCode }));
    }
    releaseTerminal(id);
  });
  return { ok: true, id };
};

export const writeToTerminal = (ws, data) => {
  const id = socketTerms.get(ws);
  const entry = id ? terminals.get(id) : null;
  if (entry && !entry.exited && typeof data === 'string') entry.proc.write(data);
};

export const resizeTerminal = (ws, cols, rows) => {
  const id = socketTerms.get(ws);
  const entry = id ? terminals.get(id) : null;
  if (entry && cols > 0 && rows > 0) {
    try { entry.proc.resize(cols, rows); } catch { /* racing the exit — harmless */ }
  }
};

/**
 * A socket went away. A DELIBERATE close (code 1000 — the operator closed
 * the terminal window) kills the PTY at once, as the old law did. Any other
 * departure (drop, reload, restart of the renderer) leaves the terminal
 * alive and detached for TERMINAL_IDLE_MS — a reconnecting socket attaches
 * by id and never loses an agent mid-run.
 * @param {import('ws').WebSocket} ws
 * @param {{code?: number}} [info]
 */
export const killTerminal = (ws, { code } = {}) => {
  const id = socketTerms.get(ws);
  socketTerms.delete(ws);
  const entry = id ? terminals.get(id) : null;
  if (!entry) return;
  entry.sockets.delete(ws);
  if (code === 1000 || entry.exited) {
    releaseTerminal(id);
    return;
  }
  if (entry.sockets.size > 0) return;
  if (!entry.idleTimer) {
    entry.idleTimer = setTimeout(() => {
      releaseTerminal(id);
      log.info('Terminal reaped after idle detach', { id });
    }, TERMINAL_IDLE_MS);
    entry.idleTimer.unref?.();
  }
};

// impure - all exit paths release timers, associations and the process together
const releaseTerminal = (id) => {
  const entry = terminals.get(id);
  if (!entry) return;
  terminals.delete(id);
  clearTimeout(entry.idleTimer);
  for (const socket of entry.sockets) {
    socketTerms.delete(socket);
    if (socket.readyState === socket.OPEN) socket.close(1000, 'terminal ended');
  }
  entry.sockets.clear();
  if (!entry.exited) {
    try { entry.proc.kill(); } catch (err) { log.warn('PTY kill failed', { id, err: err.message }); }
  }
};

/** Close a terminal by its authenticated owner; missing and foreign IDs are indistinguishable. */
// impure
export const closeOwnedTerminal = (id, wallet) => {
  const entry = terminals.get(id);
  if (!entry?.owner || entry.owner !== wallet?.toLowerCase()) return false;
  releaseTerminal(id);
  return true;
};

// impure - the registry promises recovery only within this backend process.
process.once('exit', () => { for (const id of terminals.keys()) releaseTerminal(id); });

/** Test/custody probe — how many terminals are alive right now. */
export const liveTerminalCount = () => terminals.size;
