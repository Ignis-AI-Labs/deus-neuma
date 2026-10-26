/**
 * The campaign editor's draft ⇄ record (campaign-form.js). Pure: real
 * records in, real bodies out.
 */
import { describe, it, expect } from 'vitest';
import { draftOf, bodyOf, textToAngles, anglesToText, runsOn } from '../../frontend/app/RelinkShell/campaigns/campaign-form.js';

const RECORD = Object.freeze({
  id: 'c1', name: 'Launch', companyId: 'northwind', status: 'active',
  goal: { kind: 'downloads', label: 'installs' }, kpi: { metric: 'conversions', target: 500, by: '2026-11-15' },
  window: { start: '2026-10-25', end: '2026-11-15' }, budget: { hours: 10, money: null, note: '' },
  angles: [{ id: 'proof', name: 'proof', thesis: 'only the harness changed', audience: 'developers' }, { id: 'speed', name: 'speed', thesis: '', audience: '' }],
  subs: [{ accountId: 'x-1', role: 'lead', cadence: '1/day', angleIds: ['proof', 'speed'] }],
  cadence: '', marketingPlan: 'plan', funnelPlan: '', notes: '',
});

describe('campaign-form', () => {
  it('a record survives the round trip draft → body unchanged', () => {
    const body = bodyOf(draftOf(RECORD), RECORD);
    expect(body).toMatchObject({
      name: 'Launch', companyId: 'northwind', status: 'active', goal: RECORD.goal, kpi: RECORD.kpi, window: RECORD.window,
      budget: { hours: 10, money: null, note: '' }, angles: RECORD.angles, subs: RECORD.subs, marketingPlan: 'plan',
    });
  });

  it('angle lines keep the ids of names that stand; a removed angle leaves the sub', () => {
    expect(anglesToText(RECORD.angles)).toBe('proof | only the harness changed | developers\nspeed');
    expect(textToAngles('proof | new thesis\n\nreach', RECORD.angles)).toEqual([
      { id: 'proof', name: 'proof', thesis: 'new thesis', audience: '' },
      { name: 'reach', thesis: '', audience: '' },
    ]);
    const draft = { ...draftOf(RECORD), angles: 'proof' };
    expect(bodyOf(draft, RECORD).subs[0].angleIds).toEqual(['proof']);
  });

  it('blank parts clear: no goal, no KPI, no window, no budget', () => {
    const body = bodyOf(draftOf(null, { companyId: 'northwind' }));
    expect(body).toMatchObject({ companyId: 'northwind', status: 'draft', goal: null, kpi: null, window: null, budget: null, angles: [], subs: [] });
  });

  it('a campaign runs on a platform when a sub names one of its accounts', () => {
    expect(runsOn(RECORD, 'x')).toBe(true);
    expect(runsOn(RECORD, 'tiktok')).toBe(false);
  });
});
