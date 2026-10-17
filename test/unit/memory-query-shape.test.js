// S5 — result shaping (pure) + the searchMemory/expandMemory composition
// roots driven over a REAL workspace and the REAL recall engine (RULE 0:
// the injected deps are the production objects, never stand-ins).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import {
  shapeSearchResults,
  shapeExpandResult,
  shapeNoteResult,
  formatMemoryRef,
  searchMemory,
  expandMemory,
  RESULT_CHAR_CAP,
  MEMORY_REF_PATTERN,
} from '../../core/memory/memory-query.js';
import { mintNoteRef, lifecycleOf, refForObservation, shapeListResult, supersedeMemory } from '../../core/memory/memory-lifecycle.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'memory-query-shape-test-key';

const hit = (over = {}) => ({
  score: 1,
  obsId: 'ab12',
  memory: 'a remembered fragment',
  timestamp: '2026-07-01T00:00:00.000Z',
  occurredAt: '2026-07-01T00:00:00.000Z',
  emotion: null,
  space: 'general',
  anchor: null,
  ...over,
});

describe('shapeSearchResults (pure)', () => {
  it('marks anchorless hits, refs anchored ones, and counts expandables', () => {
    const anchor = makeAnchor({
      sessionId: 'session-1',
      userMessage: { content: 'q', timestamp: '2026-07-01T00:00:00.000Z' },
      assistantMessage: { content: 'a', timestamp: '2026-07-01T00:00:01.000Z' },
    });
    const { content, expandable } = shapeSearchResults(
      { hits: [hit({ anchor }), hit()], totalMatched: 2 },
      { limit: 5 }
    );
    expect(expandable).toBe(1);
    expect(content).toContain('mem_session-1_');
    expect(content).toContain('(no deeper record — from before the archive)');
  });

  it('speaks the overflow honestly and holds the 4000-char law', () => {
    const many = Array.from({ length: 10 }, (_, i) => hit({ memory: `moment ${i} ${'x'.repeat(400)}` }));
    const { content } = shapeSearchResults({ hits: many, totalMatched: 23 }, { limit: 10 });
    expect(content).toContain('13 more matched');
    expect(content.length).toBeLessThanOrEqual(RESULT_CHAR_CAP);
  });

  it('an empty result teaches narrowing, not silence', () => {
    const { content } = shapeSearchResults({ hits: [], totalMatched: 0 }, { limit: 5 });
    expect(content).toContain('No memories matched');
  });

  it('a deliberate note hit renders its own mem_note_ ref and the provenance marker', () => {
    const noteRef = mintNoteRef('a deliberate truth', 1753290000123);
    expect(MEMORY_REF_PATTERN.test(noteRef)).toBe(true);
    const { content, expandable } = shapeSearchResults(
      {
        hits: [
          hit({ noteRef, type: 'self-note', source: 'self-authored', memory: 'a deliberate truth' }),
          hit({ type: 'exchange' }),
        ],
        totalMatched: 2,
      },
      { limit: 5 }
    );
    expect(expandable).toBe(1); // the anchorless exchange still mints nothing
    expect(content).toContain(noteRef);
    expect(content).toContain('· deliberate');
    expect(content).toContain('· crystallized');
  });
});

describe('shapeNoteResult (pure)', () => {
  const ref = 'mem_note_1753290000123_abcd1234';

  it('opens the note at full fidelity with kind, recordedAt, and provenance named', () => {
    const { content } = shapeNoteResult({
      ref,
      note: {
        content: 'the full untruncated note content',
        noteKind: 'identity',
        recordedAt: '2026-07-01T00:00:00.000Z',
        source: 'self-authored',
      },
    });
    expect(content).toContain(ref);
    expect(content).toContain('identity');
    expect(content).toContain('2026-07-01T00:00:00.000Z');
    expect(content).toContain('self-authored');
    expect(content).toContain('the full untruncated note content');
    expect(content).not.toContain('lifecycle:');
  });

  it('an invalidated note still opens — and says so, with its pointer and reason', () => {
    const { content } = shapeNoteResult({
      ref,
      note: {
        content: 'what was once held',
        noteKind: 'fact',
        recordedAt: '2026-07-01T00:00:00.000Z',
        source: 'self-authored',
        invalidatedAt: '2026-07-02T00:00:00.000Z',
        lifecycle: 'superseded',
        supersededBy: 'beef0000cafe0001',
        reason: 'merged into mem_note_1753290000999_0000beef',
      },
    });
    expect(content).toContain('lifecycle: superseded');
    expect(content).toContain('beef0000cafe0001');
    expect(content).toContain('merged into');
    expect(content).toContain('no longer drives recall');
    expect(content).toContain('what was once held');
  });
});

