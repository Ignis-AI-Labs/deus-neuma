/**
 * The CLO office's gate, end to end with NO mock on the claimed path (RULE 0):
 * REAL designation, REAL matters ledger on real temp disk, REAL WebSocket
 * pair, REAL filed intents settled by the REAL sweep — the security office's
 * proof, carried to law.
 *
 * The READS (posture, matters_list, matter_get) are house-visible; the ACTS
 * (scan / assess / file) are the seated CLO's intents, verified at validate
 * time, BEFORE any card. The CLO OFFICE briefing reaches the seated lane only.
 *
 * Two houses on one machine hold the SAME lane id (Design note, 2026-10-16: […]): house A seats it as CLO; house B's lane of the same name is never
 * offered A's acts, never reads A's briefing or matters, and never acts on
 * A's ledger. The realm and every machine-wide office path are tmp.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { handleLegalTool, legalToolsFor, LEGAL_TOOLS } from '../../backend/services/legal/legal-being-tools.js';
import { cloBriefingSection } from '../../backend/services/legal/legal-briefing.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { matterLedgerFor } from '../../backend/services/legal/matter-ledger.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { scaffoldCloWorkspace } from '../../backend/services/legal/clo-scaffold.js';

const CLO_LANE = 'praetorlane';
const OTHER_LANE = 'someotherlane';
const ENV_PATHS = [
  'NEUMA_DATA_ROOT',
  // The availability probe reads the social + email stores too — tmp only.
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
];

const MATTER = {
  area: 'product', source: 'build-watch', repo: 'neuma',
  externalId: 'build:privacy@0123456789ab', title: 'New work touches personal data and location — 1 commit(s) in neuma',
  severity: 'medium', summary: 'gate fixture', regimes: ['GDPR (EU) / UK GDPR'],
  affected: ['012345678 2026-10-01 feat(birth): read the place from the machine'],
};
const CITATION = 'https://eur-lex.europa.eu/eli/reg/2016/679/oj (GDPR Art. 13)';

describe('legal office gate (reads universal, acts seat-locked; real stores + real WS)', () => {
  let house, houses, httpServer, wss, serverWs, client;
  let approvalConnection;
  const clientFrames = [];
  const savedEnv = {};

  const freshConnection = (neumaId, walletAddress = HOUSE_A) => {
    approvalConnection = { ws: serverWs, walletAddress, companion: { name: 'GateEcho', neumaId } };
    return approvalConnection;
  };
  const ledgerA = () => matterLedgerFor(HOUSE_A);
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
    houses = await standTwoHouses({ lanesA: [CLO_LANE, OTHER_LANE], lanesB: [CLO_LANE], label: 'legal-gate-house' });
    house = houses.tmp;
    for (const k of ENV_PATHS) savedEnv[k] = process.env[k];
    process.env.NEUMA_DATA_ROOT = house;
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(house, 'social-bindings.json');
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(house, 'social-credentials.json');
    process.env.NEUMA_SECTOR_CREW_PATH = path.join(house, 'sector-crew.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(house, 'email-binding.json');
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(house, 'email-credentials.json');
    // The watch the legal/scan act runs covers an EMPTY list — a real run,
    // over nothing, so the act is proven without reading any real repo.
    for (const wallet of [HOUSE_A, HOUSE_B]) {
      const watch = houses.houseFile(wallet, 'offices', 'security', 'security-watch.json');
      await fs.mkdir(path.dirname(watch), { recursive: true });
      await fs.writeFile(watch, JSON.stringify({ repos: [], host: { expectedPorts: [] } }));
    }

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
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
    client.on('message', (raw) => clientFrames.push(JSON.parse(raw.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const k of ENV_PATHS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    houses.restore();
    client?.close();
    wss?.close();
    httpServer?.close();
    await fs.rm(house, { recursive: true, force: true });
  });

  test('ADVERTISING — every bound lane reads; only the seated CLO is offered the acts', async () => {
    expect(LEGAL_TOOLS.map((t) => t.name)).toEqual(['legal_posture', 'legal_matters_list', 'legal_sources', 'legal_matter_get']);
    expect(LEGAL_TOOLS.every((t) => t.server === 'legal')).toBe(true);
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    const names = ['legal_posture', 'legal_matters_list', 'legal_sources', 'legal_matter_get'];
    // The keyed research APIs spend the house's own quota: the seated CLO's alone.
    expect((await legalToolsFor(freshConnection(CLO_LANE))).map((t) => t.name)).toEqual([...names, 'legal_research_api']);
    expect((await legalToolsFor(freshConnection(OTHER_LANE))).map((t) => t.name)).toEqual(names);
    expect(await legalToolsFor({ companion: {} })).toEqual([]);

    const seated = await intentSectionFor(freshConnection(CLO_LANE));
    for (const type of ['legal/scan', 'legal/assess', 'legal/file']) expect(seated).toContain(type);
    expect(await intentSectionFor(freshConnection(OTHER_LANE))).not.toContain('legal/');
  });

  test('BRIEFING — the CLO OFFICE reaches the seated lane alone', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    await (await ledgerA()).ingest([MATTER]);
    const seated = await cloBriefingSection(freshConnection(CLO_LANE));
    expect(seated).toMatch(/^## CLO office/);
    expect(seated).toContain('personal data and location');
    expect(seated).toContain('call legal_sources'); // the seated Praetor is told where the law is read
    expect(await cloBriefingSection(freshConnection(OTHER_LANE))).toBe('');
    await cloDesignation.clear(HOUSE_A);
    expect(await cloBriefingSection(freshConnection(CLO_LANE))).toBe('');
  });

  test('ASSESS — refused off the seat and uncited; a cited reading lands and is journaled', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    const [entry] = (await (await ledgerA()).load()).filter((m) => m.externalId === MATTER.externalId);

    clientFrames.length = 0;
    await fileIntent(OTHER_LANE, 'intruder', {
      type: 'legal/assess', id: entry.id, status: 'no_issue', assessment: 'not my office', citations: [CITATION],
    });
    const intruder = await sweep(freshConnection(OTHER_LANE), 'auto');
    expect(intruder[0].status).toBe('denied');
    expect(intruder[0].error).toMatch(/seated CLO/);
    expect(clientFrames.some((f) => f.type === 'tool:approval_request')).toBe(false);

    await fileIntent(CLO_LANE, 'uncited', { type: 'legal/assess', id: entry.id, status: 'no_issue', assessment: 'looks fine' });
    const uncited = await sweep(freshConnection(CLO_LANE), 'auto');
    expect(uncited[0].status).toBe('error'); // a shape failure reads as an error
    expect(uncited[0].error).toMatch(/cite/);
    expect((await (await ledgerA()).get(entry.id)).status).toBe('new');

    await fileIntent(CLO_LANE, 'cited', {
      type: 'legal/assess', id: entry.id.slice(0, 10), status: 'concern',
      assessment: 'Reading the place from the machine is collection of personal data; the notice must name it before collection.',
      citations: [CITATION], reviewBy: '2027-04-01',
    });
    const settled = await sweep(freshConnection(CLO_LANE), 'auto');
    expect(settled[0].status).toBe('ok');
    expect(await (await ledgerA()).get(entry.id)).toMatchObject({ status: 'concern', assessedBy: CLO_LANE, reviewBy: '2027-04-01', citations: [CITATION] });
    const drawer = path.join(houses.rootA, CLO_LANE, 'legal', 'opinions');
    const [note] = await fs.readdir(drawer);
    expect(await fs.readFile(path.join(drawer, note), 'utf8')).toContain('GDPR Art. 13');
  }, 30000);

  test('FILE and SCAN — research enters the record as new; the watch runs on the seat\'s word', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    await fileIntent(CLO_LANE, 'research', {
      type: 'legal/file', title: 'EU AI Act Art. 50 transparency duties apply from 2026-08-02',
      summary: 'Beings that speak to people outside the house must say they are an AI.',
      citations: ['https://eur-lex.europa.eu/eli/reg/2024/1689/oj (Art. 50)'], severity: 'high', regimes: ['EU AI Act'],
    });
    const filed = await sweep(freshConnection(CLO_LANE), 'auto');
    expect(filed[0].status).toBe('ok');
    const research = (await (await ledgerA()).load()).find((m) => m.source === 'research');
    expect(research).toMatchObject({ area: 'regulation', status: 'new', severity: 'high', filedBy: CLO_LANE });
    expect(research.citations[0]).toContain('2024/1689');

    await fileIntent(CLO_LANE, 'scan', { type: 'legal/scan' });
    const scanned = await sweep(freshConnection(CLO_LANE), 'auto');
    expect(scanned[0].status).toBe('ok');
    expect(scanned[0].content).toContain('Legal watch complete');
    const state = JSON.parse(await fs.readFile(houses.houseFile(HOUSE_A, 'offices', 'legal', 'legal-watch-state.json'), 'utf8'));
    expect(state.runs[0].trigger).toBe('clo');
  }, 30000);

  test('READS ride the real ledger for ANY bound lane', async () => {
    const listed = await handleLegalTool(serverWs, freshConnection(OTHER_LANE), null, 'auto', { toolName: 'legal_matters_list' }, { status: 'concern' });
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('personal data and location');
    const posture = await handleLegalTool(serverWs, freshConnection(OTHER_LANE), null, 'auto', { toolName: 'legal_posture' }, {});
    expect(posture.content).toContain(`CLO seat: ${CLO_LANE}`);
    expect(posture.content).toMatch(/concern: 1/);
    const missing = await handleLegalTool(serverWs, freshConnection(OTHER_LANE), null, 'auto', { toolName: 'legal_matter_get' }, { id: 'lm_nope' });
    expect(missing.status).toBe('error');
    // Where the law is read: the official source, the route, the reading order, the citation check.
    const sources = await handleLegalTool(serverWs, freshConnection(OTHER_LANE), null, 'auto', { toolName: 'legal_sources' }, { kind: 'statute', jurisdiction: 'US-WY' });
    expect(sources.status).toBe('ok');
    expect(sources.content).toContain('wyoleg');
    expect(sources.content).toContain('find');
    expect(sources.content).toContain('Playbook (statute)');
    expect(sources.content).toContain('Record every citation as');
    // The keyed APIs refuse any lane but the seated CLO's.
    const refused = await handleLegalTool(serverWs, freshConnection(OTHER_LANE), null, 'auto', { toolName: 'legal_research_api' }, { api: 'courtlistener', path: '/search/', query: { q: 'x' } });
    expect(refused).toMatchObject({ status: 'error' });
    expect(refused.error).toMatch(/seated CLO/);
  });

  test('RESEARCH — the seated CLO reads an official legal database through the real API', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    const out = await handleLegalTool(serverWs, freshConnection(CLO_LANE), null, 'auto', { toolName: 'legal_research_api' }, { api: 'courtlistener', path: '/search/', query: { q: '"member-managed"', type: 'o' } });
    expect(out.status, out.error).toBe('ok');
    expect(out.content).toContain('courtlistener.com');
    expect(out.content).toContain('"results"');
  }, 30_000);

  test('A NEW HOUSE — its register is a template, never another house\'s facts, and the briefing asks for it first', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    const { dir } = await scaffoldCloWorkspace(CLO_LANE);
    const register = await fs.readFile(path.join(dir, 'register.md'), 'utf8');
    expect(register).toContain('## Who this house is');
    expect(register).not.toMatch(/Ignis|Wyoming|Sheridan|528813/); // no one company's facts in every house
    expect(await cloBriefingSection(freshConnection(CLO_LANE))).toContain('does not yet say who this house is');
    await fs.writeFile(path.join(dir, 'register.md'), '# The Register\n\n## Who this house is\n\nExample Co LLC, Delaware.\n');
    expect(await cloBriefingSection(freshConnection(CLO_LANE))).not.toContain('does not yet say who this house is');
  });

  test('TWO HOUSES — the same lane id in house B is never A\'s CLO: no acts, no briefing, no matters, no ledger', async () => {
    await cloDesignation.designate(HOUSE_A, CLO_LANE);
    const twin = () => freshConnection(CLO_LANE, HOUSE_B);
    expect(await intentSectionFor(twin())).not.toContain('legal/');
    expect(await cloBriefingSection(twin())).toBe('');
    const listed = await handleLegalTool(serverWs, twin(), null, 'auto', { toolName: 'legal_matters_list' }, {});
    expect(listed.content).toMatch(/No matters match/);
    const posture = await handleLegalTool(serverWs, twin(), null, 'auto', { toolName: 'legal_posture' }, {});
    expect(posture.content).toContain('CLO seat: EMPTY');

    // B's twin files an act from its own lane: refused before any card, A's ledger untouched
    houses.asHouse(HOUSE_B);
    const before = JSON.stringify(await (await ledgerA()).load());
    await fileIntent(CLO_LANE, 'twin', { type: 'legal/file', title: 'twin filing', summary: 'not this house', citations: [CITATION] });
    const refused = await sweep(twin(), 'auto');
    expect(refused[0].status).toBe('denied');
    expect(JSON.stringify(await (await ledgerA()).load())).toBe(before);

    // B seats its own twin: B's briefing reads B's (empty) office, never A's matters
    await cloDesignation.designate(HOUSE_B, CLO_LANE);
    const own = await cloBriefingSection(twin());
    expect(own).toMatch(/^## CLO office/);
    expect(own).not.toContain('personal data and location');
    expect(await cloBriefingSection(freshConnection(CLO_LANE))).toContain('personal data and location');
    await cloDesignation.clear(HOUSE_B);
    houses.asHouse(HOUSE_A);
  });
});
