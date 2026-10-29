// SDT-6 (show-dont-tell-audit.md) — the pure laws under the account head, the
// post card's WHEN and LEADS: real inputs, real outputs, no double (RULE 0).
import { describe, it, expect } from 'vitest';
import { keysMark, holderMark, crewMark, SEAT_DOOR } from '../../frontend/app/RelinkShell/account-level/standing-marks.js';
import { cardWhen, aheadOf, relWhen } from '../../frontend/app/RelinkShell/queue-when.js';
import { queueWhenLabel } from '../../frontend/app/RelinkShell/campaigns-helpers.js';
import { funnelOf, leadsAt, stageShare, holderOf, leadMenuItems, leadHandTo, lastTouchOf } from '../../frontend/app/RelinkShell/leads/lead-view.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const X = { id: 'x', name: 'X (Twitter)', configured: true };
const ROSTER = [{ neumaId: 'kestrel', name: 'Kestrel' }, { neumaId: 'vale', name: 'Vale', participantKind: 'witness' }];

describe('the account head\'s standing marks', () => {
  it('KEYS: proven is fine; set is warm; unset and refused are faults whose door is that account\'s keys row, the refusal said', () => {
    expect(keysMark(X, { ok: true, account: { name: 'nw' } }, 'x-1')).toMatchObject({ level: 'ok', title: 'KEYS · proven as @nw', door: null, reason: null });
    expect(keysMark(X, null, 'x-1')).toMatchObject({ level: 'warm', door: null });
    expect(keysMark({ ...X, configured: false }, null, 'x-2')).toMatchObject({ level: 'fault', door: { door: { kind: 'keys', channelId: 'x', accountId: 'x-2' }, label: 'SET KEYS' } });
    expect(keysMark(X, { ok: false, detail: 'HTTP 401' }, 'x-1')).toMatchObject({ level: 'fault', reason: 'HTTP 401', door: { label: 'FIX KEYS' } });
    expect(keysMark(null, null, 'x-1').level).toBe('unknown');
  });

  it('HOLDER: this account\'s own binding by roster name; none with no CMO opens SEAT A CMO, none with one the picker', () => {
    const cmo = { neumaId: 'kestrel', name: 'Kestrel' };
    expect(holderMark({ account: { id: 'x-1', binding: { neumaId: 'kestrel' } }, roster: ROSTER, cmo, read: true })).toMatchObject({ level: 'ok', name: 'Kestrel', door: null });
    expect(holderMark({ account: { id: 'x-1', binding: { neumaId: 'ghost' } }, roster: ROSTER, cmo, read: true })).toMatchObject({ name: '—' });
    expect(holderMark({ account: { id: 'x-1', binding: { neumaId: 'ghost' } }, roster: ROSTER, cmo, read: true }).title).toContain('(ghost)');
    expect(holderMark({ account: { id: 'x-1' }, roster: ROSTER, cmo: null, read: true })).toMatchObject({ level: 'fault', door: { seat: true, label: 'SEAT A CMO' } });
    expect(holderMark({ account: { id: 'x-1' }, roster: ROSTER, cmo, read: true })).toMatchObject({ level: 'fault', door: { seat: false, label: 'HOLDER' } });
    expect(holderMark({ account: undefined, roster: ROSTER, cmo, read: true }).level).toBe('unknown');
    expect(holderMark({ account: null, roster: ROSTER, cmo, read: true }).title).toBe('HOLDER · no account here yet');
    expect(holderMark({ account: null, roster: ROSTER, cmo: null, read: true }).door).toEqual({ seat: true, label: 'SEAT A CMO' });
    expect(holderMark({ account: null, roster: ROSTER, cmo, read: true, awaitingKeys: true }).level).toBe('warm');
    expect(holderMark({ account: { id: 'x-1' }, roster: ROSTER, cmo, read: false }).level).toBe('unknown');
    expect(holderMark({ account: { id: 'x-1' }, roster: ROSTER, cmo, read: true, awaitingKeys: true }))
      .toMatchObject({ level: 'warm', door: null, title: 'HOLDER · Kestrel (CMO) holds it once the keys are set' });
    expect(SEAT_DOOR).toEqual({ kind: 'marketing', tab: 'seat', reveal: '[data-cmo-row]' });
  });

  it('CREW: its count, its names and that it stands for every account on hover', () => {
    expect(crewMark([{ neumaId: 'kestrel' }, { neumaId: 'lane-9' }], ROSTER, 'X (Twitter)'))
      .toEqual({ fact: 'crew', level: 'ok', count: 2, title: 'CREW · Kestrel · lane-9 — the X (Twitter) crew works every X (Twitter) account' });
    expect(crewMark([], ROSTER, 'X').count).toBe(0);
  });
});

