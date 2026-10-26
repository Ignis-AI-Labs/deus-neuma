/**
 * Campaign shape v2 — the pure law (campaign-shape.js), the first-shape move
 * (campaign-upgrade.js) and the shared page's asks and log (campaign-asks.js).
 * Pure functions, real inputs, real outputs: no mock anywhere.
 */
import { describe, it, expect } from 'vitest';
import { campaignRefusal, settleAngles, changeWords, shapeCampaign } from '../../backend/services/marketing/campaign-shape.js';
import { upgradeCampaign, companyForBrand } from '../../backend/services/marketing/campaign-upgrade.js';
import { openAsk, settleAsk, asksOwedBy, withLogLine, LOG_MAX } from '../../backend/services/marketing/campaign-asks.js';

const COMPANIES = [{ id: 'northwind' }, { id: 'brookmere' }];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'northwind' },
  { id: 'x-2', channelId: 'x', companyId: 'brookmere' },
  { id: 'tiktok-1', channelId: 'tiktok', companyId: null },
];
const CTX = { companies: COMPANIES, accounts: ACCOUNTS };
const GOOD = Object.freeze({ name: 'Launch Week', companyId: 'northwind' });

describe('campaign shape v2 — what a campaign may declare', () => {
  it('a full declaration passes: goal, KPI target, window, budget, angles, a sub', () => {
    expect(campaignRefusal({
      ...GOOD,
      status: 'draft',
      goal: { kind: 'downloads', label: 'Linux installs' },
      kpi: { metric: 'conversions', target: 1000, by: '2026-11-15' },
      window: { start: '2026-10-25', end: '2026-11-15' },
      budget: { hours: 20, money: 0, note: 'planning only' },
      angles: [{ name: 'proof', thesis: 'only the harness changed', audience: 'developers' }],
      subs: [{ account: 'x-1', cadence: '1/day', angles: ['proof'] }],
    }, CTX)).toBeNull();
  });

  it('a sub on ANOTHER company\'s account is refused, in words naming both companies', () => {
    expect(campaignRefusal({ ...GOOD, subs: [{ account: 'x-2' }] }, CTX))
      .toBe('account x-2 belongs to brookmere, not northwind — a campaign runs only on its own company\'s accounts');
    expect(campaignRefusal({ ...GOOD, subs: [{ account: 'tiktok-1' }] }, CTX)).toMatch(/has no company yet/);
    expect(campaignRefusal({ ...GOOD, subs: [{ account: 'x-9' }] }, CTX)).toBe('there is no account x-9 in this house');
    expect(campaignRefusal({ ...GOOD, subs: [{ account: 'x-1' }, { account: 'x-1' }] }, CTX)).toMatch(/one sub per account/);
  });

  it('a company not of this house, an old single-platform field, a bad KPI or window are refused', () => {
    expect(campaignRefusal({ ...GOOD, companyId: 'ghost' }, CTX)).toMatch(/no "ghost" company in this house/);
    expect(campaignRefusal({ ...GOOD, channelId: 'x' }, CTX)).toMatch(/no longer belong to one platform.*x-1/);
    expect(campaignRefusal({ ...GOOD, kpi: { metric: 'clicks', target: 0 } }, CTX)).toMatch(/whole number above zero/);
    expect(campaignRefusal({ ...GOOD, kpi: { metric: 'vibes', target: 3 } }, CTX)).toMatch(/metric one of/);
    expect(campaignRefusal({ ...GOOD, window: { start: '2026-11-02', end: '2026-11-01' } }, CTX)).toBe('the window ends before it starts');
    expect(campaignRefusal({ ...GOOD, goal: { kind: 'custom' } }, CTX)).toMatch(/custom goal needs a label/);
    expect(campaignRefusal({ ...GOOD, budget: { money: -5 } }, CTX)).toMatch(/budget.money/);
    expect(campaignRefusal({ ...GOOD, subs: [{ account: 'x-1', angles: ['nope'] }] }, CTX)).toMatch(/angle "nope"/);
  });

  it('the cadence error still explains itself', () => {
    const err = campaignRefusal({ ...GOOD, cadence: 'x'.repeat(201) }, CTX);
    expect(err).toContain('max 200 chars');
    expect(err).toContain('marketingPlan/notes');
  });

  it('angles keep their ids across edits; a renamed angle keeps its id when named by id', () => {
    const first = settleAngles(['Proof', 'Craft', 'proof again']);
    expect(first.map((a) => a.id)).toEqual(['proof', 'craft', 'proof-again']);
    const again = settleAngles([{ id: 'proof', name: 'Proof of speed' }, 'Craft'], first);
    expect(again.map((a) => a.id)).toEqual(['proof', 'craft']);
    expect(settleAngles(['Proof', 'Proof!']).map((a) => a.id)).toEqual(['proof', 'proof-2']);
  });

  it('pillars are read as angle names (the alias an old caller speaks)', () => {
    const { shaped } = shapeCampaign({ ...GOOD, pillars: ['craft', 'proof'] });
    expect(shaped.angles.map((a) => a.name)).toEqual(['craft', 'proof']);
  });

  it('the change log names what moved', () => {
    expect(changeWords({ status: 'active', name: 'A' }, { status: 'paused', name: 'B' })).toBe('status active → paused; changed name');
    expect(changeWords({ name: 'A' }, { name: 'A' })).toBeNull();
  });
});

