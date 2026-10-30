/**
 * Terminal agent launch — REAL stack, no mocks (RULE 0).
 *
 * A CLI agent (a real executable script shadowing the catalog bin on PATH)
 * is spawned BY the terminal route as the PTY process in the window's focus
 * folder, and its output crosses the socket. Unknown launch ids are refused
 * before any spawn. The allowlist itself is pure-tested.
 */
import { createServer } from 'http';
import { mkdir, writeFile, chmod } from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupTerminalRoutes } from '../../backend/routes/terminal-routes.js';
import { setRoots } from '../../backend/services/user-files.js';
import { AGENT_CATALOG, resolveAgent, binOnPath, availableAgents } from '../../backend/services/agent-launch.js';
import { createTempDir } from '../helpers/temp-fs.js';

const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

describe('agent-launch catalog (pure)', () => {
  test('the catalog is closed, and resolveAgent honors only it', () => {
    expect(AGENT_CATALOG.map((a) => a.id)).toContain('claude');
    expect(resolveAgent('kimi').bin).toBe('kimi');
    expect(resolveAgent('nope')).toBe(null);
    expect(resolveAgent('kimi; rm -rf /')).toBe(null);
    expect(resolveAgent('')).toBe(null);
  });

  test('binOnPath refuses paths and finds real executables', () => {
    expect(binOnPath('/etc/passwd')).toBe(false);
    expect(binOnPath('definitely-not-a-real-binary-xyz')).toBe(false);
    expect(binOnPath('sh')).toBe(true);
  });

  test('availableAgents only ever lists real binaries', () => {
    for (const a of availableAgents()) {
      expect(binOnPath(resolveAgent(a.id).bin)).toBe(true);
    }
  });
});

describe('terminal ?launch= (real PTY, real socket)', () => {
  let httpServer;
  let wss;
  let baseUrl;
  let root;
  let binDir;
  let savedPath;

  beforeAll(async () => {
    root = realpathSync(await createTempDir('terminal-launch-root'));

    // A REAL agent binary: shadows the catalog's 'kimi' on PATH and reports
    // its working directory — proving the spawn AND the focus cwd in one line.
    binDir = await createTempDir('terminal-launch-bin');
    const fakeAgent = path.join(binDir, 'kimi');
    await writeFile(fakeAgent, '#!/bin/sh\necho "AGENT LIVE in $(pwd)"\nexec cat\n');
    await chmod(fakeAgent, 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;

    setRoots([root]);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer, maxPayload: 1048576 });
    setupTerminalRoutes(wss);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const token = await makeAuthToken();
    // The shell is the install owner's (terminal-routes.js): this wallet owns the test's install.
    await makeInstallOwner(verifySessionToken(token).address);
    baseUrl = `ws://127.0.0.1:${httpServer.address().port}/terminal-ws?token=${encodeURIComponent(token)}`;
  });

  afterAll(async () => {
    process.env.PATH = savedPath;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  const collect = (url) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let output = '';
    let error = null;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no answer; output: ${JSON.stringify(output)} error: ${error}`));
    }, 15000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'terminal:error') {
        error = msg.message;
        clearTimeout(timer);
        ws.close();
        resolve({ output, error });
        return;
      }
      if (msg.type !== 'terminal:data') return;
      output += msg.data;
      if (output.includes('AGENT LIVE')) {
        clearTimeout(timer);
        ws.close();
        resolve({ output, error });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  test('a cataloged agent spawns as the PTY process, in the focus folder', async () => {
    const { output, error } = await collect(`${baseUrl}&launch=kimi&cwd=${encodeURIComponent(root)}`);
    expect(error).toBe(null);
    expect(output).toContain(`AGENT LIVE in ${root}`);
  }, 30000);

  test('an unknown launch id is refused before any spawn', async () => {
    const { output, error } = await collect(`${baseUrl}&launch=nope&cwd=${encodeURIComponent(root)}`);
    expect(error).toMatch(/unknown agent/i);
    expect(output).not.toContain('AGENT LIVE');
  }, 30000);

  test('a hostile launch id is refused — nothing reaches a spawn', async () => {
    const { error } = await collect(`${baseUrl}&launch=${encodeURIComponent('kimi;id')}`);
    expect(error).toMatch(/unknown agent/i);
  }, 30000);
});
