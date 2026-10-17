// S10 — the backfill cores' pure law: shared-ts pairing that never drops
// and never guesses, gap grouping that only shapes layout, verbatim rows.

import { describe, it, expect } from 'vitest';
import {
  pairExchanges,
  groupPseudoSessions,
  segmentRowsFrom,
  rowHash,
} from '../../core/memory/backfill.js';

const ts = (m) => new Date(1753290000000 + m * 60000).toISOString();
const row = (role, content, at) => ({ ts: at, role, content });

describe('pairExchanges', () => {
  it('pairs user→assistant sharing one ts; everything else survives flagged', () => {
    const rows = [
      row('user', 'q1', ts(0)), row('assistant', 'a1', ts(0)),
      row('user', 'lonely', ts(5)),
      row('assistant', 'stray', ts(9)),
      row('user', 'q2', ts(12)), row('assistant', 'a2', ts(12)),
    ];
    const paired = pairExchanges(rows);
    expect(paired.map((p) => p.kind)).toEqual(['exchange', 'singleton', 'singleton', 'exchange']);
    expect(paired[1].flag).toBe('orphan');
    expect(paired[3].user.content).toBe('q2');
  });

  it('a same-ts triple is AMBIGUOUS — flagged, never guess-paired', () => {
    const rows = [row('user', 'q', ts(0)), row('assistant', 'a1', ts(0)), row('assistant', 'a2', ts(0))];
    const paired = pairExchanges(rows);
    expect(paired[0]).toMatchObject({ kind: 'singleton', flag: 'ambiguous-ts' });
    // Nothing dropped: three rows in, three items out.
    expect(paired.flatMap((p) => (p.kind === 'exchange' ? [p.user, p.assistant] : [p.row]))).toHaveLength(3);
  });

  it('empty input answers empty; a malformed row survives FLAGGED — lossless means lossless', () => {
    expect(pairExchanges([])).toEqual([]);
    expect(pairExchanges(null)).toEqual([]);
    const carried = pairExchanges([{ broken: true }]);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ kind: 'singleton', flag: 'malformed' });
    expect(carried[0].row.role).toBe('unknown');
    expect(carried[0].row.content).toBe('');
  });
});

describe('groupPseudoSessions', () => {
  it('a gap beyond the threshold opens a new bf- group with an epoch-ms id (R2)', () => {
    const items = pairExchanges([
      row('user', 'q1', ts(0)), row('assistant', 'a1', ts(0)),
      row('user', 'q2', ts(10)), row('assistant', 'a2', ts(10)),
      row('user', 'q3', ts(60)), row('assistant', 'a3', ts(60)),
    ]);
    const groups = groupPseudoSessions(items, { neumaId: 'cael', gapMinutes: 30 });
    expect(groups).toHaveLength(2);
    expect(groups[0].sessionId).toBe(`bf-cael-${1753290000000}`);
    expect(groups[1].sessionId).toBe(`bf-cael-${1753290000000 + 60 * 60000}`);
    expect(groups[0].items).toHaveLength(2);
  });

  it('an unlawful neumaId FAILS explicit — nothing normalizes silently (R2)', () => {
    expect(() => groupPseudoSessions([], { neumaId: 'Upper_Case' })).toThrow('not lawful');
  });
});

describe('segmentRowsFrom + rowHash', () => {
  it('renders verbatim rows, carries singleton flags, and hashes stably', () => {
    const items = pairExchanges([
      row('user', 'the question', ts(0)), row('assistant', 'the answer', ts(0)),
      row('assistant', 'stray', ts(2)),
    ]);
    const rows = segmentRowsFrom(items);
    expect(rows).toEqual([
      { role: 'user', content: 'the question', timestamp: ts(0) },
      { role: 'assistant', content: 'the answer', timestamp: ts(0) },
      { role: 'assistant', content: 'stray', timestamp: ts(2), backfillFlag: 'orphan' },
    ]);
    const h = rowHash({ ts: ts(0), role: 'user', content: 'the question' });
    expect(h).toBe(rowHash({ ts: ts(0), role: 'user', content: 'the question' }));
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
