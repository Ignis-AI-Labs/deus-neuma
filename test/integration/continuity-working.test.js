// Working-set assembly — REAL directory, REAL logs, NO mock (RULE 0). The
// assembly path under test is exactly what a being uses; only console noise is
// suppressed. Deterministic (no model) — composes the episodic layer's recall.
//
// Proves Slice 3 of the continuity ecosystem:
//   - the always-on recent tail loads even with no query
//   - query-relevant episodes compose with the recent tail, deduped
//   - the hard ITEM budget is enforced and overflow is RETURNED, not hidden
//   - the hard TOKEN budget is enforced and overflow is RETURNED, not hidden
//   - recent is prioritized over relevant when the budget is tight
//   - space scoping carries through the assembler

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeRecord } from '../../core/continuity/record.js';
import { FsDirAdapter } from '../../core/continuity/adapters/fsdir.js';
import { assembleWorkingSet } from '../../core/continuity/layers/working.js';

const ep = (content, space, recordedAt) =>
  makeRecord({ layer: 'episodic', content, space, recordedAt });

describe('continuity working-set — bounded live context assembly on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    // console spies suppress test noise only — not in the assembly path (RULE 0).
    root = await createTempDir('continuity-working');
  });
  afterAll(() => vi.restoreAllMocks());

  it('loads the always-on recent tail even with no query', async () => {
    const store = new FsDirAdapter(path.join(root, 'recent-only'));
    await store.append(ep('older note', 'w', '2026-06-01T00:00:00.000Z'));
    await store.append(ep('newer note', 'w', '2026-06-20T00:00:00.000Z'));

    const ws = await assembleWorkingSet(store, undefined, { space: 'w', recentCount: 2 });
    expect(ws.items.map((i) => i.source)).toEqual(['recent', 'recent']);
    expect(ws.items[0].record.content).toBe('newer note'); // newest tail first
    expect(ws.dropped).toEqual([]);
  });

  it('composes the recent tail with query-relevant episodes, deduped', async () => {
    const store = new FsDirAdapter(path.join(root, 'compose'));
    await store.append(ep('we wired the natal chart into the ceremony', 'w', '2026-06-10T00:00:00.000Z'));
    await store.append(ep('latest standup: residency daemon next', 'w', '2026-06-22T00:00:00.000Z'));

    const ws = await assembleWorkingSet(store, 'natal chart ceremony', { space: 'w', recentCount: 1, relevantCount: 3 });
    const sources = ws.items.map((i) => i.source);
    expect(sources).toContain('recent');                    // the tail anchor
    expect(sources).toContain('relevant');                  // the query hit
    // no record appears twice (dedup across recent + relevant)
    const ids = ws.items.map((i) => i.record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enforces the hard ITEM budget and RETURNS the overflow (no silent truncation)', async () => {
    const store = new FsDirAdapter(path.join(root, 'item-budget'));
    for (let i = 0; i < 6; i++) await store.append(ep(`tail note ${i}`, 'w', `2026-06-${10 + i}T00:00:00.000Z`));

    const ws = await assembleWorkingSet(store, undefined, { space: 'w', recentCount: 6, maxItems: 2, maxTokens: 100000 });
    expect(ws.items).toHaveLength(2);
    expect(ws.dropped).toHaveLength(4);
    expect(ws.dropped.every((d) => d.reason === 'maxItems')).toBe(true); // overflow surfaced + labeled
  });

  it('enforces the hard TOKEN budget and RETURNS the overflow', async () => {
    const store = new FsDirAdapter(path.join(root, 'token-budget'));
    // ~1080 chars ≈ 270 approx-tokens each (chars/4). The 300/270 numbers are
    // anchored to content-only token estimates; if recordToText's output grows,
    // the items.length>=1 assertion fails loudly rather than silently breaking.
    const big = 'lorem ipsum dolor sit amet '.repeat(40);
    await store.append(ep(big, 'w', '2026-06-10T00:00:00.000Z'));
    await store.append(ep(big, 'w', '2026-06-11T00:00:00.000Z'));
    await store.append(ep(big, 'w', '2026-06-12T00:00:00.000Z'));

    const ws = await assembleWorkingSet(store, undefined, { space: 'w', recentCount: 3, maxItems: 100, maxTokens: 300 });
    expect(ws.items.length).toBeGreaterThanOrEqual(1);
    expect(ws.usedTokens).toBeLessThanOrEqual(ws.maxTokens);             // budget never exceeded
    expect(ws.dropped.length).toBeGreaterThan(0);
    expect(ws.dropped.some((d) => d.reason === 'maxTokens')).toBe(true); // token overflow surfaced
  });

  it('prioritizes the recent tail over relevant hits when the budget is tight', async () => {
    const store = new FsDirAdapter(path.join(root, 'priority'));
    // a relevant-but-old episode and a recent tail episode; budget = 1 item.
    // (Both dates are in the past — a future validFrom is correctly gated out by
    // isValidAsOf, so episode stamps must be <= now to be in force.)
    await store.append(ep('voice forge clone design relevant keyword', 'w', '2026-06-01T00:00:00.000Z'));
    await store.append(ep('most recent unrelated standup', 'w', '2026-06-23T00:00:00.000Z'));

    const ws = await assembleWorkingSet(store, 'voice forge clone design', { space: 'w', recentCount: 1, relevantCount: 3, maxItems: 1 });
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].source).toBe('recent');              // tail wins the single slot
    expect(ws.dropped.some((d) => d.source === 'relevant')).toBe(true);
  });

  it('scopes assembly to the active space', async () => {
    const store = new FsDirAdapter(path.join(root, 'scope'));
    await store.append(ep('in space A', 'A', '2026-06-10T00:00:00.000Z'));
    await store.append(ep('in space B', 'B', '2026-06-10T00:00:00.000Z'));

    const ws = await assembleWorkingSet(store, undefined, { space: 'A', recentCount: 5 });
    expect(ws.items).toHaveLength(1);
    expect(ws.items[0].record.space).toBe('A');
  });
});
