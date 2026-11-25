/**
 * THE ACTIVITY PANEL'S TOKEN ROWS (frontend/app/RelinkShell/token-rows.js) —
 * pure, fed the `tokens` block the live telemetry answered on 2026-11-05
 * (RULE 0). Every row is a measured number or '—', never a drawn zero.
 */
import { describe, test, expect } from 'vitest';
import { replyInView, phaseParts, replyRows, recentRows, lifetimeRows } from '../../frontend/app/RelinkShell/token-rows.js';

// The reply the live proof metered: 6,440 thinking tokens, a reconciled tool call.
const ENDED = {
  ttftMs: 378.9, phase: 'tool', durationMs: 89201.7,
  thinking: { tokens: 6440, timed: 6439, ms: 88624.9, tokPerSec: 72.65 },
  answer: { tokens: 0, timed: 0, ms: 0, tokPerSec: null },
  tool: { tokens: 78, timed: 78, ms: 576.8, tokPerSec: 135.2 },
  server: { promptTokens: 420, promptMs: 370.4, cachedTokens: 0, predictedTokens: 6518, predictedMs: 89243.4, draftTokens: 5349, draftAccepted: 4734 },
  endedAt: 1793827421006,
};
const STREAMING = { ...ENDED, phase: 'thinking', server: null, sinceMs: 40_000, tool: { tokens: 0, timed: 0, ms: 0, tokPerSec: null } };
const row = (rows, k) => rows.find((r) => r.k === k);

describe('which reply the panel shows', () => {
  test('the newest streaming one, else the last that ended, else none', () => {
    expect(replyInView({ live: [{ ...STREAMING, sinceMs: 9000 }, { ...STREAMING, sinceMs: 300 }], recent: [ENDED] }))
      .toMatchObject({ live: true, streaming: 2, reply: { sinceMs: 300 } });
    expect(replyInView({ live: [], recent: [ENDED] })).toMatchObject({ live: false, reply: ENDED });
    expect(replyInView({ live: [], recent: [] })).toBeNull();
  });
});

describe('one reply', () => {
  test('each phase\'s speed and size, the wait, and the server\'s own account', () => {
    const rows = replyRows(ENDED);
    expect(row(rows, 'THINKING')).toMatchObject({ v: '72.7', unit: 'tok/s', sub: '6,440 tok', active: false });
    expect(row(rows, 'ANSWER')).toMatchObject({ v: '—', sub: '0 tok' });
    expect(row(rows, 'TOOL CALL')).toMatchObject({ v: '135', sub: '78 tok' });
    expect(row(rows, 'FIRST TOKEN')).toMatchObject({ v: '379', unit: 'ms' });
    expect(row(rows, 'PROMPT')).toMatchObject({ v: '1,134', unit: 'tok/s' });
    expect(row(rows, 'PROMPT CACHE')).toMatchObject({ v: '0', unit: '%' });
    expect(row(rows, 'DRAFTS ACCEPTED')).toMatchObject({ v: '89', sub: '4,734 of 5,349' });
    expect(phaseParts(ENDED).map((p) => p.value)).toEqual([6440, 0, 78]);
  });

  test('streaming: the phase it is in now is lit, and what the server has not yet said reads —', () => {
    const rows = replyRows(STREAMING, true);
    expect(row(rows, 'THINKING').active).toBe(true);
    expect(row(rows, 'PROMPT').v).toBe('—');
    expect(row(rows, 'PROMPT CACHE').v).toBe('—');
    expect(row(rows, 'DRAFTS ACCEPTED').v).toBe('—');
  });

  test('a long wait reads in seconds', () => {
    expect(row(replyRows({ ...ENDED, ttftMs: 21_400 }), 'FIRST TOKEN')).toMatchObject({ v: '21.4', unit: 's' });
  });
});

describe('the last replies and the server since it started', () => {
  test('the live proof\'s numbers, as rows', () => {
    const recent = recentRows({ replies: 1, thinking: 72.65, answer: null, tool: 26.01, ttftMs: 378.94, promptTokPerSec: 1133.88, genTokPerSec: 73.04, cacheReuse: 0, draftAcceptance: 0.885 });
    expect(recent.map((r) => [r.k, r.v])).toEqual([
      ['THINKING', '72.7'], ['ANSWER', '—'], ['TOOL CALL', '26.0'], ['FIRST TOKEN', '379'],
      ['GENERATION', '73.0'], ['PROMPT', '1,134'], ['PROMPT CACHE', '0'], ['DRAFTS ACCEPTED', '89'],
    ]);
    const life = lifetimeRows({ genTokPerSec: 73.1, promptTokPerSec: 2115.4, generatedTokens: 23016, promptTokens: 72073, cachedTokens: 118609, cacheReuse: 0.62, draftAcceptance: 0.65, acceptedPerDraft: 1.96 });
    expect(life.map((r) => [r.k, r.v])).toEqual([
      ['GENERATION', '73.1'], ['PROMPT', '2,115'], ['GENERATED', '23,016'], ['PROMPT READ', '72,073'],
      ['PROMPT CACHE', '62'], ['DRAFTS ACCEPTED', '65'], ['PER DRAFT', '1.96'],
    ]);
  });

  test('nothing measured is — everywhere, never zero', () => {
    expect(recentRows(undefined).every((r) => r.v === '—')).toBe(true);
    expect(lifetimeRows(undefined).every((r) => r.v === '—')).toBe(true);
  });
});
