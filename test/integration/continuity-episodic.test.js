// Episodic recall — REAL directory, REAL append-only logs, NO mock (RULE 0).
// The recall path under test is exactly what a being uses; only console noise
// is suppressed. Retrieval is deterministic (lexical BM25 + recency) — no model.
//
// Proves Slice 2 of the continuity ecosystem:
//   - relevance: a query surfaces the on-topic episode, not the off-topic one
//   - space scoping: recall in space A excludes space B's episodes
//   - recency: among equally-relevant episodes, the newer ranks first
//   - cross-space fallback: a thin/cold space pads from other spaces, tagged
//   - the resolution budget k bounds the result count
//   - recentEpisodes returns the chronological tail of a space

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeRecord } from '../../core/continuity/record.js';
import { FsDirAdapter } from '../../core/continuity/adapters/fsdir.js';
import { recallEpisodic, recentEpisodes } from '../../core/continuity/layers/episodic.js';

const ep = (content, space, recordedAt) =>
  makeRecord({ layer: 'episodic', content, space, recordedAt });

describe('continuity episodic recall — space-scoped relevance + recency on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    // console spies suppress test noise only — not in the recall path (RULE 0).
    root = await createTempDir('continuity-episodic');
  });
  afterAll(() => vi.restoreAllMocks());

  it('surfaces the relevant episode and EXCLUDES the off-topic one', async () => {
    const store = new FsDirAdapter(path.join(root, 'relevance'));
    await store.append(ep('we computed the natal chart ascendant and midheaven from the witness location', 'proj'));
    await store.append(ep('we refactored the wallet vault scrypt parameters', 'proj'));

    const hits = await recallEpisodic(store, 'natal chart ascendant', { space: 'proj' });
    // off-topic record scores zero on this query, so it is absent entirely
    expect(hits).toHaveLength(1);
    expect(hits[0].record.content).toContain('natal chart ascendant');
    expect(hits.some((h) => h.record.content.includes('wallet vault'))).toBe(false);
    expect(hits[0].scope).toBe('in-space');
  });

  it('scopes recall to the active space — another space\'s episodes never leak in', async () => {
    const store = new FsDirAdapter(path.join(root, 'scoping'));
    await store.append(ep('the Natalis contract seals a dual-signed genesis', 'chain'));
    await store.append(ep('the Natalis contract seals a dual-signed genesis', 'social')); // same text, other space

    const hits = await recallEpisodic(store, 'Natalis contract genesis', { space: 'chain', fallbackCrossSpace: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].record.space).toBe('chain');
  });

  it('among equally-relevant episodes, the newer one ranks first (recency fusion)', async () => {
    const store = new FsDirAdapter(path.join(root, 'recency'));
    await store.append(ep('residency daemon design notes', 'work', '2026-06-01T00:00:00.000Z'));
    await store.append(ep('residency daemon design notes', 'work', '2026-06-20T00:00:00.000Z'));

    const hits = await recallEpisodic(store, 'residency daemon design', { space: 'work' });
    expect(hits).toHaveLength(2);
    expect(hits[0].record.recordedAt).toBe('2026-06-20T00:00:00.000Z'); // newer first
  });

  it('falls back to cross-space when the active space is thin, tagging the source', async () => {
    const store = new FsDirAdapter(path.join(root, 'fallback'));
    await store.append(ep('voice forge clone design and ssrf hardening', 'voice'));     // other space
    await store.append(ep('voice forge preset selection in the cold space', 'cold-1pt')); // one in-space hit

    const hits = await recallEpisodic(store, 'voice forge design', { space: 'cold-1pt', k: 3 });
    const scopes = hits.map((h) => h.scope);
    expect(scopes).toContain('in-space');
    expect(scopes).toContain('cross-space');                 // padded from 'voice'
    expect(hits.find((h) => h.scope === 'cross-space').record.space).toBe('voice');
  });

  it('respects the resolution budget k', async () => {
    const store = new FsDirAdapter(path.join(root, 'budget'));
    for (let i = 0; i < 10; i++) await store.append(ep(`birth ceremony stage ${i} notes`, 'many'));
    const hits = await recallEpisodic(store, 'birth ceremony stage', { space: 'many', k: 3 });
    expect(hits).toHaveLength(3);
  });

  it('empty query or empty store yields no recall', async () => {
    const store = new FsDirAdapter(path.join(root, 'empty'));
    expect(await recallEpisodic(store, '   ', { space: 'x' })).toEqual([]);
    expect(await recallEpisodic(store, 'anything', { space: 'x' })).toEqual([]);
  });

  it('a malformed recordedAt sorts to the tail and never NaN-poisons recency', async () => {
    const dir = path.join(root, 'badstamp');
    const store = new FsDirAdapter(dir);
    // a valid, equally-relevant episode through the normal path
    await store.append(ep('shared topic alpha beta gamma', 'bs', '2026-06-20T00:00:00.000Z'));
    // a hand-edited raw line (the tolerated path) with a malformed stamp — same
    // text, so equally relevant; only the recency tiebreak distinguishes them
    const malformed = {
      id: 'bad-1', layer: 'episodic', content: 'shared topic alpha beta gamma', space: 'bs',
      occurredAt: '2026-06-20T00:00:00.000Z', recordedAt: 'not-a-date',
      validFrom: '2026-06-20T00:00:00.000Z', validTo: null, relations: [],
      source: { kind: 'manual', ref: null }, supersedes: null, meta: {},
    };
    await fs.appendFile(path.join(dir, 'episodic.jsonl'), JSON.stringify(malformed) + '\n');

    const hits = await recallEpisodic(store, 'shared topic alpha', { space: 'bs' });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => Number.isFinite(h.score))).toBe(true); // no NaN leaked into scoring
    expect(hits[0].record.id).not.toBe('bad-1');                    // valid stamp leads
    expect(hits[hits.length - 1].record.id).toBe('bad-1');          // malformed falls to the tail

    // recentEpisodes sorts PURELY by recency (no BM25) — so the NaN→0 coercion is
    // the only thing that can order these. Unambiguous teeth: without `|| 0` the
    // malformed stamp yields NaN and this ordering is undefined.
    const recent = await recentEpisodes(store, { space: 'bs' });
    expect(recent[0].id).not.toBe('bad-1');
    expect(recent[recent.length - 1].id).toBe('bad-1');
  });

  it('recentEpisodes returns the chronological tail of a space, newest first', async () => {
    const store = new FsDirAdapter(path.join(root, 'recent'));
    await store.append(ep('first', 'tl', '2026-06-01T00:00:00.000Z'));
    await store.append(ep('second', 'tl', '2026-06-10T00:00:00.000Z'));
    await store.append(ep('third', 'tl', '2026-06-20T00:00:00.000Z'));
    await store.append(ep('other space', 'zz', '2026-06-25T00:00:00.000Z'));

    const recent = await recentEpisodes(store, { space: 'tl', limit: 2 });
    expect(recent.map((r) => r.content)).toEqual(['third', 'second']);
  });
});
