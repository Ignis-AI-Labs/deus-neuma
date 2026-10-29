/**
 * The Mercator's deals as pure law, called with real inputs (RULE 0): a deal
 * opens only once qualified (SPIN's problem and need-payoff known), a clear no
 * rests the thread thirty days (MAKOTO), every close says why, and the
 * pipeline sums each stage per currency. The briefing text and the doctrine
 * line read as the office reads them.
 */
import { describe, test, expect } from 'vitest';
import { makeDeal, restRefusal, judgeMove, foldDeals, pipeline, THREAD_REST_DAYS } from '../../backend/services/revenue/deal-shape.js';
import { mercatorBriefingText } from '../../backend/services/revenue/revenue-briefing.js';
import { MAKOTO_LINE, MAKOTO_SECTION } from '../../backend/services/makoto.js';

const DAY = 86_400_000;
const at = (d) => new Date(Date.parse('2026-11-01T10:00:00.000Z') + d * DAY).toISOString();
const deal = (over = {}) => makeDeal({
  companyId: 'c-abc123-0a0b0c', buyer: 'Padstow harbour office', leadId: 'lead-1', value: { amount: 120, currency: 'USD' },
  spin: { situation: 'Prints national tables weekly', problem: 'Tables arrive in the wrong format', needPayoff: '"It would save me an hour every Monday"' },
  nextStep: 'Send the sample sheet on Monday', openedBy: 'merc', now: at(0), ...over,
});

describe('opening a deal', () => {
  test('qualify first: no deal without the problem and the need-payoff in the buyer\'s words', () => {
    expect(() => deal({ spin: { problem: 'Tables arrive in the wrong format' } })).toThrow(/qualify first/);
    expect(() => deal({ value: { amount: -1, currency: 'USD' } })).toThrow(/value is/);
    expect(() => deal({ value: { amount: 10, currency: 'usd' } })).toThrow(/three-letter currency/);
    expect(() => deal({ nextStep: '' })).toThrow(/one clear next step/);
    expect(deal()).toMatchObject({ buyer: 'Padstow harbour office', leadId: 'lead-1', value: { amount: 120, currency: 'USD' }, spin: { implication: null } });
  });

  test('a clear no rests the thread thirty days; an open deal is moved, not doubled', () => {
    const first = deal();
    const lostFold = foldDeals([{ type: 'opened', deal: first, at: at(0) }, { type: 'moved', id: first.id, stage: 'lost', note: 'They chose to keep the almanac', by: 'merc', at: at(1) }]).deals;
    expect(restRefusal(deal({ now: at(10) }), lostFold)).toMatch(/said no on 2026-11-02 — a clear no ends the thread \(MAKOTO\); not before 30 days/);
    expect(restRefusal(deal({ now: at(1 + THREAD_REST_DAYS) }), lostFold)).toBeNull();
    const openFold = foldDeals([{ type: 'opened', deal: first, at: at(0) }]).deals;
    expect(restRefusal(deal({ now: at(2) }), openFold)).toMatch(/already open/);
    expect(restRefusal(deal({ leadId: null, buyer: 'Mevagissey', now: at(2) }), openFold)).toBeNull();
  });
});

describe('moving a deal', () => {
  const [open] = foldDeals([{ type: 'opened', deal: deal(), at: at(0) }]).deals;

  test('every move says what was offered, or why we won or lost; a closed deal does not move', () => {
    expect(judgeMove(open, { stage: 'won', note: 'yes', by: 'merc', now: at(1) }).reason).toMatch(/why we won/);
    expect(judgeMove(open, { stage: 'proposed', note: '', by: 'merc', now: at(1) }).reason).toMatch(/what was offered/);
    expect(judgeMove(open, { stage: 'closed', note: 'whatever happened', by: 'merc', now: at(1) }).reason).toBe('a move is to proposed, won or lost');
    const won = judgeMove(open, { stage: 'won', note: 'The sample sheet sold itself', value: { amount: 144, currency: 'USD' }, by: 'merc', now: at(2) });
    expect(won).toEqual({ ok: true, event: { type: 'moved', id: open.id, stage: 'won', note: 'The sample sheet sold itself', value: { amount: 144, currency: 'USD' }, by: 'merc', at: at(2) } });
    const [closed] = foldDeals([{ type: 'opened', deal: open, at: at(0) }, won.event]).deals;
    expect(closed.stage).toBe('won');
    expect(judgeMove(closed, { stage: 'lost', note: 'changed our mind', by: 'merc', now: at(3) }).reason).toBe('this deal is won — a closed deal does not move');
    expect(judgeMove(undefined, { stage: 'won', note: 'x', by: 'merc', now: at(3) }).reason).toMatch(/no such deal/);
  });

  test('the pipeline sums each stage per currency, and the briefing reads it with MAKOTO', () => {
    const a = deal();
    const b = deal({ buyer: 'Fowey', leadId: null, value: { amount: 0.05, currency: 'ETH' } });
    const { deals } = foldDeals([
      { type: 'opened', deal: a, at: at(0) }, { type: 'opened', deal: b, at: at(0) },
      { type: 'moved', id: a.id, stage: 'proposed', note: 'Ten dollars a month, monthly', by: 'merc', at: at(1) },
    ]);
    expect(pipeline(deals)).toEqual({
      qualified: { count: 1, value: { ETH: 0.05 } }, proposed: { count: 1, value: { USD: 120 } },
      won: { count: 0, value: {} }, lost: { count: 0, value: {} },
    });
    const text = mercatorBriefingText({ deals, leads: [{ id: 'lead-2', name: 'Looe harbour', channelId: 'email', status: 'qualified' }, { id: 'lead-1', status: 'qualified', channelId: 'x' }], now: Date.parse(at(3)) });
    expect(text).toContain('Pipeline: QUALIFIED 1 (0.05 ETH) · PROPOSED 1 (120 USD) · WON 0 (0) · LOST 0');
    expect(text).toContain(`- [${a.id}] Padstow harbour office — PROPOSED, 120 USD — next: Send the sample sheet on Monday (last moved 2 days ago)`);
    expect(text).toContain('- [lead-2] Looe harbour (email)');
    expect(text).not.toContain('[lead-1]');
    expect(text).toContain(MAKOTO_LINE);
  });
});

describe('MAKOTO', () => {
  test('the line and the playbook section carry every part of the doctrine, the script glossed', () => {
    for (const part of ['Blue Ocean', 'SPIN', 'straight line', 'a second push after a clear no', 'posing as human']) expect(MAKOTO_LINE).toContain(part);
    expect(MAKOTO_SECTION).toContain('MAKOTO 誠 (makoto, "sincerity")');
    expect(MAKOTO_SECTION).toContain('CAN-SPAM');
  });
});
