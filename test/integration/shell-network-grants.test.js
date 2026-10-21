// Real approval broker + signed auth + disk stores + bwrap + HTTP/TLS. No mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import { WebSocket, WebSocketServer } from 'ws';
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { readActs } from '../../backend/services/act-ledger.js';
import { clearLaneBinding } from '../../backend/routes/portal-connections.js';
import permissions from '../../backend/routes/permissions-routes.js';
import { revokeGrant } from '../../backend/services/permissions-revoke.js';
import { beingPermissions } from '../../backend/services/permissions-ledger.js';
import { hydratePathGrants } from '../../backend/services/portal-tool-grants.js';
import { handleBeingCodingTool } from '../../backend/services/being-tool-surface.js';
import { sendToolEvent } from '../../backend/services/portal-tools/tool-events.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import {
  captureShellNetwork, requestShellNetwork, shellNetworkOptions, hydrateShellNetwork,
  revokeShellNetworkPermission, shellNetworkSessionHeld,
} from '../../backend/services/shell-network-grants.js';

const A = 'shell-grant-a';
const B = 'shell-grant-b';
const networkRow = { kind: 'act', server: 'coding', tool: 'shell_network' };
let root, source, previousRoot, previousWitnessRoot, previousData, app, token;
let server, wss, client, connection, httpHits, cardsSeen, pendingWork;

const identity = async () => {
  const wallet = Wallet.createRandom();
  const challenge = generateChallenge(wallet.address);
  const verified = verifySignature(wallet.address, challenge, await wallet.signMessage(challenge));
  expect(verified).toBe(wallet.address);
  return { address: wallet.address, token: createSessionToken(verified) };
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-network-'));
  source = path.join(root, 'source');
  await fs.mkdir(source);
  previousRoot = workspace.root;
  previousWitnessRoot = getWitnessesRoot();
  previousData = process.env.NEUMA_DATA_ROOT;
  workspace.root = path.join(root, 'lanes');
  setWitnessesRoot(path.join(root, 'witnesses'));
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  const operator = await identity();
  token = operator.token;
  for (const lane of [A, B]) {
    await fs.mkdir(path.join(workspace.pathFor(lane), 'config'), { recursive: true });
    await fs.writeFile(path.join(workspace.pathFor(lane), 'owner.json'), JSON.stringify({ wallet: operator.address }));
  }
  app = express();
  app.use(express.json());
  app.use('/permissions', permissions);
  httpHits = 0;
  cardsSeen = 0;
  pendingWork = [];
  app.get('/probe', (_req, res) => { httpHits++; res.end('network reached'); });
  server = http.createServer(app);
  wss = new WebSocketServer({ server });
  const connected = once(wss, 'connection');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const [ws] = await connected;
  connection = { ws, companion: { neumaId: A }, activeTurn: new AbortController() };
  // This listener is the fixture operator delivering decisions to the REAL broker.
  ws.on('message', (raw) => {
    const { id, decision } = JSON.parse(raw.toString());
    resolveToolApproval(connection, id, decision);
  });
  if (client.readyState !== WebSocket.OPEN) await once(client, 'open');
});

afterEach(async () => {
  clearLaneBinding(connection);
  await Promise.allSettled(pendingWork);
  // The broker appends consent asynchronously; wait for real disk receipts
  // before restoring the data root, so no delayed append can hit production.
  await expect.poll(async () => (await readActs()).filter((row) => row.tool === 'coding/shell_network').length)
    .toBeGreaterThanOrEqual(cardsSeen);
  client.terminate();
  for (const ws of wss.clients) ws.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  workspace.root = previousRoot;
  setWitnessesRoot(previousWitnessRoot);
  if (previousData === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = previousData;
  await fs.rm(root, { recursive: true, force: true });
});

const nextCard = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { client.off('message', receive); reject(new Error('No real approval card')); }, 5000);
  const receive = (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type !== 'tool:approval_request') return;
    cardsSeen++;
    clearTimeout(timer);
    client.off('message', receive);
    resolve(frame);
  };
  client.on('message', receive);
});

const consent = async (decision) => {
  const context = captureShellNetwork(connection, connection.activeTurn.signal);
  const card = nextCard();
  const events = [];
  const pending = requestShellNetwork(connection, context, (event) => events.push(event));
  pendingWork.push(pending);
  const frame = await card;
  expect(frame.tool).toBe('coding/shell_network');
  client.send(JSON.stringify({ id: frame.id, decision }));
  await pending;
  return context;
};