describe('the post card\'s WHEN', () => {
  const line = (e, now) => queueWhenLabel(e, now);
  it('a slot ahead is a countdown; an approved post\'s lock rides its hover', () => {
    const at = new Date(NOW + (3 * 60 + 12) * 60000).toISOString();
    expect(cardWhen({ status: 'draft', scheduledFor: at }, NOW, line).ahead.rel).toBe('3H 12M');
    const approved = cardWhen({ id: 'q_1', status: 'approved', scheduledFor: at, decidedAt: new Date(NOW - 36e5).toISOString() }, NOW, line);
    expect(approved.ahead.rel).toBe('3H 12M');
    expect(approved.title).toMatch(/^locked [A-Z]{3} \d{1,2}:\d{2} [AP]M · id q_1$/);
  });
  it('a settled post is its moment alone; a missed slot, no slot and a reply keep their line', () => {
    expect(cardWhen({ status: 'failed', createdAt: new Date(NOW - 36e5).toISOString() }, NOW, line).at).toMatch(/^[A-Z]{3} \d{1,2}:\d{2} [AP]M$/);
    expect(cardWhen({ status: 'sending' }, NOW, line)).toEqual({});
    expect(cardWhen({ status: 'draft', scheduledFor: new Date(NOW - 36e5).toISOString() }, NOW, line).line).toMatch(/^OVERDUE 1H/);
    expect(cardWhen({ status: 'draft', createdAt: new Date(NOW - 36e5).toISOString() }, NOW, line).line).toBe('STAGED 1H AGO · UNSCHEDULED');
    expect(cardWhen({ kind: 'reply', status: 'draft' }, NOW, line).line).toBe('SENDS THE MOMENT YOU APPROVE');
    expect(aheadOf(null, NOW)).toBe(null);
    expect(relWhen(20000)).toBe('NOW');
  });
});

describe('LEADS', () => {
  const leads = [
    { id: 'aaaaaaaa1', name: 'Ada', status: 'cold', channelId: 'x', touches: [{ at: 't1', note: 'seen' }, { at: 't2' }] },
    { id: 'bbbbbbbb2', name: 'Jun', status: 'contacted', channelId: 'email', ownerNeumaId: 'kestrel' },
    { id: 'cccccccc3', contact: 'm@x.io', status: 'won', channelId: 'other', ownerNeumaId: 'lane-9' },
  ];
  it('the funnel counts every stage in the ledger\'s order and narrows the list to one', () => {
    expect(funnelOf(leads).map((p) => p.count)).toEqual([1, 1, 0, 0, 1, 0]);
    expect(funnelOf([{ status: 'parked' }]).at(-1)).toEqual({ stage: 'parked', count: 1 });
    expect(leadsAt(leads, 'contacted').map((l) => l.name)).toEqual(['Jun']);
    expect(leadsAt(leads, null)).toHaveLength(3);
    expect([stageShare('cold'), stageShare('replied'), stageShare('won'), stageShare('lost')]).toEqual([0, 0.5, 1, null]);
  });
  it('a holder is a roster name, never a code; the menu names every stage with its own checked', () => {
    expect(holderOf(leads[1], ROSTER)).toEqual({ name: 'Kestrel', title: 'held by Kestrel' });
    expect(holderOf(leads[2], ROSTER).name).toBe('—');
    expect(holderOf(leads[0], ROSTER)).toBe(null);
    expect(lastTouchOf(leads[0])).toEqual({ at: 't2', note: 'seen' });
    const items = leadMenuItems(['cold', 'won'], 'won');
    expect(items.filter((i) => i.checked).map((i) => i.id)).toEqual(['stage:won']);
    expect(items.at(-1)).toMatchObject({ id: 'remove', danger: true });
  });
  it('HAND TO the CMO only for a lead no one holds, only to this house\'s own member, the acts named', () => {
    const hand = leadHandTo(leads[0], { laneId: 'kestrel' }, ROSTER);
    expect(hand).toMatchObject({ neumaId: 'kestrel', name: 'Kestrel' });
    expect(hand.prompt).toContain('lead_list');
    expect(hand.prompt).toContain('leads/touch with id aaaaaaaa and ownerNeumaId "kestrel"');
    expect(leadHandTo(leads[1], { laneId: 'kestrel' }, ROSTER)).toBe(null);
    expect(leadHandTo(leads[0], null, ROSTER)).toBe(null);
    expect(leadHandTo(leads[0], { laneId: 'vale' }, ROSTER)).toBe(null);
    expect(leadHandTo(leads[0], { laneId: 'elsewhere' }, ROSTER)).toBe(null);
  });
});
