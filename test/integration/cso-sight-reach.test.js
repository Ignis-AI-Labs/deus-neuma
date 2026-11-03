import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { claimOwner } from '../helpers/claim-owner.js';
import csoRouter from '../../backend/routes/cso-routes.js';
import { securityHeaders } from '../../backend/services/security-headers.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { clearAttackSurfaceCache } from '../../backend/services/security/attack-surface.js';
import { circuitBreaker } from '../../backend/services/security/circuit-breaker.js';
import { trafficMonitor } from '../../backend/services/security/traffic-monitor.js';
import { createLogger } from '../../backend/services/logger.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

// The finding maps against the REAL lockfile, so the fixture names the tar this
// tree actually installs (electron-builder 25 carried a nested 6.2.1; 26 does
// not): a dependency bump must not turn the proof into a lookup of nothing.
const TAR_VERSION = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'))
  .packages['node_modules/tar'].version;

const ENV_KEYS = Object.freeze([
  'NEUMA_DATA_ROOT',
  'NEUMA_SECURITY_WATCH_PATH',
  'NEUMA_SECURITY_THREATS_PATH',
  'NEUMA_SECURITY_CSO_PATH',
  'NEUMA_SECURITY_SCAN_STATE_PATH',
  'NEUMA_SECURITY_BREAKERS_PATH',
  'NEUMA_SECURITY_HOST_PATH',
]);

const waitFor = async (read, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition did not become true');
};