// Networked = a real interface with a default route (exit 0), else 7. The grant is
// OUTWARD only: this machine's own services (the probe server below) are never
// reached, granted or not — httpHits stays 0 in every test.
const NETWORKED = `awk '$2=="00000000"{f=1} END{if(f)print "network reached"; exit f?0:7}' /proc/net/route`;
const probe = async (context) => {
  const sandbox = await ensureWitnessCodingSandbox(connection.companion.neumaId, source);
  const reached = await runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true),
    command: `node -e "fetch('http://127.0.0.1:${server.address().port}/probe',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(7))"`,
  });
  expect(reached.exitCode).toBe(7); // never this machine
  return runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true), command: NETWORKED });
};

describe('lane-bound network consent', () => {
  test('the actual being execute handler asks separately and runs only with its captured network grant', async () => {
    connection._turnSandbox = await ensureWitnessCodingSandbox(A, source);
    const card = nextCard();
    const pending = handleBeingCodingTool(connection.ws, connection,
      { coding: { allowed: ['execute'] } }, 'ask', { tool: 'coding/execute' },
      { command: NETWORKED }, { sendToolEvent });
    pendingWork.push(pending);
    const frame = await card;
    expect(frame.tool).toBe('coding/shell_network');
    client.send(JSON.stringify({ id: frame.id, decision: 'allow' }));
    const result = await pending;
    expect(result.status, result.error).toBe('ok');
    expect(result.content).toContain('network reached');
    const inspection = await handleBeingCodingTool(connection.ws, connection,
      { coding: { allowed: ['inspect'] } }, 'ask', { tool: 'coding/inspect' },
      { command: NETWORKED }, { sendToolEvent });
    expect(inspection.status).toBe('error');
    expect(httpHits).toBe(0);
  }, 60_000);

  test.each(['allow', 'deny'])('%s in A does not follow B on the same connection', async (decision) => {
    const a = await consent(decision);
    expect((await probe(a)).exitCode).toBe(decision === 'allow' ? 0 : 7);
    const before = httpHits;
    clearLaneBinding(connection);
    connection.companion = { neumaId: B };
    connection.activeTurn = new AbortController();
    expect(() => a.assertCurrent()).toThrow(/interrupted|revoked/);
    const b = await consent('deny');
    expect((await probe(b)).exitCode).toBe(7);
    expect(httpHits).toBe(before);
  }, 60_000);

  test('session and persisted grants hydrate separately, including already-hydrated paths', async () => {
    const session = await consent('allow');
    expect((await workspace.readToolPolicy(A))?.shellNetwork).not.toBe(true);
    await hydratePathGrants(connection, null);
    await hydratePathGrants(connection, null);
    expect(shellNetworkOptions(session, true).network).toBe(true);
    clearLaneBinding(connection);
    connection.companion = { neumaId: A };
    const always = await consent('always');
    expect((await workspace.readToolPolicy(A)).shellNetwork).toBe(true);
    expect(shellNetworkSessionHeld(A)).toBe(false);
    await workspace.writeToolPolicy(A, { shellNetwork: false });
    await hydratePathGrants(connection, await workspace.readToolPolicy(A));
    expect(() => always.assertCurrent()).toThrow();
    expect(shellNetworkOptions(captureShellNetwork(connection), true).network).toBe(false);
  });

  test('changing the chat session or mutating the bound lane invalidates prior consent', async () => {
    const context = await consent('allow');
    connection.sessionId = 'new-chat';
    expect(() => context.assertCurrent()).toThrow();
    const next = captureShellNetwork(connection);
    expect(shellNetworkOptions(next, true).network).toBe(false);
    connection.companion.neumaId = B;
    expect(() => next.assertCurrent()).toThrow();
    expect(shellNetworkOptions(captureShellNetwork(connection), true).network).toBe(false);
  });

  test('permissions show a durable row and signed owner revoke invalidates an open connection', async () => {
    const context = await consent('always');
    expect((await probe(context)).exitCode).toBe(0);
    const route = `/permissions/${A}`;
    const listed = await request(app).get(route).set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.grants.act).toContainEqual(expect.objectContaining({ ...networkRow, scope: 'PERSISTED' }));
    const foreign = await identity();
    expect((await request(app).post(`${route}/revoke`).set('Authorization', `Bearer ${foreign.token}`).send(networkRow)).status).toBe(404);
    expect((await request(app).post(`${route}/revoke`).send(networkRow)).status).toBe(401);
    const revoked = await request(app).post(`${route}/revoke`).set('Authorization', `Bearer ${token}`).send(networkRow);
    expect(revoked.status).toBe(200);
    expect(revoked.body.held).toBe(true);
    expect(revoked.body.record.grants.act).toEqual([]);
    expect((await workspace.readToolPolicy(A)).shellNetwork).toBe(false);
    hydrateShellNetwork(connection, { shellNetwork: true }); // stale captured policy cannot resurrect revoked consent
    await expect(probe(context)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await probe(captureShellNetwork(connection))).exitCode).toBe(7);
    expect(httpHits).toBe(0);
    expect(revokeGrant(networkRow, { policy: { shellNetwork: true } }).policy.shellNetwork).toBe(false);
  }, 60_000);

  test('a session-only row is labelled and can be revoked even with no persisted grant', async () => {
    await consent('allow');
    const listed = await request(app).get(`/permissions/${A}`).set('Authorization', `Bearer ${token}`);
    expect(listed.body.grants.act).toContainEqual(expect.objectContaining({ ...networkRow, scope: 'SESSION ONLY' }));
    const revoked = await request(app).post(`/permissions/${A}/revoke`).set('Authorization', `Bearer ${token}`).send(networkRow);
    expect(revoked.status).toBe(200);
    expect(revoked.body.held).toBe(true);
    expect(shellNetworkSessionHeld(A)).toBe(false);
    const witness = beingPermissions({ neumaId: 'witness-test-Offline', kind: 'witness' }, { shellNetwork: true });
    expect(witness.grants.act[0].scope).toBe('STORED; WITNESS OFFLINE');
  });

  test.each(['interrupt', 'rebind', 'revoke'])('%s during real network approval never becomes a denial or spawns', async (action) => {
    const context = captureShellNetwork(connection, connection.activeTurn.signal);
    const card = nextCard();
    const events = [];
    const pending = requestShellNetwork(connection, context, (event) => events.push(event));
    pendingWork.push(pending);
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await card;
    if (action === 'interrupt') {
      const origin = connection.activeTurn;
      connection.activeTurn = new AbortController();
      origin.abort();
    }
    if (action === 'rebind') clearLaneBinding(connection);
    if (action === 'revoke') await revokeShellNetworkPermission(A);
    await outcome;
    expect(events).toEqual([]);
    expect(connection._pendingApprovals.size).toBe(0);
    expect((await workspace.readToolPolicy(A))?.shellNetwork).not.toBe(true);
    const sandbox = await ensureWitnessCodingSandbox(A, source);
    await expect(runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true), mode: 'write', command: 'touch marker' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.stat(path.join(sandbox.workspace, 'marker'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(httpHits).toBe(0);
  }, 60_000);

  test('revocation aborts a running network process, not just the next command', async () => {
    const context = await consent('allow');
    const sandbox = await ensureWitnessCodingSandbox(A, source);
    const chunks = [];
    const running = runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true), timeoutMs: 60000,
      command: `${NETWORKED} >/dev/null && printf CONNECTED; sleep 30; ${NETWORKED}`,
      onChunk: (chunk) => chunks.push(chunk.stdout),
    });
    const stopped = expect(running).rejects.toMatchObject({ name: 'AbortError' });
    pendingWork.push(running);
    await expect.poll(() => chunks.some((chunk) => chunk.includes('CONNECTED'))).toBe(true);
    await revokeShellNetworkPermission(A);
    await stopped;
    expect(httpHits).toBe(0);
  }, 60_000);

  test('real TLS verifies a fixture CA; resolver and system bundle are visible without private /etc', async () => {
    const key = path.join(source, 'tls-fixture.bin'); // a throwaway key; a .key name would be masked from the shell as a secret
    const cert = path.join(source, 'test-ca.crt');
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert],
    { env: { PATH: process.env.PATH, HOME: root, OPENSSL_CONF: '/dev/null' } });
    // The fixture server runs INSIDE the shell, on its own loopback: the host's is out of reach.
    const serve = `node -e "require('https').createServer({key:require('fs').readFileSync('tls-fixture.bin'),cert:require('fs').readFileSync('test-ca.crt')},(q,r)=>r.end('verified TLS')).listen(8443,'127.0.0.1')" & sleep 1.5;`;
    {
      const context = await consent('allow');
      const sandbox = await ensureWitnessCodingSandbox(A, source);
      const result = await runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true),
        command: `test ! -e /etc/passwd && test -s /etc/resolv.conf && (test -s /etc/ssl/certs/ca-certificates.crt || test -s /etc/pki/tls/certs/ca-bundle.crt) && ${serve} curl --fail --silent --show-error --max-time 10 --cacert test-ca.crt https://localhost:8443`,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('verified TLS');
      const untrusted = await runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true),
        command: `${serve} curl --fail --silent --max-time 10 https://localhost:8443` });
      expect(untrusted.exitCode).not.toBe(0);
    }
  }, 60_000);

  test.skipIf(process.env.RUN_SHELL_PUBLIC_TLS !== '1')('public DNS and system-CA HTTPS from the real granted shell', async () => {
    const context = await consent('allow');
    const sandbox = await ensureWitnessCodingSandbox(A, source);
    const result = await runWitnessCommand({ ...sandbox, ...shellNetworkOptions(context, true),
      command: 'curl --fail --silent --show-error --max-time 15 https://example.com', timeoutMs: 20000 });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('Example Domain');
  }, 60_000);
});