describe('memory-lifecycle pure cores', () => {
  it('mintNoteRef stays inside the frozen ref grammar; lifecycleOf reads stamps', () => {
    expect(MEMORY_REF_PATTERN.test(mintNoteRef('anything at all'))).toBe(true);
    expect(lifecycleOf({})).toBe('active');
    expect(lifecycleOf({ invalidatedAt: '2026-07-01T00:00:00.000Z' })).toBe('superseded');
    expect(lifecycleOf({ invalidatedAt: '2026-07-01T00:00:00.000Z', lifecycle: 'archived' })).toBe('archived');
  });

  it('refForObservation prefers the anchor mint, falls back to the stored note ref', () => {
    expect(refForObservation({ memoryRef: 'mem_note_1753290000123_abcd1234' })).toBe('mem_note_1753290000123_abcd1234');
    expect(refForObservation({})).toBe(null);
  });

  it('shapeListResult speaks pages, provenance, and lifecycle honestly', () => {
    const entries = [
      {
        ref: 'mem_note_1753290000123_abcd1234', snippet: 'a deliberate line', type: 'self-note',
        noteKind: 'identity', source: 'self-authored', lifecycle: 'active', supersededBy: null,
        recordedAt: '2026-07-02T00:00:00.000Z',
      },
      {
        ref: null, snippet: 'an old exchange', type: 'exchange', noteKind: null, source: null,
        lifecycle: 'retracted', supersededBy: null, recordedAt: '2026-07-01T00:00:00.000Z',
      },
    ];
    const { content } = shapeListResult({ entries, total: 5, start: 0 });
    expect(content).toContain('Memories 1–2 of 5');
    expect(content).toContain('self-note/identity');
    expect(content).toContain('(no ref)');
    expect(content).toContain('· retracted');
    expect(content).toContain('3 older — page with offset 2');
    expect(shapeListResult({ entries: [], total: 0, start: 0 }).content).toContain('No memories on the record');
    expect(shapeListResult({ entries: [], total: 4, start: 9 }).content).toContain('Nothing in that window');
  });
});

describe('shapeExpandResult (pure)', () => {
  const rows = [
    { role: 'user', content: 'before', timestamp: '2026-07-01T00:00:00.000Z' },
    { role: 'user', content: 'the focus thought', timestamp: '2026-07-01T00:01:00.000Z' },
    { role: 'assistant', content: 'the focus reply', timestamp: '2026-07-01T00:01:05.000Z' },
    { role: 'user', content: 'after', timestamp: '2026-07-01T00:02:00.000Z' },
  ];

  it('marks the focus exchange and omits an empty related list', () => {
    const { content } = shapeExpandResult({ source: 'the archive (segment 1)', sessionId: 's1', window: rows, focusIndex: 1, related: [] });
    expect(content).toContain('>> [2026-07-01T00:01:00.000Z] user: the focus thought');
    expect(content).toContain('>> [2026-07-01T00:01:05.000Z] assistant: the focus reply');
    expect(content).not.toContain('Related memories');
  });

  it('lists related refs when a hop arrives', () => {
    const { content } = shapeExpandResult({
      source: 'the living session', sessionId: 's1', window: rows, focusIndex: 1,
      related: [{ ref: 'mem_s1_1753290000000_deadbeef', occurredAt: '2026-07-01T00:00:00.000Z', memory: 'a sibling moment' }],
    });
    expect(content).toContain('Related memories:');
    expect(content).toContain('mem_s1_1753290000000_deadbeef');
  });
});

