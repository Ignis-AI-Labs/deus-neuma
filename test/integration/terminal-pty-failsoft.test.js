// Real missing-addon installation, signed owner, WebSocket and production manager.
// Healthy PTY execution is covered by terminal-ownership.test.js.
import { test, expect } from 'vitest';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));

test('a real installation without node-pty imports, refuses a terminal and keeps its transport alive', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'neuma-no-pty-'));
  try {
    const services = path.join(root, 'backend', 'services');
    await mkdir(services, { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    // Byte-identical manager in an actual package without node-pty. The logger
    // remains the real implementation; no loader or dependency is substituted.
    await copyFile(path.join(repo, 'backend/services/terminal-manager.js'), path.join(services, 'terminal-manager.js'));
    await symlink(path.join(repo, 'backend/services/logger.js'), path.join(services, 'logger.js'));
    const url = (relative) => JSON.stringify(pathToFileURL(path.join(repo, relative)).href);
    const script = `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import { Wallet } from ${url('node_modules/ethers/lib.esm/index.js')};
      import WebSocket, { WebSocketServer } from ${url('node_modules/ws/wrapper.mjs')};
      import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from ${url('backend/services/auth.js')};
      const manager = await import(${JSON.stringify(pathToFileURL(path.join(services, 'terminal-manager.js')).href)});
      assert.equal(manager.loadPty(), null);
      assert.equal(manager.loadPty(), null);
      const wallet = Wallet.createRandom();
      const challenge = generateChallenge(wallet.address);
      const token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      await once(server, 'listening');
      server.on('connection', (socket, request) => {
        const session = verifySessionToken(new URL(request.url, 'http://localhost').searchParams.get('token'));
        assert.ok(session);
        assert.equal(manager.spawnTerminal(socket, { wallet: session.address }).ok, false);
      });
      const client = new WebSocket('ws://127.0.0.1:' + server.address().port + '/?token=' + encodeURIComponent(token));
      const [raw] = await once(client, 'message');
      const frame = JSON.parse(String(raw));
      assert.equal(frame.type, 'terminal:error');
      assert.match(frame.message, /rest of NEUMA is unaffected/i);
      assert.equal(client.readyState, WebSocket.OPEN);
      client.close();
      await once(client, 'close');
      await new Promise(resolve => server.close(resolve));
      process.stdout.write('MISSING_ADDON_REFUSED_WITHOUT_CRASH');
    `;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, timeout: 15000,
      env: { PATH: '/usr/bin:/bin', HOME: root, NODE_ENV: 'test', AUTH_SECRET: randomBytes(32).toString('hex'), NEUMA_DATA_ROOT: root },
    });
    expect(stdout).toContain('MISSING_ADDON_REFUSED_WITHOUT_CRASH');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);
