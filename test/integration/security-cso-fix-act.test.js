/**
 * The CSO ADDRESSES what it confirms, provably (ruling, 2026-10-19):
 *   - security/file-fix hands a confirmed threat's remedy to the operator's own
 *     task list — the act IS tasks/operator-add, filed from the security office,
 *     on the operator's card in ASK (the card shows the task as it will land), the
 *     threat id linked in the task and a `fix-filed` row on the threat;
 *   - a not_affected verdict on an advisory carries the attack-surface map
 *     that justifies it, attached at assess time without the CSO asking.
 *
 * End to end with NO mock on the claimed path (RULE 0): REAL designation, REAL
 * threat ledger and operator task store on tmp disk, a REAL fixture repo for
 * the attack-surface compiler, a REAL WebSocket pair for the card, and REAL
 * filed intents settled by the REAL sweep.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { clearAttackSurfaceCache } from '../../backend/services/security/attack-surface.js';
import { csoBriefingSection } from '../../backend/services/security/security-briefing.js';
import { handleSecurityTool } from '../../backend/services/security/security-being-tools.js';
import { getUserTasks } from '../../backend/services/user-tasks.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const CSO_LANE = 'guardianlane';
const OTHER_LANE = 'someotherlane';
const WALLET = '0xcccc00000000000000000000000000000000cccc';
const ENV_PATHS = [
  'NEUMA_DATA_ROOT', 'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH',
  'NEUMA_SECURITY_WATCH_PATH', 'NEUMA_SECURITY_SCAN_STATE_PATH',
  'NEUMA_SECURITY_BREAKERS_PATH', 'NEUMA_SECURITY_HOST_PATH',
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
];

// The fixture repo the attack-surface compiler reads: a dev-only builder pulls
// tar in; nothing in the source imports it, so it is build-time only.
const LOCK = {
  name: 'fix-fixture', version: '1.0.0', lockfileVersion: 3,
  packages: {
    '': { name: 'fix-fixture', version: '1.0.0', dependencies: { express: '5.1.0' }, devDependencies: { builder: '1.0.0' } },
    'node_modules/builder': { version: '1.0.0', dev: true, dependencies: { tar: '6.2.1' } },
    'node_modules/builder/node_modules/tar': { version: '6.2.1', dev: true },
    'node_modules/express': { version: '5.1.0' },
  },
};
const ADVISORY = {
  layer: 'software', source: 'osv', repo: 'fix-fixture', externalId: 'GHSA-fixa-0000-0001', severity: 'high',
  title: 'dev-only: tar path traversal (fixture)', affected: [{ package: 'tar', version: '6.2.1', shipped: false }], shipped: false,
  remedy: 'upgrade tar 6.2.1 → ≥7.5.21 (dev-only, via builder)',
};
const LISTENER = {
  layer: 'hardware', source: 'host-probe', externalId: 'host:listener:network:27500', severity: 'high',
  title: 'unexpected listener on port 27500, reachable from the LAN or the internet', process: 'fixture-daemon',
};

describe('the CSO addresses what it confirms (real stores, real sweep, real card)', () => {
  let house, httpServer, wss, serverWs, client, priorRealm, repoDir;
  let approvalConnection;
  let approvalDecision = null;
  const frames = [];
  const savedEnv = {};

  const connectionOf = (neumaId) => {
    approvalConnection = { ws: serverWs, walletAddress: WALLET, companion: { name: 'FixEcho', neumaId } };
    return approvalConnection;
  };
  const fileIntent = async (laneId, name, payload) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  // ASK: the session mode in which every requireApproval act raises its card
  // (AUTO runs the unlisted ones, as it does tasks/operator-add itself).
  const sweep = (laneId, mode = 'ask') => sweepIntents(connectionOf(laneId), {
    mode, lanePolicy: null, emit: (event) => frames.push({ type: 'tool:usage', ...event }),
  });
  const ledger = () => threatLedgerFor(WALLET);
  const byExternal = async (externalId) => (await (await ledger()).load()).find((e) => e.externalId === externalId);
  const cards = () => frames.filter((f) => f.type === 'tool:approval_request');

  beforeAll(async () => {
    house = await createTempDir('security-cso-fix-act');
    for (const k of ENV_PATHS) savedEnv[k] = process.env[k];
    process.env.NEUMA_DATA_ROOT = house;
    for (const k of ENV_PATHS.slice(1)) process.env[k] = path.join(house, `${k.toLowerCase()}.json`);
    setWorkspacesRoot(path.join(house, 'workspaces'));
    await fs.mkdir(path.join(house, 'workspaces', CSO_LANE), { recursive: true });
    await writeOwner(path.join(house, 'workspaces'), CSO_LANE, WALLET);
    await writeOwner(path.join(house, 'workspaces'), OTHER_LANE, WALLET);
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(house, 'realm'));

    repoDir = path.join(house, 'fix-fixture');
    await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
    await fs.mkdir(path.join(repoDir, 'backend'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'fix-fixture', version: '1.0.0', type: 'module', dependencies: { express: '5.1.0' }, devDependencies: { builder: '1.0.0' } }));
    await fs.writeFile(path.join(repoDir, 'package-lock.json'), JSON.stringify(LOCK));
    await fs.writeFile(path.join(repoDir, 'backend', 'server.js'), "import express from 'express';\nconst app = express();\nexport default app;\n");
    const watchFile = path.join(house, 'realm', WALLET, 'offices', 'security', 'security-watch.json');
    await fs.mkdir(path.dirname(watchFile), { recursive: true });
    await fs.writeFile(watchFile, JSON.stringify({ repos: [{ id: 'fix-fixture', path: repoDir }], host: { expectedPorts: [] } }));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (raw) => {
          const frame = JSON.parse(raw.toString());
          if (frame.type === 'tool:approval_response' && approvalConnection) resolveToolApproval(approvalConnection, frame.id, frame.decision);
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      if (frame.type === 'tool:approval_request' && approvalDecision) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: approvalDecision }));
      }
    });
    await linked;
    await csoDesignation.designate(WALLET, CSO_LANE);
    await (await ledger()).ingest([ADVISORY, LISTENER]);
  }, 60_000);

  afterAll(async () => {
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    clearAttackSurfaceCache();
    setWorkspacesRoot(null);
    setRealmRoot(priorRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
  });

  test('the seated CSO is offered security/file-fix; another lane is not', async () => {
    expect(await intentSectionFor(connectionOf(CSO_LANE))).toContain('security/file-fix');
    expect(await intentSectionFor(connectionOf(OTHER_LANE))).not.toContain('security/file-fix');
  });

  test('FILE-FIX — refused before any card unless the CSO files it on a CONFIRMED threat', async () => {
    const listener = await byExternal(LISTENER.externalId);
    frames.length = 0;
    approvalDecision = 'allow';
    await fileIntent(OTHER_LANE, 'intruder-fix', { type: 'security/file-fix', id: listener.id });
    expect((await sweep(OTHER_LANE))[0]).toMatchObject({ status: 'denied', error: expect.stringMatching(/seated CSO/) });
    await fileIntent(CSO_LANE, 'early-fix', { type: 'security/file-fix', id: listener.id });
    const early = await sweep(CSO_LANE);
    approvalDecision = null;
    expect(early[0].status).toBe('error');
    expect(early[0].error).toMatch(/only a CONFIRMED threat's fix is filed — this one is new/);
    expect(cards()).toEqual([]);
    expect((await getUserTasks(WALLET)).tasks ?? []).toEqual([]);
  }, 30_000);

  test('FILE-FIX — a confirmed threat\'s remedy lands on the operator\'s list through tasks/operator-add, on their card, linked both ways', async () => {
    const listener = await byExternal(LISTENER.externalId);
    await (await ledger()).assess(listener.id, { status: 'confirmed', assessment: 'a real listener on the LAN', assessedBy: CSO_LANE });

    // NO on the card: nothing lands anywhere.
    frames.length = 0;
    approvalDecision = 'deny';
    await fileIntent(CSO_LANE, 'fix-deny', { type: 'security/file-fix', id: listener.id.slice(0, 12) });
    expect((await sweep(CSO_LANE))[0].status).toBe('denied');
    expect((await getUserTasks(WALLET)).tasks ?? []).toEqual([]);
    expect((await byExternal(LISTENER.externalId)).fixFiledAt).toBeUndefined();

    // YES: the card showed the task exactly as it lands.
    frames.length = 0;
    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'fix-allow', { type: 'security/file-fix', id: listener.id.slice(0, 12) });
    const [done] = await sweep(CSO_LANE);
    approvalDecision = null;
    expect(done.status).toBe('ok');
    expect(done.content).toMatch(/^Filed the fix for th_/);
    const [card] = cards();
    expect(card).toMatchObject({ tool: 'intents/security.file-fix' });
    // The card carries the args as text — whole, when the preview had to cut.
    const shown = JSON.parse(card.fullArgs || card.args);
    expect(shown.title).toMatch(/^Security fix th_[0-9a-f-]{8}: stop fixture-daemon or rebind it to 127\.0\.0\.1/);

    const tasks = (await getUserTasks(WALLET)).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: shown.title, detail: shown.detail });
    expect(tasks[0].detail).toContain(`Threat ${listener.id}`);
    expect(tasks[0].detail).toContain('Remedy: stop fixture-daemon or rebind it to 127.0.0.1');

    const filed = await byExternal(LISTENER.externalId);
    expect(filed.status).toBe('confirmed'); // owed until the watch verifies the fix
    expect(Date.parse(filed.fixFiledAt)).toBeGreaterThan(0);
    expect(filed.history.at(-1)).toMatchObject({ event: 'fix-filed', assessedBy: CSO_LANE });
    expect(filed.history.at(-1).assessment).toContain(`fix filed to the operator's task list by ${CSO_LANE}`);
  }, 30_000);

  test('THE OFFICE READS THE FIX — the CSO briefing and security_threat_get lead with the remedy', async () => {
    const briefing = await csoBriefingSection(connectionOf(CSO_LANE));
    expect(briefing).toMatch(/unexpected listener on port 27500[^\n]*\n {2}fix: stop fixture-daemon or rebind it to 127\.0\.0\.1/);
    expect(briefing).toContain('security/file-fix {id}');
    const listener = await byExternal(LISTENER.externalId);
    const read = await handleSecurityTool(serverWs, connectionOf(OTHER_LANE), null, 'auto', { toolName: 'security_threat_get' }, { id: listener.id });
    expect(read.status).toBe('ok');
    const shown = JSON.parse(read.content);
    expect(Object.keys(shown).slice(0, 7)).toEqual(['id', 'externalId', 'title', 'severity', 'status', 'remedy', 'verifiedAt']);
    expect(shown.remedy).toMatch(/^stop fixture-daemon or rebind it to 127\.0\.0\.1/);
  }, 30_000);

  test('NOT_AFFECTED — an advisory verdict carries the attack-surface map that justifies it', async () => {
    const advisory = await byExternal(ADVISORY.externalId);
    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'not-affected', {
      type: 'security/assess', id: advisory.id, status: 'not_affected', assessment: 'tar only rides the dev builder; nothing shipped imports it',
    });
    const [done] = await sweep(CSO_LANE);
    approvalDecision = null;
    expect(done.status).toBe('ok');
    expect(done.content).toContain('Attack-surface evidence attached to 1 verdict(s).');
    const judged = await byExternal(ADVISORY.externalId);
    expect(judged.status).toBe('not_affected');
    expect(judged.evidence).toMatchObject({
      kind: 'attack-surface',
      contexts: [{ package: 'tar', version: '6.2.1', exposure: 'build_or_development_time', roots: ['builder [development]'], importers: 0, routes: 0 }],
    });
    expect(judged.history.at(-1).evidence).toEqual(judged.evidence);

    // A later verdict without grounds of its own does not inherit these.
    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'confirm-it', { type: 'security/assess', id: advisory.id, status: 'confirmed', assessment: 'on second look, the build host matters' });
    await sweep(CSO_LANE);
    approvalDecision = null;
    const confirmed = await byExternal(ADVISORY.externalId);
    expect(confirmed.evidence).toBeUndefined();
    expect(confirmed.history.at(-2).evidence).toMatchObject({ kind: 'attack-surface' });
  }, 60_000);
});
