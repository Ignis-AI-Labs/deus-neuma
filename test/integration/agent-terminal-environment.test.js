// Real PTY and websocket transport; this tests process inheritance, not a vendor model.
import { afterEach, expect, test } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { spawnTerminal, writeToTerminal, closeOwnedTerminal, liveTerminalCount } from '../../backend/services/terminal-manager.js';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { binOnPath } from '../../backend/services/agent-launch.js';

const owner = '0x' + 'ab'.repeat(20);
let server, client, terminal;
const saved = {};
const wait = async (predicate) => {
  const until = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('PTY proof timed out');
    await delay(20);
  }
};
afterEach(async () => {
  if (terminal) closeOwnedTerminal(terminal, owner);
  client?.terminate();
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  server = null; client = null; terminal = null;
});

test.skipIf(process.platform === 'win32').each([true, false])('actual PTY inheritance, catalog agent=%s', async (agent) => {
  const vars = { NEUMA_TEST_ENV_SENTINEL: 'harmless', TEST_API_KEY: 'harmless',
    TEST_TOKEN: 'harmless', CLAUDE_CODE_SESSION_ID: 'harmless', SHELL: '/bin/sh',
    PATH: `/tmp/neuma-env-proof/node_modules/.bin:${process.env.PATH || '/usr/bin:/bin'}` };
  for (const [key, value] of Object.entries(vars)) { saved[key] = process.env[key]; process.env[key] = value; }
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  let output = '';
  server.on('connection', (socket) => {
    const result = spawnTerminal(socket, { wallet: owner, cwd: os.tmpdir(),
      launch: agent ? { bin: process.execPath, id: 'node-environment-proof' } : null });
    terminal = result.id;
    socket.on('message', (text) => writeToTerminal(socket, text.toString()));
  });
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const messages = [];
  client.on('message', (raw) => {
    const frame = JSON.parse(raw); messages.push(frame);
    if (frame.type === 'terminal:data') output += frame.data;
  });
  await wait(() => messages.some((m) => m.type === 'terminal:hello' || m.type === 'terminal:error'));
  expect(messages.find((m) => m.type === 'terminal:error')).toBeUndefined();
  const code = 'console.log("ENV_REPORT"+JSON.stringify({present:["NEUMA_TEST_ENV_SENTINEL","TEST_API_KEY","TEST_TOKEN","CLAUDE_CODE_SESSION_ID"].map(k=>process.env[k]==="harmless"),npm:process.env.PATH.includes("/tmp/neuma-env-proof/node_modules/.bin"),term:process.env.TERM,home:!!process.env.HOME}))';
  const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  client.send(agent ? `${code}\n` : `${quote(process.execPath)} -e ${quote(code)}\n`);
  await wait(() => /ENV_REPORT\{"present":/.test(output));
  const report = JSON.parse(output.match(/ENV_REPORT(\{"present":[^\r\n]+\})/)[1]);
  expect(report.present).toEqual(Array(4).fill(!agent));
  expect(report.npm).toBe(!agent);
  expect(report.home).toBe(true);
  if (agent) expect(report.term).toBe('xterm-256color');
  expect(closeOwnedTerminal(terminal, owner)).toBe(true);
  expect(liveTerminalCount()).toBe(0);
}, 15000);


test.skipIf(process.platform === 'win32')('catalog discovery excludes npm tools but retains operator binaries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-agent-path-'));
  saved.PATH = process.env.PATH;
  try {
    const npm = path.join(root, 'node_modules', '.bin');
    const own = path.join(root, 'bin');
    await fs.mkdir(npm, { recursive: true });
    await fs.mkdir(own);
    await fs.writeFile(path.join(npm, 'neuma-env-probe'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    process.env.PATH = [npm, own].join(path.delimiter);
    expect(binOnPath('neuma-env-probe')).toBe(false);
    await fs.writeFile(path.join(own, 'neuma-env-probe'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    expect(binOnPath('neuma-env-probe')).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
