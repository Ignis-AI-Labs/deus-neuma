#!/usr/bin/env node
/**
 * Auto-title e2e — REAL STACK PROOF (Rule 0). No mocks anywhere.
 *
 * Boots a real, isolated backend (temp workspaces root, temp realm, own port)
 * against the live local substrate, then drives the auto-title route the way
 * the Chats window does:
 *
 *   1. real workspace + owner.json for an ephemeral test wallet
 *   2. a real session written through NeumaWorkspace (real AES-256-GCM path)
 *   3. a real session token via wallet challenge-sign-verify (real signing)
 *   4. POST /api/v1/workspace/:id/sessions/autotitle — the live model names
 *      the chat from what was said
 *   5. the label is verified in the response AND on disk (chat-labels.json)
 *   6. skip/force semantics: second batch skips the named chat, force retitles
 *
 * Isolation is by launch env, never by mutating persisted settings:
 * WORKSPACES_ROOT + WORKSPACES_PIN=env point the sovereign stores at scratch,
 * NEUMA_REALM_ROOT points the witness realm at scratch (its own documented
 * isolation door) — the operator's real roots are untouched.
 *
 * The ephemeral wallet is created and discarded inside this script — it
 * speaks as no one, only proves the real auth flow. Usage:
 *
 *   node test/manual/test-autotitle-e2e.js
 *
 * Requires the local substrate (llama-server) to be serving. Exits non-zero
 * on any failed step; every step prints what it saw.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { mintToken } from '../../cli/lib/auth.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 3355;
const BACKEND = `http://localhost:${PORT}`;
const ENCRYPTION_KEY = 'autotitle-e2e-key-32-characters!!';
const NEUMA_ID = 'autotitle-probe';

let child = null;
let scratch = null;
let failures = 0;

const say = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n■ ${msg}`);
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const waitForBackend = async (timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND}/api/v1/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('backend did not come up in time');
};

const autotitle = (token, body) => fetch(`${BACKEND}/api/v1/workspace/${NEUMA_ID}/sessions/autotitle`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

const run = async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'autotitle-e2e-'));
  const workspacesRoot = path.join(scratch, 'workspaces');
  const realmRoot = path.join(scratch, 'realm');

  step('1. Boot real backend (isolated roots, live substrate)');
  child = spawn(process.execPath, ['backend/server.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      WORKSPACES_ROOT: workspacesRoot,
      WORKSPACES_PIN: 'env',
      NEUMA_REALM_ROOT: realmRoot,
      DNA_ENCRYPTION_KEY: ENCRYPTION_KEY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`  [backend] ${d}`));
  await waitForBackend();
  say(`backend listening on :${PORT}, workspaces at ${workspacesRoot}`);

  step('2. Real workspace + real session (AES-256-GCM write path)');
  process.env.WORKSPACES_ROOT = workspacesRoot;
  process.env.DNA_ENCRYPTION_KEY = ENCRYPTION_KEY;
  const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
  const wallet = ethers.Wallet.createRandom();
  await workspace.create(NEUMA_ID);
  await fs.writeFile(
    path.join(workspacesRoot, NEUMA_ID, 'owner.json'),
    JSON.stringify({ wallet: wallet.address, claimedAt: Date.now() }),
  );
  const sessionId = `session-${Date.now()}`;
  await workspace.createSession(NEUMA_ID, sessionId);
  const turns = [
    ['I want to migrate the sound engine to baked impulses.', 'A baked impulse library would replace the live synth — let us plan the migration.'],
    ['Start with the UI sounds, they are the smallest surface.', 'Agreed — the tick and confirm glyphs bake cleanly; the engine keeps a live fallback.'],
  ];
  for (const [user, neuma] of turns) {
    await workspace.appendMessage(NEUMA_ID, sessionId, { role: 'user', content: user });
    await workspace.appendMessage(NEUMA_ID, sessionId, { role: 'assistant', content: neuma });
  }
  const raw = await fs.readFile(path.join(workspacesRoot, NEUMA_ID, 'sessions', `${sessionId}.jsonl`), 'utf8');
  check('session file on disk is encrypted envelopes', raw.includes('"_enc"') && !raw.includes('sound engine'));
  check('workspace reads the session back', (await workspace.readSession(NEUMA_ID, sessionId)).length === 4);
  say(`ephemeral test wallet ${wallet.address}`);

  step('3. Real token via wallet challenge-sign-verify');
  const { token } = await mintToken({ backend: BACKEND, privateKey: wallet.privateKey });
  check('session token minted', typeof token === 'string' && token.length > 0);

  step('4. POST autotitle — the live model names the chat');
  const res = await autotitle(token, {});
  const body = await res.json();
  check('route answered 200', res.status === 200, `HTTP ${res.status}`);
  const result = body.results?.find((r) => r.sessionId === sessionId);
  check('chat was titled', result?.status === 'titled', JSON.stringify(result));
  check('title came back non-empty', typeof result?.label === 'string' && result.label.length > 0);
  say(`model wrote the title: «${result?.label}»`);
  say(`(chat was about migrating the sound engine to baked impulses — judge the title by that)`);

  step('5. The name is real on disk, not just in the response');
  const onDisk = JSON.parse(await fs.readFile(path.join(realmRoot, wallet.address.toLowerCase(), 'chat-labels.json'), 'utf8'));
  check('chat-labels.json holds the name', onDisk[`${NEUMA_ID}:${sessionId}`] === result?.label, onDisk[`${NEUMA_ID}:${sessionId}`]);

  step('6. Batch skip semantics — a named chat is left alone without force');
  const again = await (await autotitle(token, {})).json();
  check('nothing to name on second pass', Array.isArray(again.results) && again.results.length === 0);

  step('7. force retitles a named chat');
  const forced = await (await autotitle(token, { force: true })).json();
  const forcedResult = forced.results?.find((r) => r.sessionId === sessionId);
  check('force retitled the chat', forcedResult?.status === 'titled', JSON.stringify(forcedResult));
  say(`force pass wrote: «${forcedResult?.label}»`);

  step('8. Explicit sessionIds name exactly that chat');
  const single = await (await autotitle(token, { sessionIds: [sessionId], force: true })).json();
  check('single-chat naming works', single.results?.length === 1 && single.results[0].status === 'titled');

  step('9. A bad sessionId is refused (400)');
  const bad = await autotitle(token, { sessionIds: ['../evil'] });
  check('invalid sessionId refused', bad.status === 400, `HTTP ${bad.status}`);
};

try {
  await run();
} catch (error) {
  console.error(`\n✗ e2e aborted: ${error.message}`);
  failures += 1;
} finally {
  if (child) {
    // The backend holds live handles (MCP server, substrate monitor) and can
    // outlive a bare SIGTERM — escalate rather than strand it holding the port.
    let dead = false;
    child.once('exit', () => { dead = true; });
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 3000));
    if (!dead) child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
  }
  if (scratch) await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n✓ AUTO-TITLE E2E: ALL CHECKS PASSED' : `\n✗ AUTO-TITLE E2E: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
