/**
 * BACKEND TAKEOVER — an update replaces the whole installation, backend included.
 *
 * 2026-11-10: a person updated, the new version started while the replaced version's backend
 * still served, and the desk either refused to start or ran beside the old backend and could not
 * find the person's wallet. electron/backend-takeover.cjs stops a leftover of ours whose desk is
 * gone, and never touches a backend whose desk lives or a process that is not ours.
 *
 * Real processes on real ports, no mocks: each "backend" is a real Node process whose script is
 * a real backend/server.js file, listening on an ephemeral port, in its own process group the way
 * the desk spawns one. Linux is where the proc reading runs; the pure readers run everywhere.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { takeOverPort, findListener, isBackendArgv, listeningInodes, netstatListener } = require('../../electron/backend-takeover.cjs');

const SERVER = `
const http = require('node:http');
const s = http.createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ status: 'healthy', components: {} })); });
s.listen(0, '127.0.0.1', () => process.send ? process.send(s.address().port) : console.log(s.address().port));
`;

const roots = [];
const children = [];
afterEach(() => {
  for (const c of children.splice(0)) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** A real listening process; `name` decides whether its argv looks like a NEUMA backend. */
const listener = (name, env = {}) => new Promise((resolve, reject) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'takeover-'));
  roots.push(root);
  const file = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, SERVER);
  const child = spawn(process.execPath, [file], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, ...env } });
  children.push(child);
  child.once('message', (port) => resolve({ child, port }));
  child.once('error', reject);
});

const isFree = (port) => new Promise((resolve) => {
  const s = net.createConnection({ host: '127.0.0.1', port });
  s.once('connect', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(true));
});

const deadPid = () => new Promise((resolve) => {
  const c = execFile(process.execPath, ['-e', '0'], () => resolve(c.pid));
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('the readers (pure)', () => {
  it('knows a NEUMA backend by its script, on either separator', () => {
    expect(isBackendArgv(['/opt/x/neuma', '/tmp/.mount_x/resources/app/backend/server.js'])).toBe(true);
    expect(isBackendArgv(['C:\\Program Files\\Deus Neuma\\Deus Neuma.exe', 'C:\\Program Files\\Deus Neuma\\resources\\app\\backend\\server.js'])).toBe(true);
    expect(isBackendArgv(['node', '/srv/other/server.js'])).toBe(false);
    expect(isBackendArgv(['node', '/srv/backend/server.json'])).toBe(false);
  });
  it('reads the listening socket of a port from /proc/net/tcp and from netstat', () => {
    const table = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:B8AD 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1',
      '   1: 0100007F:B8AD 0100007F:D4A2 01 00000000:00000000 00:00000000 00000000  1000        0 515151 1',
    ].join('\n');
    expect(listeningInodes(table, 0xB8AD)).toEqual(['424242']); // LISTEN only, never the connection
    expect(listeningInodes(table, 47317)).toEqual([]);
    const netstat = '  Proto  Local Address  Foreign Address  State  PID\n  TCP    127.0.0.1:47317  0.0.0.0:0  LISTENING  5120\n  TCP    127.0.0.1:47317  127.0.0.1:50000  ESTABLISHED  5120';
    expect(netstatListener(netstat, 47317)).toBe(5120);
    expect(netstatListener(netstat, 47318)).toBeNull();
  });
});

describe.runIf(process.platform === 'linux')('takeOverPort on real processes', () => {
  it('finds the real process that listens on a port', async () => {
    const { child, port } = await listener('resources/app/backend/server.js');
    expect(await findListener(port)).toBe(child.pid);
  });

  it('STOPS a leftover backend whose desk is gone, and the port is free after', async () => {
    const dead = await deadPid();
    const { child, port } = await listener('resources/app/backend/server.js', { NEUMA_DESK_PID: String(dead) });
    const took = await takeOverPort(port, { isFree });
    expect(took).toEqual({ outcome: 'stopped', pid: child.pid });
    expect(alive(child.pid)).toBe(false);
    expect(await isFree(port)).toBe(true);
  });

  it('NEVER touches a backend whose desk is still alive', async () => {
    const { child, port } = await listener('resources/app/backend/server.js', { NEUMA_DESK_PID: String(process.pid) });
    expect(await takeOverPort(port, { isFree })).toEqual({ outcome: 'desk-alive', pid: child.pid });
    expect(alive(child.pid)).toBe(true);
  });

  it('NEVER touches a process that is not a NEUMA backend', async () => {
    const dead = await deadPid();
    const { child, port } = await listener('somebody/else/server.js', { NEUMA_DESK_PID: String(dead) });
    const took = await takeOverPort(port, { isFree });
    expect(took.outcome).toBe('not-ours');
    expect(alive(child.pid)).toBe(true);
  });

  it('a free port is simply free', async () => {
    const { child, port } = await listener('resources/app/backend/server.js');
    process.kill(-child.pid, 'SIGKILL');
    await new Promise((r) => child.once('exit', r));
    expect(await takeOverPort(port, { isFree })).toEqual({ outcome: 'free' });
  });
});
