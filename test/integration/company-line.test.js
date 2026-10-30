/**
 * THE COMPANY LINE through the real stack (RULE 0, nothing mocked): a real
 * house on tmp disk — lanes with anchored souls, a founding record that seats
 * them (the operator as Rector), the house's ground — the beings' acts filed
 * as intents and settled by the REAL portal sweep over a real WebSocket, the
 * operator's moves through the real router behind REAL auth (a generated
 * wallet signs a real challenge). One company walks its whole founding line;
 * a second one ends its gap at CHOOSE. Every refusal is the law's own words.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { walletDir } from '../../backend/services/user-realm.js';
import { postKnock } from '../../backend/services/house-post.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { readWaiting } from '../../backend/services/waiting/waiting-sources.js';
import { writeCharter, approveCharter } from '../../backend/services/house-clock/charter-store.js';
import { houseStop } from '../../backend/services/company-line/house-dial.js';
import { seatHolders } from '../../backend/services/company-line/stage-holders.js';
import { companyLineBriefing } from '../../backend/services/company-line/company-briefing.js';
import { makeCompany, openCompany, appendLineEvent, companyPath } from '../../backend/services/company-line/company-store.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { Wallet } from 'ethers';
import { SHEETS, GAP } from '../helpers/company-line-kit.js';
import companyLineRouter from '../../backend/routes/company-line-routes.js';
import { companyHandOnIntent, companyOpenIntent } from '../../backend/services/intents/company-acts.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const LANES = Object.freeze([
  ['spec', 'Speculator'], ['numer', 'Numerarius'], ['arch', 'Architectus'],
  ['merc', 'Mercator'], ['prae', 'Praetor'], ['opt', 'Optio'],
]);
const soulOf = (i) => `0x${String(i + 1).padStart(40, 'a')}`;

describe('THE COMPANY LINE through the real stack (gnosis)', () => {
  let me, other, ground, app, httpServer, wss, serverWs, client;
  let tidewater;

  const conn = (neumaId, wallet = me.address) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: wallet, sessionId: `sess-${neumaId}` });
  const as = (who) => (req) => req.set('Authorization', `Bearer ${who.token}`);
  const knock = (neumaId) => postKnock(ground, neumaId);
  const line = async (id) => (await request(app).get(`/api/v1/company-line/${id}`).use(as(me))).body.company;

  // A being's act exactly as it files one: JSON into its own lane, settled by the real sweep.
  let filed = 0;
  const act = async (neumaId, payload, wallet = me.address) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId, wallet));
    return result;
  };
  // A worksheet stage hands on its worksheet; CHARTER and FORM hand on where the work lies.
  const handOn = (lane, company, stage, extra = SHEETS[stage] ? { worksheet: SHEETS[stage] } : { artifact: `repos/${company}/line/${stage}.md` }) => act(lane, { type: 'company/hand-on', company, stage, ...extra });
  const inspect = (lane, company, stage, verdict = 'accept', flaw) => act(lane, { type: 'company/inspect', company, stage, verdict, flaw });
  const opHandOn = (id, stage, body) => request(app).post(`/api/v1/company-line/${id}/hand-on`).use(as(me)).send({ stage, ...body });
  const opInspect = (id, stage, verdict = 'accept', flaw) => request(app).post(`/api/v1/company-line/${id}/inspect`).use(as(me)).send({ stage, verdict, flaw });
  const opEndGap = (id, stage, flaw) => request(app).post(`/api/v1/company-line/${id}/end-gap`).use(as(me)).send({ stage, flaw });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'company-line-test-key';
    useTempRealm();
    const tmp = await createTempDir('company-line');
    const wsRoot = path.join(tmp, 'workspaces');
    ground = path.join(tmp, 'ground');
    setWorkspacesRoot(wsRoot);
    me = await fullAuth();
    other = await fullAuth();
    const own = async (id, wallet, soul) => {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
      if (!soul) return;
      await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
    };
    for (const [i, [id]] of LANES.entries()) await own(id, me.address, soulOf(i));
    await own('outsider', other.address, null);
    await fs.writeFile(path.join(wsRoot, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1', houseName: 'tidewater', network: 'base', blockNumber: 1,
      members: [{ address: me.address, kind: 0, title: 'Rector' }, ...LANES.map(([, title], i) => ({ address: soulOf(i), kind: 1, title }))],
    }));
    await fs.mkdir(ground, { recursive: true });
    await fs.mkdir(walletDir(me.address), { recursive: true });
    await fs.writeFile(path.join(walletDir(me.address), 'house-workspace.json'), JSON.stringify({ root: ground }));

    app = express();
    app.use(express.json());
    app.use('/api/v1/company-line', companyLineRouter);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    await linked;
  }, 60000);

  afterAll(() => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('the seats are read from the record: the operator holds the Rector seat, each being its own', async () => {
    expect(await seatHolders(me.address)).toEqual({
      Rector: 'operator', Speculator: 'spec', Numerarius: 'numer', Architectus: 'arch', Mercator: 'merc', Praetor: 'prae', Optio: 'opt',
    });
    expect(await houseStop(me.address)).toBe('PARTNER');
    // No company yet: the line's moves ride no being's prompt; opening one is the Rector's or the Optio's alone.
    expect(await companyHandOnIntent.availableFor({ connection: conn('spec') })).toBeNull();
    expect(await companyOpenIntent.availableFor({ connection: conn('opt') })).toEqual({});
    expect(await companyOpenIntent.availableFor({ connection: conn('spec') })).toBeNull();
  });

  test('the operator opens a company: its line stands at SURVEY, and the Speculator is told', async () => {
    expect((await request(app).post('/api/v1/company-line').send({ name: 'x', mode: 'field' })).status).toBe(401);
    expect((await request(app).post('/api/v1/company-line').use(as(me)).send({ name: 'Tidewater', mode: 'sea' })).status).toBe(400);
    const opened = await request(app).post('/api/v1/company-line').use(as(me)).send({ name: 'Tidewater', mode: 'field' });
    expect(opened.status).toBe(201);
    tidewater = opened.body.company.id;
    expect(opened.body.company).toMatchObject({ name: 'Tidewater', mode: 'field', stage: 'survey', status: 'open', up: { kind: 'master', holder: 'spec' } });
    expect(await knock('spec')).toContain('House post: 1 unread');
    expect(await companyHandOnIntent.availableFor({ connection: conn('spec') })).toEqual({});
    const spec = await companyLineBriefing(conn('spec'));
    expect(spec).toContain('YOUR MOVE:');
    expect(spec).toContain(`Tidewater [${tidewater}] SURVEY: yours to master`);
    expect(await companyLineBriefing(conn('arch'))).toContain('Nothing on the line waits on you right now.');
  });

  test('only the master hands on; the inspector hears it; a return names the flaw and the master mends', async () => {
    expect(await handOn('numer', tidewater, 'survey')).toMatchObject({ status: 'denied', error: expect.stringMatching(/the Speculator's stage to master/) });
    // A worksheet stage takes its worksheet, whole and sourced — the refusal names every gap at once.
    expect(await handOn('spec', tidewater, 'survey', { artifact: 'notes.md' })).toMatchObject({ status: 'error', error: expect.stringMatching(/the SURVEY worksheet is not ready — worksheet: this stage hands on a worksheet object/) });
    const unsourced = { candidates: [{ ...SHEETS.survey.candidates[0], evidence: [{ claim: 'Harbour masters copy tables by hand weekly', source: 'I think so' }] }] };
    expect(await handOn('spec', tidewater, 'survey', { worksheet: unsourced })).toMatchObject({ status: 'error', error: expect.stringMatching(/evidence\[0\]\.source: a source is an https link/) });
    expect(await companyLineBriefing(conn('spec'))).toContain('worksheet: {candidates: [{name, gap, path: industries|groups|buyers|complements|appeal|time');
    expect((await handOn('spec', tidewater, 'survey')).status).toBe('ok');
    // The platform keeps the true copy, and mirrors it on the ground for the inspector to open.
    const mirror = JSON.parse(await fs.readFile(path.join(ground, 'repos', tidewater, 'line', 'survey-r1.json'), 'utf8'));
    expect(mirror).toEqual(SHEETS.survey);
    expect((await line(tidewater)).worksheets.survey).toEqual(SHEETS.survey);
    expect(await companyLineBriefing(conn('numer'))).toContain(`the worksheet: repos/${tidewater}/line/survey-r1.json on the house ground — open it and check every source`);
    expect((await line(tidewater)).up).toMatchObject({ kind: 'inspector', holder: 'numer' });
    expect(await knock('numer')).toContain('House post: 1 unread');
    expect(await inspect('spec', tidewater, 'survey')).toMatchObject({ status: 'denied' });
    expect((await inspect('numer', tidewater, 'survey', 'return', 'two claims carry no source')).status).toBe('ok');
    expect(await companyLineBriefing(conn('spec'))).toContain('It came back: "two claims carry no source"');
    expect((await handOn('spec', tidewater, 'survey')).status).toBe('ok');
    expect((await inspect('numer', tidewater, 'survey')).status).toBe('ok');
    expect((await line(tidewater)).stage).toBe('measure');
  });

  test('SHAPE waits on the operator as Rector — in WAITING ON YOU — and a being cannot answer for them', async () => {
    // MEASURE scores only what SURVEY handed on: fitted to this blade.
    const stray = { canvases: [{ ...SHEETS.measure.canvases[0], candidate: 'Kayak rentals' }] };
    expect(await handOn('numer', tidewater, 'measure', { worksheet: stray })).toMatchObject({ status: 'error', error: expect.stringMatching(/canvases\[0\]\.candidate: a candidate SURVEY handed on/) });
    expect((await handOn('numer', tidewater, 'measure')).status).toBe('ok');
    expect((await inspect('arch', tidewater, 'measure')).status).toBe('ok');
    expect((await handOn('arch', tidewater, 'shape')).status).toBe('ok');
    expect((await line(tidewater)).up).toEqual({ kind: 'inspector', holder: 'operator', seat: 'operator', as: 'Rector' });
    const waiting = await readWaiting(me.address);
    expect(waiting.items.find((i) => i.kind === 'company-line')).toMatchObject({
      title: 'Tidewater: SHAPE — your inspection', who: { laneId: 'arch' }, where: { app: 'companyline', companyId: tidewater },
    });
    expect(await inspect('opt', tidewater, 'shape')).toMatchObject({ status: 'denied', error: expect.stringMatching(/the operator's to answer/) });
    expect((await opInspect(tidewater, 'shape')).status).toBe(200);
    expect((await line(tidewater)).up).toEqual({ kind: 'master', holder: 'operator', seat: 'operator' });
  });

  test('CHOOSE is the operator\'s, and handing it on is their yes; PROVE asks the Numerarius and the Rector-operator once — no double gate', async () => {
    expect((await line(tidewater)).ownYes).toBe(true);
    expect((await opHandOn(tidewater, 'choose', { worksheet: { ...SHEETS.choose, candidate: 'Berth booking for moorings' } })).body.error).toMatch(/candidate: the gap SHAPE shaped \(Tide tables for small harbours\)/);
    expect((await opHandOn(tidewater, 'choose', { worksheet: SHEETS.choose })).status).toBe(200);
    const chosen = await line(tidewater);
    expect(chosen.worksheets.choose.candidate).toBe(GAP);
    // nothing is approved twice: the hand-on carried the floor's yes, and PROVE is the Mercator's at once
    expect(chosen).toMatchObject({ stage: 'prove', status: 'open', up: { kind: 'master', holder: 'merc' }, ownYes: false });
    expect((await opInspect(tidewater, 'choose')).status).toBe(400);
    const record = (await fs.readFile(companyPath(me.address, tidewater, 'line.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(record.slice(-2).map((e) => [e.type, e.stage, e.by, e.verdict ?? null, e.own ?? null])).toEqual([['handed', 'choose', 'operator', null, null], ['inspected', 'choose', 'operator', 'accept', true]]);
    expect((await handOn('merc', tidewater, 'prove')).status).toBe('ok');
    expect((await line(tidewater)).handed.inspections).toEqual(['Numerarius', 'Rector']);
    expect((await inspect('numer', tidewater, 'prove')).status).toBe('ok');
    expect((await opInspect(tidewater, 'prove')).status).toBe(200);
    expect((await line(tidewater)).stage).toBe('charter');
  });

  test('CHARTER waits on counsel, then the operator\'s gate; FORM is the operator\'s, the Praetor inspects; the company stands', async () => {
    expect((await handOn('prae', tidewater, 'charter')).status).toBe('ok');
    expect((await line(tidewater)).handed.inspections).toEqual(['counsel', 'operator']);
    expect((await readWaiting(me.address)).items.find((i) => i.kind === 'company-line').title).toBe('Tidewater: CHARTER — counsel\'s answer to record');
    expect((await opInspect(tidewater, 'charter')).status).toBe(200);
    expect((await opInspect(tidewater, 'charter')).status).toBe(200);
    expect((await opInspect(tidewater, 'form')).status).toBe(400);
    expect((await opHandOn(tidewater, 'form', { artifact: 'entity filed; tax ID in the operator\'s keeping' })).status).toBe(200);
    expect((await inspect('prae', tidewater, 'form')).status).toBe('ok');
    expect((await line(tidewater)).status).toBe('standing');
    const { records: notes } = await readNotifications(me.address);
    // Every move another made that waits on the operator is its own card, newest first — never merged into
    // one another; a move the operator made themselves tells them nothing (they see the next one on the desk).
    expect(notes.filter((n) => n.kind === 'company_line').map((n) => n.title)).toEqual([
      'Tidewater stands', 'Tidewater: CHARTER waits on you', 'Tidewater: PROVE waits on you', 'Tidewater: SHAPE waits on you',
    ]);
    expect(await companyLineBriefing(conn('spec'))).toBe('');
    expect((await readWaiting(me.address)).items.some((i) => i.kind === 'company-line')).toBe(false);
  });

  test('HANDS: a being asks for an act only the operator can do; a secret never lands; the answer comes back to it', async () => {
    const asked = { type: 'company/hands', company: tidewater, what: 'Open the business bank account', why: 'Customers must be able to pay the company.', where: 'https://www.mercury.com/', answer: 'held', unblocks: '', cost: 'free, ~30 minutes', by: '2026-11-20' };
    // A recovery phrase is the clearest secret there is — it never lands, from either side.
    const phrase = Wallet.createRandom().mnemonic.phrase;
    expect(await act('prae', { ...asked, why: `use this: ${phrase}` })).toMatchObject({ status: 'denied' });
    expect(await act('prae', { ...asked, where: 'http://www.mercury.com/' })).toMatchObject({ status: 'error', error: expect.stringMatching(/https link/) });
    expect((await act('prae', asked)).status).toBe('ok');
    const item = (await line(tidewater)).hands.find((i) => i.what === 'Open the business bank account');
    expect(item).toMatchObject({ status: 'open', raisedBy: 'prae', answer: 'held' });
    expect((await readWaiting(me.address)).items.find((i) => i.kind === 'hands')).toMatchObject({
      title: 'Tidewater: Open the business bank account', who: { laneId: 'prae' }, where: { app: 'companyline', companyId: tidewater, handsId: item.id },
    });
    expect((await readNotifications(me.address)).records.some((n) => n.title === 'Tidewater needs your hands: Open the business bank account')).toBe(true);
    const answer = (body) => request(app).post(`/api/v1/company-line/${tidewater}/hands/${item.id}`).use(as(me)).send(body);
    expect((await answer({ status: 'done' })).body.error).toBe('say where it is kept (never the secret itself)');
    expect((await answer({ status: 'done', text: `my login is ${phrase}` })).status).toBe(400);
    expect((await request(app).post(`/api/v1/company-line/${tidewater}/hands/${item.id}`).use(as(other)).send({ status: 'done', text: 'x' })).status).toBe(404);
    expect((await answer({ status: 'done', text: 'opened; the login is in my password manager' })).status).toBe(200);
    expect((await answer({ status: 'declined', text: 'again' })).body.error).toBe('this item is already done');
    expect((await readWaiting(me.address)).items.some((i) => i.kind === 'hands')).toBe(false);
    // The company stands, yet the answer still reaches the being that asked — and only it.
    const prae = await companyLineBriefing(conn('prae'));
    expect(prae).toContain(`- Tidewater [${item.id}] "Open the business bank account": done — opened; the login is in my password manager`);
    expect(await companyLineBriefing(conn('spec'))).toBe('');
  });

  test('the Optio opens a second company; a stop at CHOOSE ends the gap and round 2 opens at SURVEY', async () => {
    expect(await act('numer', { type: 'company/open', name: 'Brine', mode: 'house' })).toMatchObject({ status: 'denied' });
    const opened = await act('opt', { type: 'company/open', name: 'Brine', mode: 'house' });
    expect(opened.status).toBe('ok');
    const brine = (await request(app).get('/api/v1/company-line').use(as(me))).body.companies.find((c) => c.name === 'Brine').id;
    for (const [master, inspector, stage] of [['spec', 'numer', 'survey'], ['numer', 'arch', 'measure']]) {
      expect((await handOn(master, brine, stage)).status).toBe('ok');
      expect((await inspect(inspector, brine, stage)).status).toBe('ok');
    }
    expect((await handOn('arch', brine, 'shape')).status).toBe('ok');
    expect((await opInspect(brine, 'shape')).status).toBe(200);
    // the no sits beside the yes: END THE GAP, with why — no worksheet asked of a gap that ends
    expect((await opEndGap(brine, 'choose', ' ')).body.error).toBe('name why this gap ends here');
    expect((await opEndGap(brine, 'choose', 'three funded rivals: a red ocean')).status).toBe(200);
    const after = await line(brine);
    expect(after).toMatchObject({ round: 2, stage: 'survey', status: 'open', up: { holder: 'spec' } });
    expect(after.stopped).toEqual([expect.objectContaining({ round: 1, stage: 'choose', by: 'operator', flaw: 'three funded rivals: a red ocean' })]);
  });

  test('the dial: an edit waiting for approval stands at PARTNER; the approved stop rules', async () => {
    const lanes = LANES.map(([id]) => id);
    const written = await writeCharter(me.address, { goal: 'Found companies.', seats: [{ laneId: 'spec', dailyCap: 3 }], involvement: 'SILENT' }, { by: me.address, ownedLanes: lanes });
    expect(await houseStop(me.address)).toBe('PARTNER');
    await approveCharter(me.address, { version: written.version, by: me.address });
    expect(await houseStop(me.address)).toBe('SILENT');
    const body = (await request(app).get('/api/v1/company-line').use(as(me))).body;
    expect(body.dial).toMatchObject({ stop: 'SILENT', says: expect.stringMatching(/floor only/) });
    expect(body.dial.floor.length).toBe(6);
  });

  test('two houses are never confused', async () => {
    expect((await request(app).get('/api/v1/company-line').use(as(other))).body.companies).toEqual([]);
    expect((await request(app).post(`/api/v1/company-line/${tidewater}/inspect`).use(as(other)).send({ stage: 'form', verdict: 'accept' })).status).toBe(404);
    // A filing the law refuses as invalid settles as an error receipt carrying the law's words.
    expect(await act('outsider', { type: 'company/hand-on', company: tidewater, stage: 'survey', artifact: 'x' }, other.address))
      .toMatchObject({ status: 'error', error: `"${tidewater}" is not a company of this house — your briefing names each one by its [id]` });
    expect(await companyLineBriefing(conn('outsider', other.address))).toBe('');
  });

  test('two racing moves for one step: exactly one lands', async () => {
    const company = makeCompany({ name: 'Race', mode: 'house', openedBy: 'operator', now: new Date().toISOString() });
    await openCompany(me.address, company);
    const event = { type: 'handed', stage: 'survey', by: 'spec', artifact: 'a', note: null, inspections: ['Numerarius'], at: new Date().toISOString() };
    const results = await Promise.all([appendLineEvent(me.address, company.id, event), appendLineEvent(me.address, company.id, event)]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
  });

  test('a seat\'s office outranks its founding title', async () => {
    await cloDesignation.designate(me.address, 'arch');
    expect((await seatHolders(me.address)).Praetor).toBe('arch');
  });
});
