// impure - real isolated auth + terminal server, signed throwaway wallets, real wire.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHmac } from 'node:crypto';
import { Wallet } from 'ethers';
import WebSocket from 'ws';

/** Wait on a real observation, with real elapsed time and no fake clock. */
export const until = async (predicate, ms = 15000) => {
  const deadline = Date.now() + ms;
  do {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error(`Terminal condition not met within ${ms}ms`);
};

/** Observe the real OS process table without signaling the process. */
export const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (err) { if (err.code === 'ESRCH') return false; throw err; }
};

/** Start only production auth + terminal routes in a clean-env child, bound to :0. */
export const startTerminalKit = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'neuma-terminal-owned-'));
  const authSecret = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./terminal-lifecycle-server.mjs', import.meta.url))], {
    cwd: root,
    env: {
      NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: root, SHELL: '/bin/bash', LANG: 'C.UTF-8',
      NEUMA_DATA_ROOT: root, NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_WORKSPACE_SETTINGS_PATH: path.join(root, 'workspace-settings.json'),
      NEUMA_REALM_SETTINGS_PATH: path.join(root, 'realm-settings.json'),
      AUTH_SECRET: authSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stdout.on('data', (s) => { diagnostics += s; });
  child.stderr.on('data', (s) => { diagnostics += s; });
  let port;
  child.on('message', (m) => { port = m.port; });
  const dispose = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  };
  try {
    await until(() => {
      if (child.exitCode !== null) throw new Error(`Terminal fixture exited: ${diagnostics}`);
      return port;
    });
  } catch (err) { await dispose(); throw err; }
  const base = `http://127.0.0.1:${port}`;
  const signIn = async (wallet = Wallet.createRandom()) => {
    const challengeRes = await fetch(`${base}/api/v1/auth/challenge?address=${wallet.address}`);
    if (!challengeRes.ok) throw new Error(`Challenge refused: ${challengeRes.status}`);
    const { challenge } = await challengeRes.json();
    const signature = await wallet.signMessage(challenge);
    const res = await fetch(`${base}/api/v1/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet.address, challenge, signature }),
    });
    if (!res.ok) throw new Error(`Signed fixture login refused: ${res.status}`);
    return { wallet, ...(await res.json()) };
  };
  const count = async (identity) => {
    const res = await fetch(`${base}/fixture/count`, { headers: { Authorization: `Bearer ${identity.token}` } });
    if (!res.ok) throw new Error(`Count observation refused: ${res.status}`);
    return (await res.json()).count;
  };
  const close = (identity, id) => fetch(`${base}/api/v1/terminal/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${identity.token}` },
  });
  // Valid production token wire, short real expiry, for a wallet that already
  // passed the real signed challenge above. No clock or verifier substitution.
  const expiresWithin = (identity, ms) => {
    const payload = `${identity.address}:${Date.now() + ms}`;
    const mac = createHmac('sha256', authSecret).update(payload).digest('hex');
    return { ...identity, token: Buffer.from(`${payload}:${mac}`).toString('base64') };
  };
  return { root, base, signIn, count, close, expiresWithin, dispose };
};

/** A real client records frames without intercepting or replacing any implementation. */
export const connectTerminal = (kit, identity, termId = null) => {
  const url = new URL('/terminal-ws', kit.base.replace('http:', 'ws:'));
  url.searchParams.set('token', identity.token);
  if (termId !== null) url.searchParams.set('term', termId);
  const ws = new WebSocket(url);
  const result = { ws, frames: [], output: '', hello: null, closed: null, error: null };
  ws.on('message', (raw) => {
    const frame = JSON.parse(String(raw));
    result.frames.push(frame);
    if (frame.type === 'terminal:hello') result.hello = frame;
    if (frame.type === 'terminal:data') result.output += frame.data;
  });
  ws.on('close', (code) => { result.closed = code; });
  ws.on('error', (err) => { result.error = err; });
  result.send = (data) => ws.send(JSON.stringify({ type: 'terminal:data', data }));
  return result;
};

/** Read an output-only shell PID; echoed input cannot satisfy the match. */
export const terminalPid = async (client) => {
  await until(() => client.hello);
  client.send('printf "PID=%s\\n" "$$"\n');
  return Number(await until(() => client.output.match(/PID=(\d+)/)?.[1]));
};
