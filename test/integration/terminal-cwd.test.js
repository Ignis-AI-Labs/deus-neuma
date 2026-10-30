/**
 * Terminal `?cwd=` focus param — REAL stack, no mocks (RULE 0).
 *
 * Real HTTP + WebSocketServer running the real terminal route, real auth
 * (challenge → sign → verify → session token) and real PTYs (node-pty). The
 * client's `?cwd=` is UNTRUSTED: only a path inside the opened explorer
 * roots (symlinks resolved, an existing directory) may become the shell's
 * cwd — /etc, a relative path, a nonexistent path, and an in-root symlink
 * pointing at /etc must ALL degrade to the contained fallback (the first
 * root), never the hostile path. Proven by asking each real shell `pwd` and
 * reading its answer. A client that sends no `?cwd=` (an old client) gets
 * the same fallback — the legacy behavior, unchanged.
 */
import { createServer } from 'http';
import { mkdir, symlink } from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupTerminalRoutes } from '../../backend/routes/terminal-routes.js';
import { setRoots } from '../../backend/services/user-files.js';
import { createTempDir } from '../helpers/temp-fs.js';

// Real challenge-sign-verify session token (the repo's integration auth flow).
const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

/**
 * Open one terminal (optionally with a ?cwd= hint), wait for the real shell
 * to speak, ask it `pwd`, and resolve with everything it printed. The PTY
 * answers on its own clock — resolve after a quiet gap once the `pwd` echo
 * has been seen. A terminal:error or silence rejects loudly (RULE 0: a cwd
 * "verified" without a live shell behind it proves nothing).
 */
const shellPwd = (baseUrl, cwdParam) =>
  new Promise((resolve, reject) => {
    const url = cwdParam === undefined ? baseUrl : `${baseUrl}&cwd=${encodeURIComponent(cwdParam)}`;
    const ws = new WebSocket(url);
    let output = '';
    let asked = false;
    let settle = null;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`shell never answered pwd; output so far: ${JSON.stringify(output)}`));
    }, 30000);
    const done = () => {
      clearTimeout(timer);
      ws.close();
      resolve(output);
    };
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'terminal:error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`PTY refused/failed: ${msg.message}`));
        return;
      }
      if (msg.type !== 'terminal:data') return;
      output += msg.data;
      if (!asked) {
        asked = true;
        // The prompt is up — give the shell a beat, then ask where it is.
        setTimeout(() => ws.send(JSON.stringify({ type: 'terminal:data', data: 'pwd\n' })), 300);
        return;
      }
      // After asking: resolve once the pwd echo has landed and gone quiet.
      if (settle) clearTimeout(settle);
      if (output.includes('pwd')) settle = setTimeout(done, 700);
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

// A pwd answer is a full line — assert on line boundaries so a prompt that
// merely mentions a directory cannot fake a match.
const HOSTILE_PWD = /\r?\n\/etc\s*\r?\n/;

describe('terminal ?cwd= focus containment (D3/D4)', () => {
  let httpServer;
  let wss;
  let baseUrl;
  let root;      // the one opened explorer root (contained fallback)
  let insideDir; // a real directory inside the root

  beforeAll(async () => {
    // realpath the root so containment's symlink resolution compares equals.
    root = realpathSync(await createTempDir('terminal-cwd-root'));
    insideDir = path.join(root, 'inside');
    await mkdir(insideDir);
    await symlink('/etc', path.join(root, 'outlink')); // in-root link → outside
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
    // Let the server-side close handlers reap the PTYs before teardown.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('cwd inside the roots → the shell opens there', async () => {
    const out = await shellPwd(baseUrl, insideDir);
    expect(out).toContain(insideDir);
  }, 60000);

  test('cwd=/etc → contained fallback, never /etc', async () => {
    const out = await shellPwd(baseUrl, '/etc');
    expect(out).toContain(root);
    expect(out).not.toMatch(HOSTILE_PWD);
  }, 60000);

  test('relative cwd → contained fallback', async () => {
    const out = await shellPwd(baseUrl, 'etc');
    expect(out).toContain(root);
  }, 60000);

  test('nonexistent in-root cwd → contained fallback', async () => {
    const out = await shellPwd(baseUrl, path.join(root, 'does-not-exist'));
    expect(out).toContain(root);
  }, 60000);

  test('in-root symlink escaping the roots → contained fallback, never /etc', async () => {
    const out = await shellPwd(baseUrl, path.join(root, 'outlink'));
    expect(out).toContain(root);
    expect(out).not.toMatch(HOSTILE_PWD);
  }, 60000);

  test('no cwd param (old client) → contained fallback, unchanged', async () => {
    const out = await shellPwd(baseUrl, undefined);
    expect(out).toContain(root);
  }, 60000);
});
