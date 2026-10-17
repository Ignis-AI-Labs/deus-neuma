/**
 * THE ASK'S FILLER NEVER RANKS A MEMORY — the production recall path over a
 * real encrypted workspace (RULE 0). Keir, 2026-10-06, live: […] Rankers favour rare words,
 * and filler is rare in stored memories.
 */
import { createTempDir } from '../helpers/temp-fs.js';
import { neumaWorkspace, neumaRecall } from '../../core/index.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { recallQuery } from '../../core/memory/query-words.js';
import { sharedKeyPoints } from '../../core/runtime/memory-section.js';

const { gatherMemoryContext } = __test;
const NEUMA = 'recall-filler';

describe('recall ranks on what the ask is about, not how it is asked', () => {
  beforeAll(async () => {
    neumaWorkspace.root = await createTempDir('recall-filler');
    await neumaWorkspace.create(NEUMA);
    await neumaWorkspace.writeDNA(NEUMA, { identity: { name: 'Filler' } });
    await neumaWorkspace.addObservation(NEUMA, { type: 'exchange', userMessage: 'the lighthouse', response: 'the lighthouse lamp was rebuilt in copper after the storm', significance: 0.9 });
    await neumaWorkspace.addObservation(NEUMA, { type: 'exchange', userMessage: 'please sanitize the github key', response: 'tell me when the key is rotated, please', significance: 0.9 });
    await neumaWorkspace.addObservation(NEUMA, { type: 'exchange', userMessage: 'a hex dump puzzle', response: 'please tell me which offset holds the magic number', significance: 0.9 });
    neumaRecall.invalidate(NEUMA);
  });

  it('a polite ask about the lighthouse recalls the lighthouse first, and the filler-only matches not at all', async () => {
    const mem = await gatherMemoryContext('Please tell me, quickly — what do you remember about the lighthouse?', 'Filler', {}, NEUMA, null);
    const texts = (mem.relevantMemories || []).map((m) => m.memory);
    expect(texts[0]).toMatch(/lighthouse lamp was rebuilt/);
    expect(texts.some((t) => /github key|magic number/.test(t))).toBe(false);
  });

  it('an ask that is ALL filler still searches (unchanged), never an empty query', () => {
    expect(recallQuery('please tell me')).toBe('please tell me');
    expect(recallQuery('Please, tell me about the copper lamp?')).toBe('copper lamp?');
  });

  it('key points never name filler', () => {
    expect(sharedKeyPoints('please tell me about the copper lamp', 'please tell me — the copper lamp was rebuilt')).toEqual(['copper', 'lamp']);
  });
});
