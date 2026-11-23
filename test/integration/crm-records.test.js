/**
 * THE OPERATOR'S OWN RECORD OF PEOPLE (leads/lead-record.js, crm-fields.js, crm-search.js, routes/crm-routes.js) —
 * docs/work/crm-match-blob.md slice 2, 2026-11-23 (Blob: tags, unlimited custom fields, duplicate merge, global
 * search). Tags, the house's own fields judged by their type, a note on top, two leads that are one person made one
 * with both histories, and one search across people, deals, invoices and companies. Real stores on a temp realm,
 * the real router over HTTP (RULE 0).
 */
import { describe, test, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { leadLedgerFor, formatLeadsForBeing } from '../../backend/services/leads/lead-ledger.js';
import { cleanTags, fieldsRefusals, fieldValue, recordChange, mergeLeads } from '../../backend/services/leads/lead-record.js';
import { searchRecords } from '../../backend/services/leads/crm-search.js';
import { openDeal } from '../../backend/services/revenue/deal-store.js';
import { makeDeal } from '../../backend/services/revenue/deal-shape.js';
import crmRouter from '../../backend/routes/crm-routes.js';

const DEFS = [
  { id: 'budget', label: 'Budget', type: 'number' },
  { id: 'renewal', label: 'Renewal', type: 'date' },
  { id: 'tier', label: 'Tier', type: 'choice', choices: ['Gold', 'Silver'] },
  { id: 'referrer', label: 'Referred by', type: 'text' },
];

describe('the rules of a record (pure)', () => {
  test('tags: trimmed, one spelling each, no commas, at most twenty', () => {
    expect(cleanTags(' vip, Partner ,vip,  ,VIP ')).toEqual(['vip', 'Partner']);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20);
  });

  test('fields: a list with ids, labels and a known type; choices for a list', () => {
    expect(fieldsRefusals(DEFS)).toEqual([]);
    expect(fieldsRefusals([{ id: 'Bad Id', label: '', type: 'colour' }, { id: 'tier', label: 'Tier', type: 'choice', choices: [] }])).toEqual([
      'field 1: its id is lowercase letters, digits and dashes, starting with a letter', 'field 1: a label of at most 60 characters',
      'field 1: its type is one of text, number, date, choice', 'field 2: a choice field lists 1 to 30 choices']);
  });

  test('a value is judged by its field; empty clears it', () => {
    expect(fieldValue(DEFS[0], '12,500')).toEqual({ ok: true, value: 12500 });
    expect(fieldValue(DEFS[0], 'lots')).toEqual({ ok: false, why: 'Budget is a number' });
    expect(fieldValue(DEFS[1], '2027-02-28')).toEqual({ ok: true, value: '2027-02-28' });
    expect(fieldValue(DEFS[1], '2027-02-30')).toEqual({ ok: false, why: 'Renewal is a date, YYYY-MM-DD' });
    expect(fieldValue(DEFS[1], 'next spring')).toEqual({ ok: false, why: 'Renewal is a date, YYYY-MM-DD' });
    expect(fieldValue(DEFS[2], 'Bronze')).toEqual({ ok: false, why: 'Tier is one of: Gold, Silver' });
    expect(fieldValue(DEFS[3], '')).toEqual({ ok: true, value: null });
  });

  test('a change sets only what is named, and a field the house does not have is refused', () => {
    const lead = { tags: ['vip'], fields: { budget: 100 }, about: '' };
    expect(recordChange(lead, { fields: { budget: '100', tier: 'Gold' } }, DEFS)).toEqual({ ok: true, set: { fields: { budget: 100, tier: 'Gold' } }, touch: { fields: { tier: 'Gold' } } });
    expect(recordChange(lead, { tags: 'vip' }, DEFS)).toEqual({ ok: true, set: {}, touch: {} });
    expect(recordChange(lead, { fields: { colour: 'red' } }, DEFS)).toEqual({ ok: false, why: '"colour" is not one of the house\'s fields' });
  });

  test('a merge keeps the first lead, both histories in time order, the other address as a former contact', () => {
    const keep = { id: 'a', name: 'Ana', contact: 'ana@x.example', status: 'replied', tags: ['vip'], fields: { budget: 5 }, touches: [{ at: '2026-11-01', note: 'one' }, { at: '2026-11-05', note: 'three' }] };
    const drop = { id: 'b', name: 'Ana Ruiz', contact: 'ana.ruiz@x.example', status: 'cold', tags: ['partner'], fields: { budget: 9, tier: 'Gold' }, about: 'met at the fair', touches: [{ at: '2026-11-03', note: 'two' }] };
    const merged = mergeLeads(keep, drop, { by: 'op', at: '2026-11-23' });
    expect(merged).toMatchObject({ id: 'a', status: 'replied', tags: ['vip', 'partner'], fields: { budget: 5, tier: 'Gold' }, about: 'met at the fair' });
    expect(merged.touches.map((t) => t.note)).toEqual(['one', 'two', 'three', 'merged with lead b (Ana Ruiz): one person']);
    expect(merged.touches[1].mergedFrom).toBe('b');
    expect(merged.touches.at(-1).contactFrom).toBe('ana.ruiz@x.example');
  });

  test('search: every word must be in the record; a name that matches comes first', () => {
    const people = [{ id: '1', name: 'Bo', contact: 'bo@y.example', tags: ['gold coast'], touches: [] }, { id: '2', name: 'Gold Lee', contact: 'lee@y.example', touches: [] }];
    expect(searchRecords({ people }, 'gold').hits.map((h) => h.id)).toEqual(['2', '1']);
    expect(searchRecords({ people }, 'gold coast').hits.map((h) => h.id)).toEqual(['1']);
    expect(searchRecords({ people }, '   ').hits).toEqual([]);
  });
});