describe('the first-shape move — no data loss', () => {
  const v1 = Object.freeze({
    id: 'aaaa1111bbbb2222', name: 'Umbrae on X', brand: 'Northwind', status: 'paused', channelId: 'x',
    pillars: ['craft', 'proof'], cadence: '2/day', marketingPlan: 'plan', funnelPlan: '', notes: 'n',
    sharedFiles: [{ path: '/tmp/brief.md', addedAt: '2026-10-01T00:00:00Z' }],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', someFutureKey: { kept: true },
  });

  it('pillars become angles in order, the platform becomes a sub on its first account, every other key rides', () => {
    const v2 = upgradeCampaign(v1, { companyIds: ['northwind'], at: '2026-10-24T00:00:00Z' });
    expect(v2).toMatchObject({
      v: 2, id: v1.id, name: v1.name, companyId: 'northwind', brand: 'Northwind', status: 'paused',
      cadence: '2/day', marketingPlan: 'plan', notes: 'n', sharedFiles: v1.sharedFiles,
      createdAt: v1.createdAt, updatedAt: v1.updatedAt, someFutureKey: { kept: true },
      subs: [{ accountId: 'x-1', role: '', cadence: '2/day', angleIds: ['craft', 'proof'] }],
      migratedFrom: { v: 1, channelId: 'x', pillars: ['craft', 'proof'] },
    });
    expect(v2.angles.map((a) => a.name)).toEqual(['craft', 'proof']);
    expect(v2).not.toHaveProperty('pillars');
    expect(v2).not.toHaveProperty('channelId');
    expect(v2.log.at(-1).what).toMatch(/2 pillar\(s\) became angles.*sub on x-1.*company northwind/);
    expect(upgradeCampaign(v2)).toBe(v2);
  });

  it('a brand naming no company of the house stands UNSORTED with its brand kept', () => {
    const v2 = upgradeCampaign({ ...v1, brand: 'Elsewhere' }, { companyIds: ['northwind'] });
    expect(v2.companyId).toBeNull();
    expect(v2.brand).toBe('Elsewhere');
    expect(v2.log.at(-1).what).toMatch(/UNSORTED/);
    expect(companyForBrand('NORTHWIND', ['northwind'])).toBe('northwind');
  });
});

describe('the shared page — asks both ways, the change log', () => {
  const at = '2026-10-24T01:00:00Z';
  it('the CMO asks, the operator owes it; the operator answers and the log says so', () => {
    const asked = openAsk({ asks: [], log: [] }, { id: 'ask000000001', from: 'cmo', text: 'Which day is launch?', by: 'cmolane', at }).campaign;
    expect(asksOwedBy(asked, 'operator').map((a) => a.text)).toEqual(['Which day is launch?']);
    expect(asksOwedBy(asked, 'cmo')).toEqual([]);
    const answered = settleAsk(asked, 'ask000', { side: 'operator', by: '0xabc', answer: 'Thursday', at }).campaign;
    expect(answered.asks[0]).toMatchObject({ state: 'done', answer: 'Thursday', doneBy: '0xabc' });
    expect(answered.log.map((l) => l.what)).toEqual(['the CMO asked: Which day is launch?', 'the operator answered the ask: Which day is launch?']);
    expect(settleAsk(answered, 'ask000000001', { side: 'operator', by: '0xabc', at }).error).toBe('that ask is already settled');
    expect(openAsk(asked, { id: 'x', from: 'someone', text: 'hi', at }).error).toMatch(/operator or cmo/);
  });

  it('the log is capped, oldest dropped', () => {
    let log = [];
    for (let i = 0; i < LOG_MAX + 5; i += 1) log = withLogLine(log, { at, by: 'x', what: `line ${i}` });
    expect(log).toHaveLength(LOG_MAX);
    expect(log[0].what).toBe('line 5');
  });
});
