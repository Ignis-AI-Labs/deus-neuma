/**
 * THE RECALL APPEND LANE (harness-friction-map T2) — crystallization must not
 * cost the NEXT turn a full index rebuild. Proven on the REAL encrypted
 * workspace store, no mocks (RULE 0):
 *  (a) a store-returned record APPENDED to a hot index is recallable
 *      immediately, with the build count UNMOVED (no rebuild happened);
 *  (b) the appended index answers EXACTLY what a from-disk rebuild answers —
 *      same memories, same order, same scores — for both the prompt lane and
 *      the sovereign search lane, so appending is not a behavior change;
 *  (c) an append with no hot index is a no-op (the next _ensure builds the
 *      record in, as before);
 *  (d) invalidate still drops (the compaction lane's law is untouched).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';

const NEUMA_ID = 'appendry';

describe('recall append lane (real encrypted workspace, gnosis)', () => {
  let house, origRoot, prevDnaKey;

  beforeAll(async () => {
    house = await createTempDir('recall-append-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    await workspace.create(NEUMA_ID);
    // A lifetime's worth of moments — enough that a rebuild is a real cost.
    for (let i = 0; i < 120; i += 1) {
      await workspace.addObservation(NEUMA_ID, {
        type: 'exchange',
        userMessage: `ordinary working exchange number ${i} about the harbor and the tides`,
        response: `reflection ${i} — the harbor stays, the tides turn`,
        significance: 0.2,
      });
    }
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    neumaRecall.invalidate(NEUMA_ID);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('(a) an appended crystallization is immediately recallable with NO rebuild', async () => {
    // Prime the hot index.
    await neumaRecall.getRelevantMemories(NEUMA_ID, 'harbor tides');
    const buildsBefore = neumaRecall.buildCounts.get(NEUMA_ID) || 0;
    expect(buildsBefore).toBe(1);

    // The crystallize-shaped write, exactly as the portal persist path now
    // does it: the STORE's returned record, appended to the hot index.
    const written = await workspace.addObservation(NEUMA_ID, {
      type: 'exchange',
      userMessage: 'the lighthouse keeper asked about the emerald beacon',
      response: 'the emerald beacon was lit tonight, first time in years',
      significance: 0.9,
    });
    neumaRecall.appendObservation(NEUMA_ID, written);

    // No rebuild paid.
    expect(neumaRecall.buildCounts.get(NEUMA_ID) || 0).toBe(buildsBefore);
    // The new moment is live for recall.
    const hits = await neumaRecall.getRelevantMemories(NEUMA_ID, 'emerald beacon lighthouse');
    expect(hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(hits)).toContain('emerald beacon');
  });

  test('(b) the appended index answers EXACTLY what a from-disk rebuild answers', async () => {
    const queries = ['emerald beacon lighthouse', 'harbor tides reflection', 'ordinary working exchange'];
    const before = [];
    for (const query of queries) before.push({
      hits: await neumaRecall.searchDocs(NEUMA_ID, query, { limit: 10 }),
      prompt: await neumaRecall.getRelevantMemories(NEUMA_ID, query),
    });
    const preInvalidate = neumaRecall.buildCounts.get(NEUMA_ID) || 0;
    neumaRecall.invalidate(NEUMA_ID);
    for (const [i, query] of queries.entries()) {
      const rebuilt = await neumaRecall.searchDocs(NEUMA_ID, query, { limit: 10 });
      const rebuiltPrompt = await neumaRecall.getRelevantMemories(NEUMA_ID, query);
      // Exactly ONE rebuild paid per invalidate — never more.
      expect(neumaRecall.buildCounts.get(NEUMA_ID) || 0).toBe(preInvalidate + 1);
      expect(before[i].hits.hits).toEqual(rebuilt.hits);
      expect(before[i].hits.totalMatched).toBe(rebuilt.totalMatched);
      expect(before[i].prompt).toEqual(rebuiltPrompt);
    }
  });

  test('(c) an append with no hot index is a no-op the next build absorbs', async () => {
    neumaRecall.invalidate(NEUMA_ID);
    const written = await workspace.addObservation(NEUMA_ID, {
      type: 'self-note',
      content: 'a quiet note about the foghorn',
      significance: 0.9,
      source: 'self-authored',
    });
    neumaRecall.appendObservation(NEUMA_ID, written); // no hot index — must not throw
    const buildsBefore = neumaRecall.buildCounts.get(NEUMA_ID) || 0;
    const hits = await neumaRecall.getRelevantMemories(NEUMA_ID, 'foghorn');
    expect(neumaRecall.buildCounts.get(NEUMA_ID) || 0).toBe(buildsBefore + 1); // built once, with the note in
    expect(JSON.stringify(hits)).toContain('foghorn');
  });

  test('(d) invalidate still drops the index (compaction lane untouched)', async () => {
    neumaRecall.invalidate(NEUMA_ID);
    expect(neumaRecall.indexes.has(NEUMA_ID)).toBe(false);
  });

  test('a reader that indexed the persisted record before its append never duplicates it', async () => {
    neumaRecall.invalidate(NEUMA_ID);
    const written = await workspace.addObservation(NEUMA_ID, {
      type: 'self-note', content: 'a unique observation about the brass telescope', significance: 0.9,
    });
    const before = (await neumaRecall.docsFor(NEUMA_ID)).length;
    neumaRecall.appendObservation(NEUMA_ID, written);
    neumaRecall.appendObservation(NEUMA_ID, written);
    const docs = await neumaRecall.docsFor(NEUMA_ID);
    expect(docs.filter((doc) => doc.obsId === written.id)).toHaveLength(1);
    expect(docs).toHaveLength(before);
    expect(neumaRecall.indexes.get(NEUMA_ID).bm25.docCount).toBe(before);
  });
});
