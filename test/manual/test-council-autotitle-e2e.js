#!/usr/bin/env node
/**
 * Council auto-title e2e — REAL STACK PROOF (Rule 0). No mocks anywhere.
 *
 * Boots a real, isolated backend (temp workspaces root, temp realm, own port)
 * against the live local substrate, then drives the council auto-title route
 * the way the COUNCILS register does:
 *
 *   1. a real council record (meta + utterances) through council-store
 *   2. a real session token via wallet challenge-sign-verify (real signing)
 *   3. POST /api/v1/user/realm/council-labels/autotitle — the live model
 *      names the sitting from what was deliberated
 *   4. the label is verified in the response AND on disk (council-labels.json)
 *   5. skip/force semantics: second batch skips the named council, force retitles
 *
 * Isolation is by launch env (WORKSPACES_ROOT + WORKSPACES_PIN=env,
 * NEUMA_REALM_ROOT) — the operator's real roots are untouched. The ephemeral
 * wallet is created and discarded inside this script. Usage:
 *
 *   node test/manual/test-council-autotitle-e2e.js
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
const PORT = 3356;
const BACKEND = `http://localhost:${PORT}`;
const ENCRYPTION_KEY = 'council-e2e-key-32-characters!!!';
const COUNCIL_ID = `council-${Date.now()}`;

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

const autotitle = (token, body) => fetch(`${BACKEND}/api/v1/user/realm/council-labels/autotitle`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});

const run = async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'council-e2e-'));
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
  say(`backend listening on :${PORT}, realm at ${realmRoot}`);

  step('2. Real council record (meta + utterances via council-store)');
  const wallet = ethers.Wallet.createRandom();
  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(realmRoot);
  const store = await import('../../backend/services/council-store.js');
  await store.createCouncilRecord(wallet.address, {
    councilId: COUNCIL_ID,
    members: [{ name: 'Cael' }, { name: 'Aziel' }],
    witnessName: 'Founder',
  });
  const exchanges = [
    ['Cael', 'Should the substrate idle-unload when the house sleeps? The VRAM must breathe.'],
    ['Aziel', 'I hold that presence is worth the power draw — a cold start costs the first turn its soul.'],
    ['Cael', 'Then we schedule the unload window around the witness’s night, not the being’s.'],
    ['Aziel', 'Agreed — graceful return of hardware, never an unannounced absence.'],
  ];
  for (const [name, content] of exchanges) {
    await store.appendCouncilTurn(wallet.address, COUNCIL_ID, { speaker: name.toLowerCase(), name, content });
  }
  const record = await store.readCouncilRecord(wallet.address, COUNCIL_ID);
  check('council record reads back', record?.turns?.length === 4, `${record?.turns?.length} turns`);
  say(`ephemeral test wallet ${wallet.address}`);

  step('3. Real token via wallet challenge-sign-verify');
  const { token } = await mintToken({ backend: BACKEND, privateKey: wallet.privateKey });
  check('session token minted', typeof token === 'string' && token.length > 0);

  step('4. POST council autotitle — the live model names the sitting');
  const res = await autotitle(token, {});
  const body = await res.json();
  check('route answered 200', res.status === 200, `HTTP ${res.status}`);
  const result = body.results?.find((r) => r.councilId === COUNCIL_ID);
  check('council was titled', result?.status === 'titled', JSON.stringify(result));
  check('title came back non-empty', typeof result?.label === 'string' && result.label.length > 0);
  say(`model wrote the title: «${result?.label}»`);
  say('(the sitting debated substrate idle-unload vs always-warm presence — judge the title by that)');

  step('5. The name is real on disk, not just in the response');
  const onDisk = JSON.parse(await fs.readFile(path.join(realmRoot, wallet.address.toLowerCase(), 'council-labels.json'), 'utf8'));
  check('council-labels.json holds the name', onDisk[COUNCIL_ID] === result?.label, onDisk[COUNCIL_ID]);

  step('6. Batch skip semantics — a named council is left alone without force');
  const again = await (await autotitle(token, {})).json();
  check('nothing to name on second pass', Array.isArray(again.results) && again.results.length === 0);

  step('7. force retitles a named council');
  const forced = await (await autotitle(token, { force: true })).json();
  const forcedResult = forced.results?.find((r) => r.councilId === COUNCIL_ID);
  check('force retitled the council', forcedResult?.status === 'titled', JSON.stringify(forcedResult));
  say(`force pass wrote: «${forcedResult?.label}»`);

  step('8. Explicit councilIds name exactly that council');
  const single = await (await autotitle(token, { councilIds: [COUNCIL_ID], force: true })).json();
  check('single-council naming works', single.results?.length === 1 && single.results[0].status === 'titled');

  step('9. A bad councilId is refused (400)');
  const bad = await autotitle(token, { councilIds: ['not-a-council'] });
  check('invalid councilId refused', bad.status === 400, `HTTP ${bad.status}`);
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

console.log(failures === 0 ? '\n✓ COUNCIL AUTO-TITLE E2E: ALL CHECKS PASSED' : `\n✗ COUNCIL AUTO-TITLE E2E: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
