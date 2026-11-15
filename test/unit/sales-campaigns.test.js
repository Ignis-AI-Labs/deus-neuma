/**
 * SALES CAMPAIGNS — the shape, the fold and the counting (pure; the numbers
 * are counted from the same records the lead engine keeps, never beside them),
 * and how the CAMPAIGNS tab words them.
 */
import { describe, test, expect } from 'vitest';
import { makeCampaign, foldCampaigns, openRefusal, judgeMove, campaignBoard, campaignLine } from '../../backend/services/sales/campaign-shape.js';
import { makeSegment, foldSegments } from '../../backend/services/sales/segment-shape.js';
import { funnelOf, channelWords } from '../../frontend/app/RelinkShell/company-line/sales-campaign-view.js';

const NOW = '2026-11-15T09:00:00.000Z';
const base = { name: 'Base token teams', company: 'umbrae', offer: 'A pool on a venue whose fees go to whoever supplies it', customerProblem: 'Their liquidity sits in one pool', targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Has a token on Base'], why: 'A second venue with a better split', by: 'merc', now: NOW };

describe('a sales campaign', () => {
  test('needs a name, its company and what it is meant to bring in — every gap named at once', () => {
    expect(() => makeCampaign({ name: 'x', company: '', goal: 'short', by: 'operator', now: NOW })).toThrow(/name: what this campaign is called; company: the house company this campaign is for; goal: what this campaign is meant to bring in/);
    const c = makeCampaign({ name: ' User  acquisition ', company: 'Umbrae', goal: 'Teams with a token on Base opening a pool', by: 'operator', now: NOW });
    expect(c).toMatchObject({ name: 'User acquisition', company: 'umbrae', openedBy: 'operator' });
    expect(c.id).toMatch(/^k-[a-f0-9]{8}$/);
  });

  test('opens, closes, and one open campaign holds a name', () => {
    const a = makeCampaign({ name: 'Funding', company: 'umbrae', goal: 'Funds that back DeFi on Base', by: 'operator', now: NOW });
    const events = [{ type: 'opened', campaign: a, at: NOW }];
    expect(foldCampaigns(events)[0]).toMatchObject({ name: 'Funding', state: 'open' });
    expect(openRefusal({ name: 'FUNDING' }, foldCampaigns(events))).toBe('a campaign named "FUNDING" is already open');
    const closed = foldCampaigns([...events, { type: 'closed', id: a.id, by: 'operator', at: NOW }, { type: 'closed', id: 'k-nope', at: NOW }]);
    expect(closed).toMatchObject([{ state: 'closed', closedAt: NOW }]);
    expect(openRefusal({ name: 'Funding' }, closed)).toBe(null);
  });

  test('a campaign is archived, reopened, edited, and deleted only when no audience serves it', () => {
    const c = { id: 'k-1', name: 'Funding', company: 'umbrae', goal: 'Funds that back DeFi on Base', state: 'open' };
    const m = (move, extra = {}) => judgeMove(extra.campaign ?? c, { move, audiences: 0, others: [], by: 'merc', now: NOW, ...extra });
    expect(m('archive')).toEqual({ ok: true, event: { type: 'closed', id: 'k-1', by: 'merc', at: NOW } });
    expect(m('archive', { campaign: { ...c, state: 'closed' } })).toEqual({ ok: false, reason: 'the campaign is already archived' });
    expect(m('reopen', { campaign: { ...c, state: 'closed' } }).event.type).toBe('reopened');
    expect(m('reopen', { campaign: { ...c, state: 'closed' }, others: [{ name: 'funding', state: 'open' }] }).reason).toMatch(/already open/);
    expect(m('edit', { name: ' Seed  round ', goal: '' }).event).toEqual({ type: 'updated', id: 'k-1', by: 'merc', at: NOW, name: 'Seed round' });
    expect(m('edit', {}).reason).toBe('edit names a new name, a new goal, or both');
    expect(m('edit', { goal: 'short' }).reason).toMatch(/^goal:/);
    expect(m('delete', { audiences: 2 }).reason).toMatch(/2 audience\(s\) still serve this campaign — move them to another campaign or archive it instead/);
    expect(m('delete').event.type).toBe('deleted');
    expect(m('explode').reason).toBe('move is one of archive, reopen, delete, edit');
    expect(judgeMove(undefined, { move: 'archive' }).reason).toBe('no such campaign');
    // The log folds them: edited, archived, reopened, then gone.
    const opened = { type: 'opened', campaign: c, at: NOW };
    expect(foldCampaigns([opened, m('edit', { name: 'Seed round' }).event, m('archive').event])[0]).toMatchObject({ name: 'Seed round', state: 'closed' });
    expect(foldCampaigns([opened, m('archive').event, { type: 'reopened', id: 'k-1' }])[0].state).toBe('open');
    expect(foldCampaigns([opened, m('delete').event])).toEqual([]);
  });

  test('an audience serves one campaign; moving it never sends an approved pitch back for approval; refiling keeps it', () => {
    const seg = makeSegment({ ...base, id: 's-1', campaign: 'k-1' });
    expect(seg.campaign).toBe('k-1');
    const events = [{ type: 'filed', segment: seg, at: NOW }, { type: 'state', id: 's-1', state: 'approved', by: 'operator', at: NOW }, { type: 'campaign', id: 's-1', campaign: 'k-2', by: 'operator', at: NOW }];
    expect(foldSegments(events)[0]).toMatchObject({ state: 'approved', campaign: 'k-2' });
    const refiled = makeSegment({ ...base, id: 's-1', why: 'Said more plainly, the same audience' });
    expect(foldSegments([...events, { type: 'filed', segment: refiled, at: NOW }])[0]).toMatchObject({ state: 'approved', campaign: 'k-2' });
    expect(foldSegments([...events, { type: 'campaign', id: 's-1', campaign: null, at: NOW }])[0].campaign).toBe(null);
  });
});

describe('the numbers are counted, by campaign and by channel', () => {
  const campaigns = [{ id: 'k-users', name: 'User acquisition', company: 'umbrae', goal: 'Pools opened', state: 'open' }, { id: 'k-fund', name: 'Funding', company: 'umbrae', goal: 'Funds', state: 'open' }];
  const segments = [{ id: 's-1', name: 'Base token teams', company: 'umbrae', campaign: 'k-users', state: 'approved' }, { id: 's-2', name: 'Stray', company: 'umbrae', campaign: null, state: 'draft' }, { id: 's-3', name: 'Gone', company: 'umbrae', campaign: 'k-users', state: 'retired' }];
  const candidates = [{ segmentId: 's-1' }, { segmentId: 's-1' }, { segmentId: 's-1' }, { segmentId: 's-2' }];
  const prospects = [{ segmentId: 's-1', leadId: 'l-1' }, { segmentId: 's-1', leadId: 'l-2' }, { segmentId: 's-1', leadId: 'l-3' }, { segmentId: 's-1', leadId: null }, { segmentId: 's-2', leadId: 'l-9' }];
  const leads = [
    { id: 'l-1', channelId: 'email', status: 'won', touches: [{ direction: 'out' }, { direction: 'in' }] },
    { id: 'l-2', channelId: 'email', status: 'contacted', touches: [{ direction: 'out' }] },
    { id: 'l-3', channelId: 'x', status: 'lost', touches: [{ direction: 'out' }, { direction: 'in' }] },
    { id: 'l-9', channelId: 'email', status: 'cold', touches: [] },
  ];

  test('each campaign counts only its own audiences, from gathered to won; an audience under none is named', () => {
    const { campaigns: board, loose } = campaignBoard({ campaigns, segments, candidates, prospects, leads });
    expect(board[0]).toMatchObject({ name: 'User acquisition', gathered: 3, scored: 4, leads: 3, written: 3, replied: 2, qualified: 1, won: 1, lost: 1 });
    expect(board[0].audiences).toEqual([{ id: 's-1', name: 'Base token teams', state: 'approved' }]);
    expect(board[0].channels).toEqual([
      { channel: 'email', leads: 2, written: 2, replied: 1, qualified: 1, won: 1, lost: 0 },
      { channel: 'x', leads: 1, written: 1, replied: 1, qualified: 0, won: 0, lost: 1 },
    ]);
    expect(board[1]).toMatchObject({ name: 'Funding', gathered: 0, scored: 0, leads: 0, audiences: [], channels: [] });
    expect(loose).toEqual([{ id: 's-2', name: 'Stray', company: 'umbrae' }]);
    expect(campaignLine(board[0])).toBe('- [k-users] User acquisition (for umbrae, open) — goal: Pools opened — 1 audience(s), 3 gathered, 4 scored, 3 on the lead list, 3 written, 2 replied, 1 qualified, 1 won, 1 lost');
  });

  test('the tab words exactly those counts, in order; WON reads loud only when there is one', () => {
    const [users, fund] = campaignBoard({ campaigns, segments, candidates, prospects, leads }).campaigns;
    expect(funnelOf(users).map((s) => [s.label, s.n])).toEqual([['GATHERED', 3], ['SCORED', 4], ['LEADS', 3], ['WRITTEN', 3], ['REPLIED', 2], ['QUALIFIED', 1], ['WON', 1]]);
    expect(funnelOf(users).at(-1).loud).toBe(true);
    expect(funnelOf(fund).at(-1).loud).toBe(false);
    expect(channelWords(users.channels[0])).toBe('EMAIL — 2 LEADS · 2 WRITTEN · 1 REPLIED · 1 QUALIFIED · 1 WON · 0 LOST');
    expect(channelWords(users.channels[1])).toBe('X — 1 LEAD · 1 WRITTEN · 1 REPLIED · 0 QUALIFIED · 0 WON · 1 LOST');
  });
});
