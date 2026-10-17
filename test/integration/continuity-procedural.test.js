// Procedural recall — REAL directory, REAL logs, NO mock (RULE 0). The recall
// path under test is exactly what a being uses; only console noise is
// suppressed. Deterministic (lexical BM25) — no model.
//
// Proves the procedural layer of the continuity ecosystem:
//   - recall a method by goal; off-topic procedures excluded
//   - relevance is PRIMARY (a more-relevant older procedure beats a loosely-
//     relevant newer one) — NOT a recency fusion like episodic
//   - recency breaks ties (equally-relevant → latest refinement first)
//   - supersede-not-delete: a refined procedure retires the old; recall + list
//     surface only the current version
//   - space is OPTIONAL (procedures are general by default); a space narrows it
//   - structured {goal, steps} content is indexed via recordToText
//   - listProcedures returns current procedures, newest refinement first

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeRecord } from '../../core/continuity/record.js';
import { FsDirAdapter } from '../../core/continuity/adapters/fsdir.js';
import { recallProcedure, listProcedures } from '../../core/continuity/layers/procedural.js';

const proc = (content, opts = {}) =>
  makeRecord({ layer: 'procedural', content, space: opts.space, recordedAt: opts.at, id: opts.id, supersedes: opts.supersedes });

describe('continuity procedural recall — relevance-first method retrieval on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    // console spies suppress test noise only — not in the recall path (RULE 0).
    root = await createTempDir('continuity-procedural');
  });
  afterAll(() => vi.restoreAllMocks());

  it('recalls the relevant method by goal and excludes the off-topic one', async () => {
    const store = new FsDirAdapter(path.join(root, 'recall'));
    await store.append(proc('to ship a reviewed slice: build, write a real no-mock test, run the ai6 review loop, then commit'));
    await store.append(proc('to deploy a contract: compile with hardhat then run the fork test'));

    const hits = await recallProcedure(store, 'how do I ship a reviewed slice');
    expect(hits.length).toBe(1);
    expect(hits[0].record.content).toContain('ship a reviewed slice');
    expect(hits.some((h) => h.record.content.includes('deploy a contract'))).toBe(false);
  });

  it('ranks by relevance first — a more-relevant OLDER procedure beats a loosely-relevant newer one', async () => {
    const store = new FsDirAdapter(path.join(root, 'relevance-first'));
    await store.append(proc('ship a reviewed slice: build, real test, ai6 review loop, commit', { at: '2026-06-10T00:00:00.000Z' }));
    await store.append(proc('ship code somewhere', { at: '2026-06-20T00:00:00.000Z' })); // newer, weakly relevant

    const hits = await recallProcedure(store, 'ship a reviewed slice build real test ai6 review');
    expect(hits[0].record.content).toContain('ai6 review loop'); // the older, far-more-relevant one leads
  });

  it('breaks ties by recency — equally-relevant procedures put the latest refinement first', async () => {
    const store = new FsDirAdapter(path.join(root, 'recency-tiebreak'));
    await store.append(proc('rotate the witness wallet keypair safely', { at: '2026-06-01T00:00:00.000Z' }));
    await store.append(proc('rotate the witness wallet keypair safely', { at: '2026-06-18T00:00:00.000Z' }));

    const hits = await recallProcedure(store, 'rotate the witness wallet keypair');
    expect(hits).toHaveLength(2);
    expect(hits[0].record.recordedAt).toBe('2026-06-18T00:00:00.000Z'); // latest refinement first
  });

  it('supersede-not-delete: a refined procedure retires the old; recall + list show only the current', async () => {
    const store = new FsDirAdapter(path.join(root, 'supersede'));
    await store.append(proc('birth a neuma: run the 7-stage ceremony with safety nets', { id: 'birth-proc', at: '2026-06-01T00:00:00.000Z' }));
    await store.append(proc('birth a neuma: run the rebuilt ceremony, zero safety nets, prove DNA write e2e', { supersedes: 'birth-proc', at: '2026-06-20T00:00:00.000Z' }));

    const hits = await recallProcedure(store, 'how to birth a neuma ceremony');
    expect(hits.map((h) => h.record.content)).toEqual(['birth a neuma: run the rebuilt ceremony, zero safety nets, prove DNA write e2e']);
    const all = await listProcedures(store);
    expect(all).toHaveLength(1); // old version folded out of the current view
  });

  it('space is optional (general by default); a space narrows to project procedures', async () => {
    const store = new FsDirAdapter(path.join(root, 'space'));
    await store.append(proc('configure unique dev ports for this checkout', { space: 'neuma' }));
    await store.append(proc('configure unique dev ports for this checkout')); // general (no space)

    const all = await recallProcedure(store, 'configure unique dev ports');
    expect(all).toHaveLength(2);                                   // both spaces searched by default
    const scoped = await recallProcedure(store, 'configure unique dev ports', { space: 'neuma' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].record.space).toBe('neuma');
  });

  it('indexes structured {goal, steps} content via recordToText', async () => {
    const store = new FsDirAdapter(path.join(root, 'structured'));
    await store.append(proc({ goal: 'run the ai6 review loop', steps: ['dispatch ask-glm', 'read the VERDICT', 'fix every finding', 'loop until APPROVE'] }));

    const hits = await recallProcedure(store, 'ai6 review loop verdict findings');
    expect(hits).toHaveLength(1);
    expect(hits[0].record.content.goal).toBe('run the ai6 review loop');
  });

  it('listProcedures returns the current procedures, newest refinement first', async () => {
    const store = new FsDirAdapter(path.join(root, 'list-order'));
    await store.append(proc('older method', { at: '2026-06-05T00:00:00.000Z' }));
    await store.append(proc('newer method', { at: '2026-06-21T00:00:00.000Z' }));
    await store.append(proc('middle method', { at: '2026-06-12T00:00:00.000Z' }));

    const all = await listProcedures(store);
    expect(all.map((r) => r.content)).toEqual(['newer method', 'middle method', 'older method']);
  });

  it('empty goal or empty store yields no recall', async () => {
    const store = new FsDirAdapter(path.join(root, 'empty'));
    expect(await recallProcedure(store, '   ')).toEqual([]);
    expect(await recallProcedure(store, 'anything')).toEqual([]);
  });
});