const nonLoopbackIpv4 = () => Object.values(os.networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address || null;

const closeServer = (server) => new Promise((resolve, reject) => {
  server.closeAllConnections?.();
  server.close((error) => (error ? reject(error) : resolve()));
});

describe('CSO Sight and Reach (real signed-wallet HTTP + kernel TCP + real disk)', () => {
  let root;
  let server;
  let localBase;
  let remoteBase;
  let remoteSource;
  let token;
  let threat;
  let operatorWallet;
  let originalWorkspaceRoot;
  let originalRealmRoot;
  const savedEnv = {};

  const authed = (base, route, options = {}) => fetch(`${base}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const post = (route, body) => authed(localBase, route, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    root = await createTempDir('cso-sight-reach');
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.NEUMA_DATA_ROOT = root;
    process.env.NEUMA_SECURITY_WATCH_PATH = path.join(root, 'settings', 'watch.json');
    process.env.NEUMA_SECURITY_THREATS_PATH = path.join(root, 'settings', 'threats.json');
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(root, 'settings', 'cso.json');
    process.env.NEUMA_SECURITY_SCAN_STATE_PATH = path.join(root, 'settings', 'scan.json');
    process.env.NEUMA_SECURITY_BREAKERS_PATH = path.join(root, 'settings', 'breakers.json');
    process.env.NEUMA_SECURITY_HOST_PATH = path.join(root, 'settings', 'host.json');
    await fs.mkdir(path.join(root, 'settings'), { recursive: true });
    // The office is the signed-in operator's house, in a tmp realm.
    originalRealmRoot = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));

    originalWorkspaceRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(root, 'workspaces'));
    trafficMonitor.clear();

    const app = express();
    app.use(express.json());
    app.use(securityHeaders);
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/cso', csoRouter);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '0.0.0.0', () => resolve(listening));
    });
    const port = server.address().port;
    remoteSource = nonLoopbackIpv4();
    if (!remoteSource) throw new Error('a real non-loopback interface is required to prove remote containment');
    localBase = `http://127.0.0.1:${port}`;
    remoteBase = `http://${remoteSource}:${port}`;

    const keypair = generateKeypair();
    operatorWallet = keypair.address;
    const challengeResponse = await fetch(`${localBase}/api/v1/auth/challenge?address=${keypair.address}`);
    if (!challengeResponse.ok) throw new Error(`wallet challenge failed: ${challengeResponse.status}`);
    const { challenge } = await challengeResponse.json();
    const signature = await signMessage(keypair.privateKey, challenge);
    const verifyResponse = await fetch(`${localBase}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: keypair.address, signature, challenge }),
    });
    if (!verifyResponse.ok) throw new Error(`wallet verification failed: ${verifyResponse.status}`);
    ({ token } = await verifyResponse.json());
    const watchFile = path.join(root, 'realm', keypair.address.toLowerCase(), 'offices', 'security', 'security-watch.json');
    await fs.mkdir(path.dirname(watchFile), { recursive: true });
    await fs.writeFile(watchFile, `${JSON.stringify({
      repos: [{ id: 'neuma', path: process.cwd(), hasLockfile: true, addedAt: new Date().toISOString() }],
      host: { expectedPorts: [] },
    }, null, 2)}\n`, { mode: 0o600 });
    const threatLedger = await threatLedgerFor(keypair.address);

    // The seat goes to a lane this wallet truly owns (the route fails closed
    // on any other — 56a45564b), so the lane is made and claimed first.
    await neumaWorkspace.create('guardianlane');
    await claimOwner(path.join(root, 'workspaces'), 'guardianlane', keypair.address);
    // The firewall is machine-wide: this wallet drives it as the install's owner.
    await makeInstallOwner(keypair.address);
    const seated = await authed(localBase, '/api/v1/cso/seat', {
      method: 'PUT',
      body: JSON.stringify({ laneId: 'guardianlane' }),
    });
    if (!seated.ok) throw new Error(`CSO designation failed: ${seated.status}`);

    await threatLedger.ingest([{
      layer: 'software',
      source: 'osv',
      repo: 'neuma',
      externalId: 'GHSA-live-node-tar-fixture',
      title: `node-tar fixture against the installed ${TAR_VERSION} chain`,
      severity: 'high',
      summary: 'Real package-lock mapping fixture',
      affected: [{ package: 'tar', version: TAR_VERSION }],
    }]);
    threat = (await threatLedger.load()).find((entry) => entry.externalId === 'GHSA-live-node-tar-fixture');
  }, 60000);

  afterAll(async () => {
    if (remoteSource) {
      await circuitBreaker.unblockSource({
        source: remoteSource,
        reason: 'Integration proof teardown releases the ephemeral source rule',
        actor: 'test-teardown',
      }).catch(() => {});
    }
    trafficMonitor.clear();
    clearAttackSurfaceCache();
    if (server) await closeServer(server);
    setWorkspacesRoot(originalWorkspaceRoot);
    if (originalRealmRoot) setRealmRoot(originalRealmRoot);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  test('every Sight and Reach endpoint rejects an unsigned caller', async () => {
    for (const route of [
      '/api/v1/cso/attack-surface',
      '/api/v1/cso/telemetry',
      '/api/v1/cso/mitigations',
    ]) {
      const response = await fetch(`${localBase}${route}`);
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    }
  });

  test('maps the live repository and node-tar finding through authenticated HTTP', async () => {
    const architectureResponse = await authed(localBase, '/api/v1/cso/attack-surface?repo=neuma');
    expect(architectureResponse.status).toBe(200);
    const architecture = await architectureResponse.json();
    expect(architecture.repo).toMatchObject({ id: 'neuma', path: process.cwd() });
    expect(architecture.surface.summary.scannedFiles).toBeGreaterThan(100);
    expect(architecture.surface.summary.routes).toBeGreaterThan(10);
    expect(architecture.surface.graph).toBeUndefined();

    const mappedResponse = await authed(localBase, `/api/v1/cso/threats/${threat.id}/attack-surface`);
    expect(mappedResponse.status).toBe(200);
    const { attackSurface } = await mappedResponse.json();
    expect(attackSurface).toMatchObject({
      threatId: threat.id,
      externalId: 'GHSA-live-node-tar-fixture',
      repo: 'neuma',
    });
    expect(attackSurface.contexts).toContainEqual(expect.objectContaining({
      affected: { package: 'tar', version: TAR_VERSION },
      confidence: 'static_evidence',
    }));
    const installed = attackSurface.contexts.flatMap((context) => context.dependency.installed);
    expect(installed).toContainEqual(expect.objectContaining({ version: TAR_VERSION, reachableFromRoot: true }));
  }, 60000);

  test('returns live traffic and redacted process warnings without request secrets', async () => {
    createLogger('Security.Gnosis').warn('telemetry redaction fixture', {
      apiKey: 'telemetry-redaction-fixture-value',
      detail: 'observable warning',
    });
    const remoteProbe = await authed(remoteBase, '/api/v1/cso/posture');
    expect(remoteProbe.status).toBe(200);
    await remoteProbe.arrayBuffer();

    const telemetryResponse = await authed(localBase, '/api/v1/cso/telemetry?windowSeconds=60&limit=50&logLimit=20');
    expect(telemetryResponse.status).toBe(200);
    const { telemetry } = await telemetryResponse.json();
    expect(telemetry.traffic.totals.requests).toBeGreaterThan(0);
    expect(telemetry.traffic.totals.remote).toBeGreaterThan(0);
    expect(telemetry.traffic.byPath).toContainEqual(expect.objectContaining({
      key: 'GET /api/v1/cso/posture',
    }));
    const serialized = JSON.stringify(telemetry.systemIssues);
    expect(serialized).toContain('telemetry redaction fixture');
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('telemetry-redaction-fixture-value');
    expect(serialized).not.toContain('token=');
  });

  test('the operator reopens a CSO verdict over real HTTP; the verdict stays in the history', async () => {
    const ledger = await threatLedgerFor(operatorWallet);
    await ledger.ingest([{
      layer: 'software', source: 'manual', repo: 'neuma', externalId: 'GHSA-reopen-fixture',
      title: 'a verdict the operator overturns', severity: 'high', summary: 'reopen fixture',
    }]);
    const target = (await ledger.load()).find((e) => e.externalId === 'GHSA-reopen-fixture');
    await ledger.assess(target.id, { status: 'not_affected', assessment: 'the CSO says it does not bite', assessedBy: 'guardianlane' });

    const reopen = (id, note) => authed(localBase, `/api/v1/cso/threats/${id}/reopen`, { method: 'PUT', body: JSON.stringify({ note }) });
    const reopened = await reopen(target.id, 'I want a second look');
    expect(reopened.status).toBe(200);
    const stored = await ledger.get(target.id);
    expect(stored).toMatchObject({ status: 'new', assessedBy: null });
    expect(stored.history.map((h) => h.assessment)).toEqual(expect.arrayContaining(['the CSO says it does not bite', 'I want a second look']));
    expect((await reopen(target.id)).status).toBe(409);
    expect((await reopen('th_nosuchthreat')).status).toBe(404);
  });

  test('a signed-in guest of this install cannot move the machine firewall', async () => {
    const guest = generateKeypair();
    const { challenge } = await (await fetch(`${localBase}/api/v1/auth/challenge?address=${guest.address}`)).json();
    const verified = await fetch(`${localBase}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: guest.address, signature: await signMessage(guest.privateKey, challenge), challenge }),
    });
    const { token: guestToken } = await verified.json();
    const refused = await fetch(`${localBase}/api/v1/cso/mitigations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'block_source', source: '198.51.100.90', durationSeconds: 30, reason: 'a guest trying the firewall' }),
    });
    expect(refused.status).toBe(403);
    expect((await circuitBreaker.evaluate('198.51.100.90')).blocked).toBe(false);
  });

  test('operator-authenticated source rules block real remote TCP and preserve loopback recovery', async () => {
    const applied = await post('/api/v1/cso/mitigations', {
      action: 'block_source',
      source: remoteSource,
      durationSeconds: 30,
      reason: 'Manual proof blocks the kernel-observed remote source only',
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).outcome.rule).toMatchObject({ source: remoteSource, automatic: false });

    const blocked = await authed(remoteBase, '/api/v1/cso/posture');
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/circuit breaker/);
    const recovery = await authed(localBase, '/api/v1/cso/mitigations');
    expect(recovery.status).toBe(200);
    expect((await recovery.json()).mitigations.blockedSources)
      .toContainEqual(expect.objectContaining({ source: remoteSource }));

    const released = await post('/api/v1/cso/mitigations', {
      action: 'unblock_source',
      source: remoteSource,
      reason: 'Manual proof finished and loopback recovery remained reachable',
    });
    expect(released.status).toBe(200);
    const restored = await authed(remoteBase, '/api/v1/cso/posture');
    expect(restored.status).toBe(200);
    await restored.arrayBuffer();
  });

  test('a real critical credential probe auto-contains its source for a bounded interval', async () => {
    trafficMonitor.clear();
    const routes = ['/seat', '/watch', '/scan', '/posture', '/threats'];
    for (let index = 0; index < 80; index += 1) {
      const response = await fetch(`${remoteBase}/api/v1/cso${routes[index % routes.length]}`);
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    }

    const rule = await waitFor(async () => {
      const state = await circuitBreaker.load({ fresh: true });
      return state.blockedSources.find((entry) => entry.source === remoteSource && entry.automatic) || null;
    });
    expect(rule.actor).toBe('security-watch');
    expect(Date.parse(rule.until) - Date.parse(rule.createdAt)).toBeLessThanOrEqual(15 * 60 * 1000);
    const blocked = await authed(remoteBase, '/api/v1/cso/posture');
    expect(blocked.status).toBe(403);
    await blocked.arrayBuffer();

    const telemetryResponse = await authed(localBase, '/api/v1/cso/telemetry?windowSeconds=60&limit=5');
    const { telemetry } = await telemetryResponse.json();
    expect(telemetry.traffic.anomalies).toContainEqual(expect.objectContaining({
      source: remoteSource,
      type: 'credential_probe',
      severity: 'critical',
    }));
    expect(telemetry.circuitBreakers.blockedSources)
      .toContainEqual(expect.objectContaining({ source: remoteSource, automatic: true }));

    const released = await post('/api/v1/cso/mitigations', {
      action: 'unblock_source',
      source: remoteSource,
      reason: 'Automatic containment proof complete; release the test source',
    });
    expect(released.status).toBe(200);
  }, 30000);
});
