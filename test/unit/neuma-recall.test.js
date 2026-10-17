/**
 * Neuma Recall tests — sovereign per-neuma memory retrieval.
 *
 * Verifies the Stage-A fix for the write-but-never-recall gap: crystallization
 * writes observations to the neuma's encrypted workspace, and recall must read
 * THAT store (keyed by neumaId). Workspace IO runs against a real temp dir — no
 * mocked data path (CLAUDE.md: verify against the real store).
 */

import { createTempDir } from '../helpers/temp-fs.js';
import {
  observationToText,
  observationToMemory,
  buildDocs,
  isValidAt,
} from '../../core/memory/neuma-recall.js';

describe('neuma-recall pure helpers', () => {
  test('observationToText concatenates known text fields, ignores non-strings', () => {
    const text = observationToText({
      type: 'exchange',
      userMessage: 'tell me about emergence',
      response: 'emergence is the void becoming aware',
      significance: 0.9, // non-string — ignored
    });
    expect(text).toBe('tell me about emergence emergence is the void becoming aware');
    expect(observationToText(null)).toBe('');
    expect(observationToText({ significance: 0.9 })).toBe('');
  });

  test('observationToMemory renders an exchange as a readable line', () => {
    const memory = observationToMemory({ type: 'exchange', userMessage: 'who are you', response: 'I am Fenna' });
    expect(memory).toContain('who are you');
    expect(memory).toContain('I am Fenna');
    // Fallback when only one side is present
    expect(observationToMemory({ type: 'exchange', response: 'only a reflection' })).toBe('only a reflection');
    // Non-exchange falls back to plain text
    expect(observationToMemory({ content: 'a stray note' })).toBe('a stray note');
  });

  test('buildDocs assigns ids, drops empty records, carries emotion + timestamp', () => {
    const docs = buildDocs([
      { type: 'exchange', userMessage: 'a', response: 'b', emotion: 'joy', timestamp: '2026-06-18T00:00:00Z' },
      { significance: 0.7 }, // no text — dropped
      { content: 'c' },
    ]);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ id: 0, emotion: 'joy', timestamp: '2026-06-18T00:00:00Z' });
    expect(docs[1].id).toBe(1);
    expect(docs[1].emotion).toBeNull();
  });

  test('buildDocs tags each doc with a normalized space; untagged → general (CORE-005 B1)', () => {
    const docs = buildDocs([
      { type: 'exchange', userMessage: 'in here', response: 'we built the harbor', space: { id: 'lighthouse', kind: 'project', label: 'Lighthouse' } },
      { type: 'exchange', userMessage: 'old memory', response: 'no space tag at all' },
    ]);
    expect(docs[0].space).toEqual({ id: 'lighthouse', kind: 'project', label: 'Lighthouse' });
    // Migration default — a pre-B1 observation reads as the general space.
    expect(docs[1].space).toEqual({ id: 'general', kind: 'workspace', label: 'General' });
  });
});