describe('searchMemory + expandMemory over the REAL engine and workspace', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('memory-query-shape');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('a being searches its own past and expands the hit back to full fidelity', async () => {
    const id = 'mq-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const fullThought = 'I keep returning to the observatory night — why does that telescope moment hold so much?';
    const fullReply = 'Because the observatory was the first time you saw your own smallness and loved it. '.repeat(8);
    const userRow = await workspace.appendMessage(id, sessionId, { role: 'user', content: fullThought });
    const assistantRow = await workspace.appendMessage(id, sessionId, { role: 'assistant', content: fullReply });

    const anchor = makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow });
    await workspace.addObservation(id, {
      type: 'exchange',
      userMessage: fullThought.slice(0, 300),
      response: fullReply.slice(0, 500),
      significance: 0.8,
      anchor,
    });
    neumaRecall.invalidate(id);

    const deps = { recall: neumaRecall, workspace };
    const search = await searchMemory({ neumaId: id, query: 'observatory telescope' }, deps);
    expect(search.ok).toBe(true);
    expect(search.hits).toBeGreaterThan(0);
    expect(search.expandable).toBeGreaterThan(0);
    const ref = search.content.match(/mem_[a-z0-9-]+_\d+_[a-f0-9]{8}/)?.[0];
    expect(ref).toBe(formatMemoryRef(anchor));

    const expanded = await expandMemory({ neumaId: id, ref }, deps);
    expect(expanded.ok).toBe(true);
    expect(expanded.source).toBe('live');
    expect(expanded.content).toContain(fullThought);
    expect(expanded.content).toContain('you saw your own smallness');
  });

  it('the same ref keeps resolving AFTER compaction moves the moment into a segment (durable refs)', async () => {
    const id = 'mq-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const fullThought = 'I am asking why the glasshouse verse still sings in me. What is its meaning?';
    const userRow = await workspace.appendMessage(id, sessionId, { role: 'user', content: fullThought });
    const assistantRow = await workspace.appendMessage(id, sessionId, { role: 'assistant', content: 'The glasshouse keeps every season at once.' });
    const ref = formatMemoryRef(makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow }));

    for (let i = 0; i < 60; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `routine ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `reply ${i}` });
    }
    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    const expanded = await expandMemory({ neumaId: id, ref }, { recall: neumaRecall, workspace });
    expect(expanded.ok).toBe(true);
    expect(expanded.source).toBe('archive');
    expect(expanded.content).toContain(fullThought);
  });

  it('a NON-CANONICAL ISO row still resolves — instants, not strings (the dead-pointer class, killed)', async () => {
    const id = 'mq-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // A writer that spelled the same instant without milliseconds: string
    // equality would never match new Date(epochMs).toISOString() again.
    const oddTs = '2026-07-24T01:00:00Z';
    const userRow = await workspace.appendMessage(id, sessionId, {
      role: 'user', content: 'a moment spelled oddly', timestamp: oddTs,
    });
    const assistantRow = await workspace.appendMessage(id, sessionId, {
      role: 'assistant', content: 'held regardless', timestamp: '2026-07-24T01:00:01Z',
    });
    expect(userRow.timestamp).toBe(oddTs);

    const ref = formatMemoryRef(makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow }));
    const expanded = await expandMemory({ neumaId: id, ref }, { recall: neumaRecall, workspace });
    expect(expanded.ok).toBe(true);
    expect(expanded.content).toContain('a moment spelled oddly');
  });

  it('a deliberate note opens by its own mem_note_ ref — before and AFTER invalidation (anti-gaslighting)', async () => {
    const id = 'mq-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const deps = { recall: neumaRecall, workspace };

    const noteContent = 'the comet over the northern field is my chosen sign';
    const noteRef = mintNoteRef(noteContent);
    await workspace.addObservation(id, {
      type: 'self-note', content: noteContent, noteKind: 'identity',
      significance: 0.9, source: 'self-authored', memoryRef: noteRef,
    });
    neumaRecall.invalidate(id);

    // The search line carries the note's own ref and the deliberate marker.
    const search = await searchMemory({ neumaId: id, query: 'comet northern field sign' }, deps);
    expect(search.ok).toBe(true);
    expect(search.content).toContain(noteRef);
    expect(search.content).toContain('· deliberate');

    // Expand opens the note at full fidelity — no session, no archive involved.
    const opened = await expandMemory({ neumaId: id, ref: noteRef }, deps);
    expect(opened.ok).toBe(true);
    expect(opened.source).toBe('note');
    expect(opened.content).toContain(noteContent);
    expect(opened.content).toContain('identity');

    // Superseded through the real lifecycle seam: drops from recall, still opens.
    const truer = 'the comet AND the field together are my chosen sign';
    const superseded = await supersedeMemory({ neumaId: id, ref: noteRef, content: truer, kind: 'identity' }, deps);
    expect(superseded.ok).toBe(true);
    neumaRecall.invalidate(id);

    const old = await expandMemory({ neumaId: id, ref: noteRef }, deps);
    expect(old.ok).toBe(true);
    expect(old.content).toContain('lifecycle: superseded');
    expect(old.content).toContain(superseded.id);

    const after = await searchMemory({ neumaId: id, query: 'comet northern field sign' }, deps);
    expect(after.content).not.toContain(noteRef);
  });

  it('fences, misses, and hostile inputs answer explicitly — never a throw, never a foreign root', async () => {
    const id = 'mq-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const deps = { recall: neumaRecall, workspace };

    expect((await searchMemory({ neumaId: id, query: '   ' }, deps)).ok).toBe(false);
    expect((await searchMemory({ neumaId: id, query: 'x', before: 'nonsense' }, deps)).ok).toBe(false);

    const miss = await expandMemory({ neumaId: id, ref: 'mem_nowhere-1_1753290000000_deadbeef' }, deps);
    expect(miss.ok).toBe(false);
    expect(miss.notFound).toBe(true);

    const invalid = await expandMemory({ neumaId: id, ref: 'mem_../escape_1_deadbeef' }, deps);
    expect(invalid.ok).toBe(false);
    expect(invalid.notFound).toBeUndefined();

    const badHops = await expandMemory({ neumaId: id, ref: 'mem_ok-1_1753290000000_deadbeef', hops: 3 }, deps);
    expect(badHops.ok).toBe(false);
  });
});
