/**
 * THE NEVER-LIST (legal/never-list.js, sales/never-countries.js) — Design note, 2026-11-22: […]
 *
 * A real house on tmp disk, its real routes, stores and seats (RULE 0). Under proof: a house with no list of its own
 * stands on the baseline, said to be unreviewed; the legal seat proposes a list and nothing changes until the operator
 * approves it; the operator adds a place by their own rule; the sales office reads that ONE record — a company in a
 * listed place is refused as a lead and at the first-email screen, while one whose country is simply not known is
 * NOT held; and the legal watch files a matter for the unreviewed list and for a lead that stands in a listed place.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { fileSegment, setSegmentState, addProspects, listScreened, readProspects, readSegments } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { firstEmailScreen } from '../../backend/services/sales/lead-screen.js';
import { neverSign, placeName } from '../../backend/services/sales/never-countries.js';
import { readNeverList, makeNeverList, BASELINE, neverListWords } from '../../backend/services/legal/never-list.js';
import { commerceFindings } from '../../backend/services/legal/commerce-review.js';
import { cloDesignation } from '../../backend/services/legal/clo-designation.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { legalIntents } from '../../backend/services/intents/legal-acts.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const HIS = ['IL', 'IR', 'KP', 'SY', 'CU', 'RU', 'BY', 'XO'];

describe('the signs that a company is in a place its house never writes to (pure)', () => {
  test('its domain, the address, a city, a phone code, its own words placing it there, its record — never a bare mention', () => {
    expect(neverSign({ domain: 'fund.co.il' }, HIS)).toEqual({ code: 'IL', name: 'Israel', why: 'its own domain fund.co.il is Israel\'s' });
    expect(neverSign({ domain: 'x.io', emails: ['ivan@corp.ru'] }, HIS).why).toBe('the address ivan@corp.ru is at a domain of Russia');
    expect(neverSign({ domain: 'fund.vc', text: 'Offices\nNew York\nTel Aviv' }, HIS).why).toBe('its own pages place it in Israel ("Tel Aviv")');
    expect(neverSign({ domain: 'fund.vc', text: 'Call us: +972 3 555 0100' }, HIS).code).toBe('IL');
    expect(neverSign({ domain: 'fund.vc', text: 'We are an Israeli venture fund backing founders.' }, HIS).code).toBe('IL');
    expect(neverSign({ domain: 'fund.vc', text: 'Headquartered in Minsk, Belarus.' }, HIS).code).toBe('BY');
    expect(neverSign({ domain: 'fund.vc', text: '12 Valiasr Street, Iran' }, HIS).code).toBe('IR');
    expect(neverSign({ domain: 'x.io', country: 'il' }, HIS).why).toBe('it is on record in Israel');
    expect(neverSign({ domain: 'fund.vc', text: 'Simferopol office' }, HIS).name).toBe('an occupied region of Ukraine (Crimea, Donetsk, Luhansk)');
    // A mention places nobody: a portfolio company, a market, a US number that happens to hold the digits.
    expect(neverSign({ domain: 'fund.vc', text: 'We backed an Israeli startup and a team from Russia. Markets: Israel, Iran. Call +1 850 555 1212.' }, HIS)).toBeNull();
    expect(neverSign({ domain: 'fund.io', emails: ['a@fund.io'], text: 'We invest in crypto.' }, HIS)).toBeNull();
    // Whose list it is decides: the same company under another house's list.
    expect(neverSign({ domain: 'fund.co.il' }, ['MM'])).toBeNull();
    expect(neverSign({ domain: 'a.com', text: 'Headquartered in Myanmar since 2019.' }, ['MM']).name).toBe('Myanmar (Burma)');
    expect(neverSign({ domain: 'fund.co.il' }, [])).toBeNull();
    expect([placeName('KP'), placeName('XO')]).toEqual(['North Korea', 'an occupied region of Ukraine (Crimea, Donetsk, Luhansk)']);
  });

  test('a list is kept whole or refused, each fault named', () => {
    expect(() => makeNeverList({ home: 'USA', countries: [{ code: 'ZZ', why: 'x' }, { code: 'IR', why: '' }, { code: 'KP', why: 'Comprehensive sanctions', source: 'ofac' }] }))
      .toThrow(/countries\[0\]\.code: a two-letter ISO country code.*countries\[1\]\.why: the law or the rule that puts Iran on the list.*countries\[2\]\.source: the https page/);
    expect(makeNeverList({ home: 'th', countries: [{ code: 'il', why: 'The operator\'s own rule' }, { code: 'IL', why: 'again, the same place' }] })).toEqual({ home: 'TH', countries: [{ code: 'IL', name: 'Israel', why: 'The operator\'s own rule' }] });
  });
});

describe('one record, kept by the legal office and read by the sales office', () => {
  let me, app, segment;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const api = '/api/v1/revenue/lead-engine';
  const connection = (lane) => ({ walletAddress: me.address, companion: { neumaId: lane, name: lane } });
  const act = async (intents, lane, name, payload) => {
    const intent = intents.find((i) => i.name === name);
    const checked = await intent.validate(payload, { connection: connection(lane) });
    if (!checked.ok) return { ok: false, reason: checked.reason };
    return intent.execute(checked.value, { connection: connection(lane), emit: () => {} });
  };
  const company = (domain, over = {}) => ({ domain, name: domain.split('.')[0], country: 'US', source: `https://${domain}/`, scores: [{ criterion: 'Active crypto fund', score: 5, reasoning: 'its own page says it invests in crypto' }], ...over });
  const fileLead = async (domain, email, over) => {
    const now = new Date().toISOString();
    const { added } = await addProspects(me.address, [makeProspect({ ...company(domain, over), segment, by: 'merc', now })]);
    await listScreened(me.address, segment.id, [added[0].id], 'lead-run:merc');
    return { id: added[0].id, put: await act(salesIntents, 'merc', 'sales/lead', { id: added[0].id, person: { name: 'Ada Lovelace', role: 'Partner' }, email, emailSource: `https://${domain}/team` }) };
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'never-list-test-key';
    useTempRealm();
    const tmp = await createTempDir('never-list');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    for (const lane of ['merc', 'praetor']) {
      await workspace.create(lane);
      await fs.writeFile(path.join(tmp, 'workspaces', lane, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(tmp, 'workspaces', lane, 'identity'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'workspaces', lane, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${(lane === 'merc' ? 'c' : 'd').repeat(40)}` }));
    }
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    await cloDesignation.designate(me.address, 'praetor');
    // An audience whose own countries would ALLOW Israel, Iran and Russia: only the never-list holds a company there.
    segment = makeSegment({ name: 'Crypto funds', offer: 'A stake in what we are building', company: 'ignis', customerProblem: 'They look for the next thing to back', targetRole: 'Partner', targetGeography: 'Anywhere we may write to', countries: ['US', 'IL', 'IR', 'RU'], positiveCriteria: ['Active crypto fund'], why: 'They invest in this', by: 'merc', now: new Date().toISOString() });
    await fileSegment(me.address, segment);
    await setSegmentState(me.address, segment.id, 'approved', 'operator');
    segment = (await readSegments(me.address)).find((sg) => sg.id === segment.id);
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a house that has said nothing stands on the baseline, and is told nobody reviewed it', async () => {
    expect((await request(app).get(`${api}/never-list`)).status).toBe(401);
    const list = (await request(app).get(`${api}/never-list`).use(as)).body;
    expect(list).toMatchObject({ reviewed: false, codes: ['IR', 'KP', 'SY', 'CU', 'XO'], home: null, proposed: null });
    expect(list.countries).toEqual(BASELINE.map((c) => ({ ...c })));
    expect(neverListWords(list)).toMatch(/^NO NEVER-LIST OF THIS HOUSE'S OWN STANDS YET — the baseline is in force/);
    // Under the baseline: Iran is refused, Israel is not on anyone's list yet.
    expect((await fileLead('tehranfund.ir', 'ada@tehranfund.ir', { country: undefined })).put).toEqual({ ok: false, reason: 'tehranfund is never written to: its own domain tehranfund.ir is Iran\'s — Iran is on this house\'s never-list, kept by its legal office, for every campaign' });
  });

  test('the legal seat proposes the list for where its operator is; nothing changes until the operator approves; the operator adds a place by their own rule', async () => {
    const src = 'https://ofac.treasury.gov/sanctions-programs-and-country-information';
    expect(await act(legalIntents, 'merc', 'legal/never-list', {})).toMatchObject({ ok: false, reason: 'legal acts belong to the seated CLO alone' });
    expect((await act(legalIntents, 'praetor', 'legal/never-list', {})).detail).toMatch(/^NO NEVER-LIST OF THIS HOUSE'S OWN STANDS YET/);
    expect((await act(legalIntents, 'praetor', 'legal/never-list', { countries: [{ code: 'IR', why: 'Comprehensive US sanctions', source: src }] })).reason).toMatch(/^home: the two-letter ISO code of the country your operator is in/);
    expect((await act(legalIntents, 'praetor', 'legal/never-list', { home: 'US', countries: [{ code: 'IR', why: 'Comprehensive US sanctions' }] })).reason).toMatch(/each place you propose names its source/);
    const proposed = await act(legalIntents, 'praetor', 'legal/never-list', { home: 'US', countries: ['IR', 'KP', 'SY', 'CU', 'XO', 'RU', 'BY'].map((code) => ({ code, why: code === 'RU' || code === 'BY' ? 'Broad US sanctions and export controls' : 'Comprehensive US sanctions', source: src })) });
    expect(proposed.detail).toMatch(/^Proposed: Iran \[IR\], North Korea \[KP\].*Belarus \[BY\] — worked out for an operator in US\. It WAITS for your operator to approve it/);
    // Proposed is not standing: the sales office still reads the baseline.
    expect(await readNeverList(me.address)).toMatchObject({ reviewed: false, codes: ['IR', 'KP', 'SY', 'CU', 'XO'], proposed: { by: 'praetor', home: 'US' } });
    expect((await request(app).post(`${api}/never-list/review`).use(as).send({ verdict: 'maybe' })).body.error).toBe('verdict: approved or returned');
    const approved = (await request(app).post(`${api}/never-list/review`).use(as).send({ verdict: 'approved' })).body;
    expect(approved).toMatchObject({ reviewed: true, home: 'US', by: 'praetor', codes: ['IR', 'KP', 'SY', 'CU', 'XO', 'RU', 'BY'], proposed: null });
    expect((await request(app).post(`${api}/never-list/review`).use(as).send({ verdict: 'approved' })).body.error).toBe('no never-list waits for you');
    // The operator's own rule: Israel, law or no law. It stands at once, and the legal seat reads it.
    expect((await request(app).put(`${api}/never-list`).use(as).send({ home: 'US', countries: [{ code: 'QQ', why: 'nowhere' }] })).status).toBe(400);
    const mine = (await request(app).put(`${api}/never-list`).use(as).send({ home: 'US', countries: [...approved.countries, { code: 'IL', why: 'The operator\'s own rule' }] })).body;
    expect(mine).toMatchObject({ reviewed: true, by: 'operator', codes: ['IR', 'KP', 'SY', 'CU', 'XO', 'RU', 'BY', 'IL'] });
    expect((await act(legalIntents, 'praetor', 'legal/never-list', {})).detail).toMatch(/^THE HOUSE'S NEVER-LIST \(reviewed \d{4}-\d\d-\d\d, worked out for an operator in United States\): .*Israel \[IL\] — The operator's own rule\.$/);
  });

  test('the sales office reads that one record: a listed place is refused as a lead and at the first email; a country simply not known holds nobody', async () => {
    const never = (await readNeverList(me.address)).codes;
    // Israel is on the list now: by its record, by the address alone, by its domain.
    expect((await fileLead('haifa-capital.example', 'ada@haifa-capital.example', { country: 'IL' })).put.reason).toMatch(/is never written to: it is on record in Israel — Israel is on this house's never-list/);
    expect((await fileLead('globalfund.example', 'ada@globalfund.co.il')).put.reason).toMatch(/the address ada@globalfund\.co\.il is at a domain of Israel/);
    // Not known is not a place: the lead is filed and may be written to.
    const open = await fileLead('quietfund.example', 'ada@quietfund.example', { country: undefined });
    expect(open.put, JSON.stringify(open.put)).toMatchObject({ ok: true, detail: expect.stringMatching(/Its country is not on its pages, and nothing places it anywhere the house never writes to: write as for any lead/) });
    const lead = (await (await leadLedgerFor(me.address)).load()).find((l) => l.contact === 'ada@quietfund.example');
    const prospect = (await readProspects(me.address)).find((p) => p.id === open.id);
    expect(firstEmailScreen({ lead, prospect, segment, never })).toBeNull();
    // The same lead, were its company's record to say Israel, or a house whose list holds where it is.
    expect(firstEmailScreen({ lead, prospect: { ...prospect, country: 'IL' }, segment, never })).toMatch(/^quietfund is never written to: it is on record in Israel/);
    expect(firstEmailScreen({ lead: { ...lead, contact: 'ada@quietfund.ru' }, prospect, segment, never })).toMatch(/the address ada@quietfund\.ru is at a domain of Russia/);
    // An audience's own countries still stand beside it, for a country that IS known.
    expect(firstEmailScreen({ lead, prospect: { ...prospect, country: 'IN' }, segment: { ...segment, countries: ['US'] }, never })).toBe('quietfund is in IN, and "Crypto funds" may only be sent to US — it is not written to for it');
    expect(firstEmailScreen({ lead, prospect, segment: { ...segment, countries: ['US'] }, never })).toBeNull();
  });

  test('the legal watch keeps the two in step: a matter for a house on the baseline, and for a lead that stands in a listed place', async () => {
    const base = { companies: [], deals: [], invoices: [], raises: [], receipts: [], replies: [], payTo: null, sanctions: null, nowMs: Date.now() };
    const unreviewed = commerceFindings({ ...base, never: { reviewed: false, codes: BASELINE.map((c) => c.code), countries: BASELINE }, leads: [{ id: 'l-0', name: 'Ada at Quiet', email: 'ada@quietfund.example', country: null, domain: 'quietfund.example' }] });
    expect(commerceFindings({ ...base, never: { reviewed: false, codes: [], countries: BASELINE }, leads: [] })).toEqual([]);
    expect(unreviewed).toEqual([expect.objectContaining({ externalId: 'never-list-unreviewed', severity: 'medium', title: 'The house has no never-list of its own: only the baseline stands', summary: expect.stringMatching(/propose it: legal\/never-list \{home, countries/) })]);
    const never = await readNeverList(me.address);
    const found = commerceFindings({ ...base, never, leads: [{ id: 'l-1', name: 'Ada at Quiet', email: 'ada@quietfund.example', country: null, domain: 'quietfund.example' }, { id: 'l-2', name: 'Lev at Old Fund', email: 'lev@oldfund.example', country: 'RU', domain: 'oldfund.example' }] });
    expect(found).toEqual([expect.objectContaining({ externalId: 'never-lead:l-2', severity: 'critical', title: 'A lead stands in a place on the never-list: Lev at Old Fund (Russia)' })]);
  });
});