describe('the record through the real stores and the router', () => {
  let me; let app; let auth; let ana; let anaAgain;
  beforeAll(async () => {
    useTempRealm();
    me = await fullAuth();
    auth = { authorization: `Bearer ${me.token}` };
    app = express();
    app.use(express.json());
    app.use('/api/v1/crm', crmRouter);
    const ledger = await leadLedgerFor(me.address);
    ana = await ledger.add({ name: 'Ana Ruiz', contact: 'ana@studio.example', channelId: 'email', kind: 'buyer', addedBy: 'merc' });
    anaAgain = await ledger.add({ name: 'Ana R.', contact: 'ana.r@studio.example', channelId: 'email', kind: 'buyer', note: 'wrote from her other address', addedBy: 'operator' });
    await openDeal(me.address, makeDeal({ companyId: 'acme', buyer: 'Studio Ruiz', value: { amount: 4000, currency: 'USD' }, spin: { problem: 'their launch slips every month', needPayoff: 'shipping on time is worth a client' }, nextStep: 'send the proposal', openedBy: 'operator', now: new Date().toISOString() }));
  });

  test('the house sets its fields; a bad list is refused with why', async () => {
    expect((await request(app).put('/api/v1/crm/fields').set(auth).send({ fields: [{ id: 'x', label: 'X', type: 'colour' }] })).status).toBe(400);
    const set = await request(app).put('/api/v1/crm/fields').set(auth).send({ fields: DEFS });
    expect(set.status).toBe(200);
    expect((await request(app).get('/api/v1/crm/fields').set(auth)).body.fields.map((f) => f.id)).toEqual(['budget', 'renewal', 'tier', 'referrer']);
  });

  test('a person\'s record: tags, fields judged, a note — one touch, by the operator\'s wallet; members read it', async () => {
    const bad = await request(app).put(`/api/v1/crm/leads/${ana.id}`).set(auth).send({ fields: { tier: 'Bronze' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Tier is one of: Gold, Silver');
    const r = await request(app).put(`/api/v1/crm/leads/${ana.id}`).set(auth).send({ tags: 'vip, design', fields: { budget: '12,000', tier: 'Gold' }, about: 'Decides with her partner' });
    expect(r.status).toBe(200);
    expect(r.body.lead).toMatchObject({ tags: ['vip', 'design'], fields: { budget: 12000, tier: 'Gold' }, about: 'Decides with her partner' });
    expect(r.body.lead.touches.at(-1)).toMatchObject({ by: me.address, tags: ['vip', 'design'], fields: { budget: 12000, tier: 'Gold' }, about: 'Decides with her partner' });
    const leads = await (await leadLedgerFor(me.address)).load();
    expect(formatLeadsForBeing(leads)).toContain('tags: vip, design · budget: 12000 · tier: Gold · note: Decides with her partner');
    expect((await request(app).put('/api/v1/crm/leads/nope').set(auth).send({ tags: 'x' })).status).toBe(404);
  });

  test('one search finds a person by a tag or a field, and a deal by its buyer', async () => {
    const byTag = (await request(app).get('/api/v1/crm/search?q=vip').set(auth)).body;
    expect(byTag.hits.map((h) => [h.kind, h.id])).toEqual([['person', ana.id]]);
    expect((await request(app).get('/api/v1/crm/search?q=gold%20ruiz').set(auth)).body.hits.map((h) => h.id)).toEqual([ana.id]);
    const byDeal = (await request(app).get('/api/v1/crm/search?q=studio').set(auth)).body.hits;
    expect(byDeal.map((h) => h.kind).sort()).toEqual(['deal', 'person', 'person']);
    expect(byDeal.find((h) => h.kind === 'deal')).toMatchObject({ name: 'Studio Ruiz', sub: expect.stringMatching(/4000 USD/) });
  });

  test('two leads that are one person become one; the other leaves a tombstone that says where it went', async () => {
    const r = await request(app).post(`/api/v1/crm/leads/${ana.id}/merge`).set(auth).send({ from: anaAgain.id });
    expect(r.status).toBe(200);
    const ledger = await leadLedgerFor(me.address);
    const leads = await ledger.load();
    expect(leads.map((l) => l.id)).toEqual([ana.id]);
    expect(leads[0].touches.some((t) => t.mergedFrom === anaAgain.id && t.note === 'wrote from her other address')).toBe(true);
    expect(leads[0].touches.at(-1)).toMatchObject({ mergedFrom: anaAgain.id, contactFrom: 'ana.r@studio.example', by: me.address });
    expect((await ledger.removed()).at(-1)).toMatchObject({ id: anaAgain.id, why: `merged into ${ana.id}` });
    expect((await request(app).post(`/api/v1/crm/leads/${ana.id}/merge`).set(auth).send({ from: ana.id })).status).toBe(400);
  });
});