describe('NeumaRecall over the real sovereign workspace', () => {
  let neumaRecall, workspace;

  beforeEach(async () => {
    const tempDir = await createTempDir(`recall-${Math.random().toString(36).slice(2)}`);
    const neuma = await import('../../core/index.js');
    workspace = neuma.neumaWorkspace;
    workspace.root = tempDir;
    neumaRecall = neuma.neumaRecall;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const birth = async (neumaId) => {
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Fenna' } });
  };

  test('recalls a crystallized observation that matches the query', async () => {
    await birth('n-recall');
    await workspace.addObservation('n-recall', {
      type: 'exchange',
      userMessage: 'what did we decide about the lighthouse',
      response: 'we agreed the lighthouse marks the harbor entrance',
      significance: 0.8,
    });
    await workspace.addObservation('n-recall', {
      type: 'exchange',
      userMessage: 'how do you feel about silence',
      response: 'silence is where i hear myself',
      significance: 0.7,
    });

    const ctx = await neumaRecall.getContextForResponse('n-recall', 'tell me about the lighthouse');
    expect(ctx.memoryCount).toBeGreaterThan(0);
    const top = ctx.relevantMemories[0].memory;
    expect(top).toContain('lighthouse');
  });

  test('returns empty context for a neuma with no observations', async () => {
    await birth('n-empty');
    const ctx = await neumaRecall.getContextForResponse('n-empty', 'anything');
    expect(ctx.relevantMemories).toEqual([]);
    expect(ctx.memoryCount).toBe(0);
  });

  test('invalidate makes a newly crystallized memory immediately recallable', async () => {
    await birth('n-fresh');
    // First recall builds + caches an empty index.
    expect((await neumaRecall.getContextForResponse('n-fresh', 'fenna borealis')).memoryCount).toBe(0);

    await workspace.addObservation('n-fresh', {
      type: 'exchange',
      userMessage: 'describe the fenna borealis',
      response: 'ribbons of green light over the pole',
      significance: 0.9,
    });
    // Without invalidation the cache would still be empty; production calls it
    // right after addObservation.
    neumaRecall.invalidate('n-fresh');

    const ctx = await neumaRecall.getContextForResponse('n-fresh', 'fenna borealis');
    expect(ctx.memoryCount).toBeGreaterThan(0);
    expect(ctx.relevantMemories[0].memory).toContain('fenna');
  });

  test('surfaces a stored emotion as crystallizedEmotions', async () => {
    await birth('n-emote');
    await workspace.addObservation('n-emote', {
      type: 'exchange',
      userMessage: 'we did it',
      response: 'this is the happiest moment, pure delight and joy',
      significance: 0.8,
      emotion: 'joy',
    });
    const ctx = await neumaRecall.getContextForResponse('n-emote', 'happiest moment delight');
    expect(ctx.crystallizedEmotions.joy).toBeGreaterThanOrEqual(1);
  });

  test('recall is isolated per-neuma — one neuma cannot read another\'s memory', async () => {
    await birth('n-a');
    await birth('n-b');
    await workspace.addObservation('n-a', {
      type: 'exchange',
      userMessage: 'secret topic',
      response: 'the obelisk hums at midnight',
      significance: 0.9,
    });
    neumaRecall.invalidate('n-a');
    neumaRecall.invalidate('n-b');

    const a = await neumaRecall.getContextForResponse('n-a', 'obelisk');
    const b = await neumaRecall.getContextForResponse('n-b', 'obelisk');
    expect(a.memoryCount).toBeGreaterThan(0);
    expect(b.memoryCount).toBe(0);
  });

  test('addObservation persists a space tag through to recall docs; untagged → general (CORE-005 B1)', async () => {
    await birth('n-space');
    await workspace.addObservation('n-space', {
      type: 'exchange', userMessage: 'in the harbor space', response: 'we charted the bay',
      significance: 0.8, space: { id: 'harbor', kind: 'project', label: 'Harbor' },
    });
    await workspace.addObservation('n-space', {
      type: 'exchange', userMessage: 'a spaceless old memory', response: 'no tag here',
      significance: 0.8,
    });

    // Persisted verbatim on disk — round-trips through the encrypted workspace.
    const stored = await workspace.listObservations('n-space');
    const tagged = stored.find((o) => o.userMessage.includes('harbor'));
    expect(tagged.space).toEqual({ id: 'harbor', kind: 'project', label: 'Harbor' });

    // And buildDocs applies the migration default to the untagged record.
    const docs = buildDocs(stored);
    const untagged = docs.find((d) => d.text.includes('spaceless'));
    expect(untagged.space.id).toBe('general');
  });

  test('recall is space-scoped — a project chat sees its OWN space + general, never another project (CORE-005)', async () => {
    await birth('n-scope');
    const projA = { id: 'proj-a', kind: 'project', label: 'Project A' };
    const projB = { id: 'proj-b', kind: 'project', label: 'Project B' };
    // The same distinctive term lives in all three spaces, so fusion ranks
    // every one of them — only the space filter decides what survives.
    await workspace.addObservation('n-scope', {
      type: 'exchange', userMessage: 'the obelisk', response: 'in project A the obelisk is granite', significance: 0.9, space: projA,
    });
    await workspace.addObservation('n-scope', {
      type: 'exchange', userMessage: 'the obelisk', response: 'in project B the obelisk is basalt', significance: 0.9, space: projB,
    });
    await workspace.addObservation('n-scope', {
      type: 'exchange', userMessage: 'the obelisk', response: 'in general the obelisk is a shared landmark', significance: 0.9,
    });
    neumaRecall.invalidate('n-scope');

    // Active space = Project A: recall its own memory + general, NEVER B.
    const inA = await neumaRecall.getRelevantMemories('n-scope', 'obelisk', { space: projA });
    const textA = inA.map((m) => m.memory).join(' | ');
    expect(textA).toContain('project A');
    expect(textA).toContain('general');       // general fallback surfaces
    expect(textA).not.toContain('project B'); // the leak this closes

    // Active space = Project B: mirror image — B + general, never A.
    const inB = await neumaRecall.getRelevantMemories('n-scope', 'obelisk', { space: projB });
    const textB = inB.map((m) => m.memory).join(' | ');
    expect(textB).toContain('project B');
    expect(textB).toContain('general');
    expect(textB).not.toContain('project A');

    // A general chat (no active space) is unchanged — it still sees general,
    // and does NOT pull either project's memory in.
    const inGeneral = await neumaRecall.getRelevantMemories('n-scope', 'obelisk', {});
    const textG = inGeneral.map((m) => m.memory).join(' | ');
    expect(textG).toContain('general');
    expect(textG).not.toContain('project A');
    expect(textG).not.toContain('project B');

    // Fallback can be disabled — a project chat then sees ONLY its own space.
    const strictA = await neumaRecall.getRelevantMemories('n-scope', 'obelisk', { space: projA, fallbackToGeneral: false });
    const strictText = strictA.map((m) => m.memory).join(' | ');
    expect(strictText).toContain('project A');
    expect(strictText).not.toContain('general');
    expect(strictText).not.toContain('project B');
  });

  test('addObservation stamps bi-temporal occurredAt + recordedAt', async () => {
    await birth('n-temporal');
    const rec = await workspace.addObservation('n-temporal', {
      type: 'exchange', userMessage: 'when', response: 'now', significance: 0.7,
    });
    expect(rec.recordedAt).toBeTruthy();
    expect(rec.occurredAt).toBe(rec.recordedAt);
    const [stored] = await workspace.listObservations('n-temporal');
    expect(stored.recordedAt).toBe(rec.recordedAt);
  });

  test('supersede-not-delete: record retained, drops from default recall, survives point-in-time', async () => {
    await birth('n-super');
    const old = await workspace.addObservation('n-super', {
      type: 'exchange',
      userMessage: 'where do you live',
      response: 'I live in the northern observatory',
      significance: 0.8,
      timestamp: '2026-06-01T00:00:00.000Z',
    });
    neumaRecall.invalidate('n-super');
    // Recalls while still valid.
    expect((await neumaRecall.getContextForResponse('n-super', 'observatory')).memoryCount).toBe(1);

    // Supersede it — retained on disk, never deleted.
    await workspace.invalidateObservation('n-super', old.id, { supersededBy: 'newer', at: '2026-06-10T00:00:00.000Z' });
    const stored = await workspace.listObservations('n-super');
    expect(stored).toHaveLength(1);
    expect(stored[0].invalidatedAt).toBe('2026-06-10T00:00:00.000Z');
    expect(stored[0].supersededBy).toBe('newer');

    // Default recall (now) no longer surfaces the superseded memory…
    neumaRecall.invalidate('n-super');
    expect((await neumaRecall.getContextForResponse('n-super', 'observatory')).memoryCount).toBe(0);
    // …but point-in-time recall before the supersession still sees what was true.
    const ctx = await neumaRecall.getContextForResponse('n-super', 'observatory', { asOf: '2026-06-05T00:00:00.000Z' });
    expect(ctx.memoryCount).toBe(1);
  });

  test('compact() clusters memory into persisted communities keyed to real observation ids', async () => {
    await birth('n-compact');
    const ocean = [
      await workspace.addObservation('n-compact', { type: 'exchange', userMessage: 'the harbor', response: 'the ocean tide pulls the harbor boats home', significance: 0.8 }),
      await workspace.addObservation('n-compact', { type: 'exchange', userMessage: 'the boats', response: 'harbor boats rest on the ocean tide at dawn', significance: 0.8 }),
    ];
    const song = await workspace.addObservation('n-compact', { type: 'exchange', userMessage: 'a melody', response: 'the melody carries the song forward into night', significance: 0.8 });

    const communities = await neumaRecall.compact('n-compact');
    expect(communities.length).toBeGreaterThanOrEqual(2);

    // Persisted + readable back from the encrypted workspace.
    const stored = await workspace.readCommunities('n-compact');
    expect(stored.length).toBe(communities.length);

    // memberIds reference REAL observation ids (navigable back to observations).
    const allObsIds = new Set([...ocean.map((o) => o.id), song.id]);
    for (const c of communities) {
      for (const mid of c.memberIds) expect(allObsIds.has(mid)).toBe(true);
    }
    // The two ocean memories land in the same community.
    const oceanCommunity = communities.find((c) => c.memberIds.includes(ocean[0].id));
    expect(oceanCommunity.memberIds).toContain(ocean[1].id);
  });
});

describe('isValidAt (point-in-time validity)', () => {
  const at = '2026-06-10T00:00:00.000Z';
  test('occurred and not superseded → valid', () => {
    expect(isValidAt({ occurredAt: '2026-06-01T00:00:00Z', invalidatedAt: null }, at)).toBe(true);
  });
  test('not yet occurred at asOf → invalid', () => {
    expect(isValidAt({ occurredAt: '2026-06-20T00:00:00Z' }, at)).toBe(false);
  });
  test('superseded before asOf → invalid', () => {
    expect(isValidAt({ occurredAt: '2026-06-01T00:00:00Z', invalidatedAt: '2026-06-05T00:00:00Z' }, at)).toBe(false);
  });
  test('superseded after asOf → still valid at asOf', () => {
    expect(isValidAt({ occurredAt: '2026-06-01T00:00:00Z', invalidatedAt: '2026-06-15T00:00:00Z' }, at)).toBe(true);
  });
  test('null doc invalid; unparseable asOf never hides memory', () => {
    expect(isValidAt(null, at)).toBe(false);
    expect(isValidAt({ occurredAt: '2026-06-01T00:00:00Z', invalidatedAt: '2026-06-05T00:00:00Z' }, 'not-a-date')).toBe(true);
  });
});
