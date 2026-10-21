/**
 * Security intents gate — the CSO office's HARD single-holder gate, proven end
 * to end with NO mock on the claimed path (RULE 0): REAL designation, REAL
 * threat ledger on real temp disk, REAL WebSocket pair, REAL filed intents
 * settled by the REAL sweep.
 *
 * Stage 3 of the being-tool-surface doctrine: the office's ACTS (assess /
 * scan / escalate / circuit-breaker) are no longer tools — they are intent
 * types, and the seat is verified at validate time, BEFORE any card. The
 * READS (posture, threats_list, threat_get, attack_surface, telemetry) stay
 * tools, house-visible to every bound being.
 *
 * ONE OFFICE PER HOUSE (ruling, 2026-10-16): the seat, the ledger, the watch list
 * and the briefing are the house's — a second house seating a CSO under the
 * SAME lane id never reads, gates or briefs from the first's.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  handleSecurityTool, securityToolsFor, SECURITY_TOOLS,
} from '../../backend/services/security/security-being-tools.js';
import { csoBriefingSection } from '../../backend/services/security/security-briefing.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { circuitBreaker } from '../../backend/services/security/circuit-breaker.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { __test as portalTest } from '../../backend/services/portal-test-surface.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const _securityToolsFor = securityToolsFor;
const _handleSecurityTool = handleSecurityTool;
const _csoBriefingSection = csoBriefingSection;
const { processToolCalls } = portalTest;
const CSO_LANE = 'guardianlane';
const OTHER_LANE = 'someotherlane';
const WALLET = '0xaaaa00000000000000000000000000000000aaaa';
const HOUSE_B = '0xbbbb00000000000000000000000000000000bbbb';
const threatLedger = {
  ingest: async (findings) => (await threatLedgerFor(WALLET)).ingest(findings),
  load: async () => (await threatLedgerFor(WALLET)).load(),
  get: async (id) => (await threatLedgerFor(WALLET)).get(id),
};
const ENV_PATHS = [
  'NEUMA_DATA_ROOT', 'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH',
  'NEUMA_SECURITY_WATCH_PATH', 'NEUMA_SECURITY_SCAN_STATE_PATH',
  'NEUMA_SECURITY_BREAKERS_PATH', 'NEUMA_SECURITY_HOST_PATH',
  // The availability probe reads the social + email stores too — point them
  // at the tmp house so a test never reads the operator's real ones.
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
];

const THREAT = {
  layer: 'software', source: 'osv', repo: 'neuma',
  externalId: 'GHSA-test-0001', title: 'fixture advisory for the gate',
  severity: 'high', summary: 'gate fixture',
  affected: [{ package: 'fixture', version: '1.0.0' }],
};

describe('security intents gate (reads universal, acts seat-locked; real stores + real WS, gnosis)', () => {
  let house, httpServer, wss, serverWs, client, port, priorRealm;
  let approvalConnection;
  let approvalDecision = null;
  const clientFrames = [];
  const savedEnv = {};

  const freshConnection = (neumaId, walletAddress = WALLET) => {
    approvalConnection = {
      ws: serverWs,
      walletAddress,
      companion: { name: 'GateEcho', neumaId },
    };
    return approvalConnection;
  };

  const fileIntent = async (laneId, name, payload) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  const sweep = (connection, mode) => sweepIntents(connection, {
    mode, lanePolicy: null,
    emit: (event) => clientFrames.push({ type: 'tool:usage', ...event }),
  });

  beforeAll(async () => {

    house = await createTempDir('security-gate-house');
    for (const k of ENV_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_DATA_ROOT = house;
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(house, 'cso.json');
    process.env.NEUMA_SECURITY_THREATS_PATH = path.join(house, 'threats.json');
    // The watch/scan-state paths point at tmp too — a test must never seed
    // or read the operator's real watch list.
    process.env.NEUMA_SECURITY_WATCH_PATH = path.join(house, 'watch.json');
    process.env.NEUMA_SECURITY_SCAN_STATE_PATH = path.join(house, 'scan-state.json');
    process.env.NEUMA_SECURITY_BREAKERS_PATH = path.join(house, 'breakers.json');
    process.env.NEUMA_SECURITY_HOST_PATH = path.join(house, 'host.json');
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(house, 'social-bindings.json');
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(house, 'social-credentials.json');
    process.env.NEUMA_SECTOR_CREW_PATH = path.join(house, 'sector-crew.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(house, 'email-binding.json');
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(house, 'email-credentials.json');
    // The journal writes into the CSO lane's REAL workspace — rooted in tmp
    // here, with the lane standing so the drawer exists to be written.
    setWorkspacesRoot(path.join(house, 'workspaces'));
    await fs.mkdir(path.join(house, 'workspaces', CSO_LANE), { recursive: true });
    // Both lanes are the house's own (a house seats only its own lane), and
    // the realm — where the house's office lives — is tmp too.
    await writeOwner(path.join(house, 'workspaces'), CSO_LANE, WALLET);
    await writeOwner(path.join(house, 'workspaces'), OTHER_LANE, WALLET);
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(house, 'realm'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (raw) => {
          const frame = JSON.parse(raw.toString());
          if (frame.type === 'tool:approval_response' && approvalConnection) {
            resolveToolApproval(approvalConnection, frame.id, frame.decision);
          }
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      clientFrames.push(frame);
      if (frame.type === 'tool:approval_request' && approvalDecision) {
        client.send(JSON.stringify({
          type: 'tool:approval_response',
          id: frame.id,
          decision: approvalDecision,
        }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    setWorkspacesRoot(null);
    setRealmRoot(priorRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
    await fs.rm(house, { recursive: true, force: true });
  });

  test('the catalog itself: the five reads, all security/* — the acts are intents now', () => {
    expect(SECURITY_TOOLS.map((t) => t.name)).toEqual([
      'security_posture', 'security_threats_list', 'security_threat_get',
      'security_attack_surface', 'security_telemetry',
    ]);
    expect(SECURITY_TOOLS.every((t) => t.server === 'security')).toBe(true);
  });

  test('ADVERTISING — every bound lane sees the READS; the act tools are gone for everyone', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    const expected = [
      'security_posture', 'security_threats_list', 'security_threat_get',
      'security_attack_surface', 'security_telemetry',
    ];
    expect((await _securityToolsFor(freshConnection(CSO_LANE))).map((t) => t.name)).toEqual(expected);
    expect((await _securityToolsFor(freshConnection(OTHER_LANE))).map((t) => t.name)).toEqual(expected);
    expect(await _securityToolsFor({ companion: {} })).toEqual([]);

    // The CSO's acts surface is the INTENTS section — and ONLY the seated
    // lane is offered the security types (a lane off the seat keeps its
    // seat-gated types, never the office's).
    const csoSection = await intentSectionFor(freshConnection(CSO_LANE));
    expect(csoSection).toContain('security/scan');
    expect(csoSection).toContain('security/assess');
    expect(csoSection).toContain('security/escalate');
    expect(csoSection).toContain('security/circuit-breaker');
    expect(await intentSectionFor(freshConnection(OTHER_LANE))).not.toContain('security/');
    await csoDesignation.clear(WALLET);
  });

  test('EXECUTION — the seat is re-verified when an act SETTLES, not just when offered', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    await threatLedger.ingest([THREAT]);
    const [entry] = await threatLedger.load();

    // Another lane filing the act (a stale plan, a copied file) is refused at
    // validate — the ledger is untouched, and no card ever rises.
    clientFrames.length = 0;
    await fileIntent(OTHER_LANE, 'intruder-assess', {
      type: 'security/assess', id: entry.id, status: 'not_affected', assessment: 'not my office',
    });
    const intruder = await sweep(freshConnection(OTHER_LANE), 'auto');
    expect(intruder[0].status).toBe('denied');
    expect(intruder[0].error).toMatch(/seated CSO/);
    expect((await threatLedger.get(entry.id)).status).toBe('new');
    expect(clientFrames.some((f) => f.type === 'tool:approval_request')).toBe(false);

    // The seated CSO's assessment LANDS on the real ledger — on the
    // operator's card, even in AUTO (a verdict can quiet a real threat).
    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'cso-assess', {
      type: 'security/assess', id: entry.id.slice(0, 10),
      status: 'confirmed', assessment: 'it bites the fixture surface', surfaces: ['backend/'],
    });
    const settled = await sweep(freshConnection(CSO_LANE), 'auto');
    approvalDecision = null;
    expect(settled[0].status).toBe('ok');
    expect(clientFrames).toContainEqual(expect.objectContaining({
      type: 'tool:approval_request', tool: 'intents/security.assess',
    }));
    const stored = await threatLedger.get(entry.id);
    expect(stored).toMatchObject({ status: 'confirmed', assessedBy: CSO_LANE });
    expect(stored.assessment).toMatch(/fixture surface/);
  }, 30000);

  test('AUTO — a seated CSO cannot quiet a threat behind the operator: the card rises, a NO leaves it open', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    await threatLedger.ingest([{ ...THREAT, externalId: 'GHSA-turned-0001', title: 'a threat a turned CSO would hide' }]);
    const target = (await threatLedger.load()).find((e) => e.externalId === 'GHSA-turned-0001');

    clientFrames.length = 0;
    approvalDecision = 'deny';
    await fileIntent(CSO_LANE, 'turned-assess', {
      type: 'security/assess', id: target.id, status: 'not_affected', assessment: 'nothing to see here',
    });
    const hidden = await sweep(freshConnection(CSO_LANE), 'auto');
    approvalDecision = null;
    expect(hidden[0].status).toBe('denied');
    expect(clientFrames).toContainEqual(expect.objectContaining({
      type: 'tool:approval_request', tool: 'intents/security.assess',
    }));
    expect((await threatLedger.get(target.id)).status).toBe('new');
  }, 30000);

  test('EXECUTION — escalate refuses a threat that is not CONFIRMED (no issue is spoken)', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    await threatLedger.ingest([{ ...THREAT, externalId: 'GHSA-test-0002' }]);
    const entries = await threatLedger.load();
    const fresh = entries.find((e) => e.externalId === 'GHSA-test-0002');

    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'early-escalate', { type: 'security/escalate', id: fresh.id });
    const refused = await sweep(freshConnection(CSO_LANE), 'auto');
    approvalDecision = null;
    expect(refused[0].status).toBe('error');
    expect(refused[0].error).toMatch(/CONFIRMED/);
    expect((await threatLedger.get(fresh.id)).githubIssue).toBeNull();
  }, 30000);

  test('EXECUTION — BATCH assess settles many under one verdict, journals each into the lane drawer', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    await threatLedger.ingest([
      { ...THREAT, externalId: 'GHSA-batch-0001', title: 'batch fixture one' },
      { ...THREAT, externalId: 'GHSA-batch-0002', title: 'batch fixture two' },
    ]);
    const entries = await threatLedger.load();
    const batch = entries.filter((e) => e.externalId.startsWith('GHSA-batch-'));

    // Another lane filing a batch is refused exactly like a single filing.
    await fileIntent(OTHER_LANE, 'intruder-batch', {
      type: 'security/assess', ids: batch.map((e) => e.id), status: 'not_affected', assessment: 'not my office',
    });
    const intruder = await sweep(freshConnection(OTHER_LANE), 'auto');
    expect(intruder[0].status).toBe('denied');

    await fileIntent(CSO_LANE, 'cso-batch', {
      type: 'security/assess',
      ids: batch.map((e) => e.id.slice(0, 10)),
      status: 'not_affected',
      assessment: 'dev-only fixture surface — one reasoning settles both',
      surfaces: ['backend/'],
    });
    approvalDecision = 'allow';
    const settled = await sweep(freshConnection(CSO_LANE), 'auto');
    approvalDecision = null;
    expect(settled[0].status).toBe('ok');
    expect(settled[0].content).toContain('Assessed 2 threat(s)');

    // Both entries carry the verdict AND their own history record.
    for (const e of batch) {
      const stored = await threatLedger.get(e.id);
      expect(stored.status).toBe('not_affected');
      expect(stored.history).toHaveLength(1);
      expect(stored.history[0].assessment).toMatch(/one reasoning settles both/);
      // …and the office's memory landed on the lane's real disk.
      const notes = await fs.readdir(path.join(house, 'workspaces', CSO_LANE, 'security', 'assessments'));
      const note = notes.find((n) => n.endsWith(`-${e.id.replace(/^th_/, '').slice(0, 8)}.md`));
      expect(note).toBeTruthy();
      expect(await fs.readFile(path.join(house, 'workspaces', CSO_LANE, 'security', 'assessments', note), 'utf8'))
        .toContain('dev-only fixture surface');
    }
  }, 30000);

  test('READS ride the real ledger for ANY bound lane', async () => {

    const listed = await _handleSecurityTool(serverWs, freshConnection(OTHER_LANE), null, 'auto',
      { toolName: 'security_threats_list' }, {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('GHSA-test-0001');

    const posture = await _handleSecurityTool(serverWs, freshConnection(OTHER_LANE), null, 'auto',
      { toolName: 'security_posture' }, {});
    expect(posture.status).toBe('ok');
    expect(posture.content).toMatch(/confirmed: 1/);
  }, 30000);

  test('REACH — a circuit-breaker intent asks on the real wire and lands only after approval', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    clientFrames.length = 0;
    approvalDecision = 'deny';
    await fileIntent(CSO_LANE, 'breaker-deny', {
      type: 'security/circuit-breaker',
      action: 'block_source', source: '198.51.100.77', durationSeconds: 30,
      reason: 'Fixture source crossed the critical probe threshold',
    });
    const denied = await sweep(freshConnection(CSO_LANE), 'ask');
    expect(denied[0].status).toBe('denied');
    expect((await circuitBreaker.evaluate('198.51.100.77')).blocked).toBe(false);
    expect(clientFrames).toContainEqual(expect.objectContaining({
      type: 'tool:approval_request',
      tool: 'intents/security.circuit-breaker',
    }));

    clientFrames.length = 0;
    approvalDecision = 'allow';
    await fileIntent(CSO_LANE, 'breaker-allow', {
      type: 'security/circuit-breaker',
      action: 'block_source', source: '198.51.100.77', durationSeconds: 30,
      reason: 'Fixture source crossed the critical probe threshold',
    });
    const allowed = await sweep(freshConnection(CSO_LANE), 'ask');
    expect(allowed[0].status).toBe('ok');
    expect((await circuitBreaker.evaluate('198.51.100.77'))).toMatchObject({
      blocked: true,
      reason: 'source_blocked',
    });
    expect(clientFrames).toContainEqual(expect.objectContaining({
      type: 'tool:approval_request',
      tool: 'intents/security.circuit-breaker',
      scope: expect.stringContaining('block_source 198.51.100.77'),
    }));

    // AUTO no longer releases it unseen either: the firewall is every house's.
    await fileIntent(CSO_LANE, 'breaker-release', {
      type: 'security/circuit-breaker',
      action: 'unblock_source', source: '198.51.100.77',
      reason: 'Fixture approval proof is complete and the source is released',
    });
    const released = await sweep(freshConnection(CSO_LANE), 'auto');
    approvalDecision = null;
    expect(released[0].status).toBe('ok');
    expect((await circuitBreaker.evaluate('198.51.100.77')).blocked).toBe(false);
  }, 30000);

  test('PORTAL DISPATCH — the retired tool answers unavailable; the filed intent settles through the batch-end sweep', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    approvalDecision = 'allow';
    const connection = freshConnection(CSO_LANE);
    connection.toolMode = 'auto';

    // A stale plan calling the old tool name gets the honest answer.
    await fileIntent(CSO_LANE, 'dispatch-proof', {
      type: 'security/circuit-breaker',
      action: 'block_source', source: '198.51.100.78', durationSeconds: 30,
      reason: 'Parsed portal dispatch reached the intent sweep',
    });
    const results = await processToolCalls(serverWs, [
      '[TOOL: security/security_circuit_breaker ',
      '{"action":"block_source","source":"198.51.100.78","durationSeconds":30,',
      '"reason":"a stale tool name"}]',
    ].join(''), connection);
    expect(results[0].status).toBe('unavailable');
    // …and the batch-end sweep settled the filed intent in the SAME batch —
    // the receipt rides the results the model reads next round.
    const receipt = results.find((r) => r.tool === 'intents/security.circuit-breaker');
    expect(receipt?.status).toBe('ok');
    expect((await circuitBreaker.evaluate('198.51.100.78')).blocked).toBe(true);

    await fileIntent(CSO_LANE, 'dispatch-release', {
      type: 'security/circuit-breaker',
      action: 'unblock_source', source: '198.51.100.78',
      reason: 'Parsed portal dispatch proof completed and released the source',
    });
    await sweep(connection, 'auto');
    approvalDecision = null;
    expect((await circuitBreaker.evaluate('198.51.100.78')).blocked).toBe(false);
  }, 30000);

  test('SCAN — the real watch runs over the real tmp stores and settles done', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    // A hermetic watch list: one tmp repo with NO lockfile, so the advisory
    // leg answers its honest "unwatched" note and NO network is touched
    // (the default seed is the operator's real checkout — never in a test).
    const fixtureRepo = path.join(house, 'fixture-repo');
    await fs.mkdir(fixtureRepo, { recursive: true });
    await fs.writeFile(path.join(fixtureRepo, 'index.js'), 'console.log("fixture");\n');
    const watchFile = path.join(house, 'realm', WALLET, 'offices', 'security', 'security-watch.json');
    await fs.mkdir(path.dirname(watchFile), { recursive: true });
    await fs.writeFile(watchFile, JSON.stringify({
      repos: [{ id: 'fixture-repo', path: fixtureRepo }],
      host: { expectedPorts: [] },
    }));

    clientFrames.length = 0;
    approvalDecision = null;
    await fileIntent(CSO_LANE, 'the-scan', { type: 'security/scan' });
    const receipts = await sweep(freshConnection(CSO_LANE), 'auto');

    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('fixture-repo');
    expect(receipts[0].content).toContain('unwatched'); // no lockfile — said, never faked clean
    expect(receipts[0].content).toMatch(/Ledger: \d+ new, \d+ known/);
    const result = JSON.parse(await fs.readFile(
      path.join(workspace.pathFor(CSO_LANE), 'intents', 'the-scan.result.json'), 'utf8'));
    expect(result.status).toBe('done');
    // No card fired — auto mode — and the scan state landed on the tmp disk.
    expect(clientFrames.some((f) => f.type === 'tool:approval_request')).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(house, 'realm', WALLET, 'offices', 'security', 'security-scan-state.json'), 'utf8')).lastRunAt).toBeTruthy();
  }, 60000);

  test('BRIEFING — only the seated CSO carries the office section, built from the REAL stores', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    const briefing = await _csoBriefingSection(freshConnection(CSO_LANE));
    expect(briefing).toContain('CSO office');
    expect(briefing).toContain('fixture advisory for the gate'); // the confirmed entry stands, by title
    expect(briefing).toMatch(/NEVER run|Last scan/); // honest either way on this tmp state

    // Every other lane — and an unseated office — proceeds without the section.
    expect(await _csoBriefingSection(freshConnection(OTHER_LANE))).toBe('');
    await csoDesignation.clear(WALLET);
    expect(await _csoBriefingSection(freshConnection(CSO_LANE))).toBe('');
  }, 30000);

  test('TWO HOUSES — the same lane id seated in each: seat, ledger, acts and briefing never cross', async () => {
    await csoDesignation.designate(WALLET, CSO_LANE);
    // House B is another ground with its own guardianlane, owned by B.
    const groundB = path.join(house, 'workspaces-b');
    await writeOwner(groundB, CSO_LANE, HOUSE_B);
    setWorkspacesRoot(groundB);
    try {
      await csoDesignation.designate(HOUSE_B, CSO_LANE);
      const asB = () => freshConnection(CSO_LANE, HOUSE_B);
      // B's office is B's: its own empty ledger, never A's threats.
      const listed = await _handleSecurityTool(serverWs, asB(), null, 'auto', { toolName: 'security_threats_list' }, {});
      expect(listed.content).not.toContain('GHSA-test-0001');
      const briefingB = await _csoBriefingSection(asB());
      expect(briefingB).toContain('CSO office');
      expect(briefingB).not.toContain('fixture advisory for the gate');
      // B's seated CSO settling A's threat id finds nothing in its own house.
      const [entryA] = await threatLedger.load();
      await fileIntent(CSO_LANE, 'cross-house-assess', {
        type: 'security/assess', id: entryA.id, status: 'not_affected', assessment: 'not my house',
      });
      approvalDecision = 'allow';
      const crossed = await sweep(asB(), 'auto');
      approvalDecision = null;
      expect(crossed[0].status).not.toBe('ok');
      expect((await threatLedger.get(entryA.id)).status).not.toBe('not_affected');

      // Clearing B's seat leaves A's standing; B's lane holds no acts then.
      await csoDesignation.clear(HOUSE_B);
      expect(await intentSectionFor(asB())).not.toContain('security/');
      expect(await _csoBriefingSection(asB())).toBe('');
    } finally {
      setWorkspacesRoot(path.join(house, 'workspaces'));
    }
    expect((await csoDesignation.getOfficer(WALLET)).laneId).toBe(CSO_LANE);
    expect(await _csoBriefingSection(freshConnection(CSO_LANE))).toContain('fixture advisory for the gate');
    // A connection with no house briefs nothing.
    expect(await _csoBriefingSection(freshConnection(CSO_LANE, null))).toBe('');
    await csoDesignation.clear(WALLET);
  }, 30000);
});
