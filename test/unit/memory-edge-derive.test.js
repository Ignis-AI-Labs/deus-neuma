// S7 — the relation web as a derived view (FR-P3-01 amended): pure
// derivation over docs + communities, deterministic, no stored edges.

import { describe, it, expect } from 'vitest';
import { deriveRelatedRefs, formatMemoryRef } from '../../core/memory/memory-query.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { episodeFromObservation, observationFromEpisode } from '../../core/continuity/integration/crystallize-bridge.js';

const ts = (m) => new Date(1753290000000 + m * 60000).toISOString();
const anchorAt = (sessionId, minute) => makeAnchor({
  sessionId,
  userMessage: { content: `thought ${sessionId} ${minute}`, timestamp: ts(minute) },
  assistantMessage: { content: `reply ${sessionId} ${minute}`, timestamp: ts(minute + 1) },
});
const doc = (obsId, anchor, space = 'general') => ({
  obsId, anchor, space, occurredAt: anchor?.span?.fromTs ?? null, memory: `memory of ${obsId}`,
});

describe('deriveRelatedRefs (pure)', () => {
  const focusAnchor = anchorAt('sess-a', 10);
  const focusKey = {
    sessionId: 'sess-a',
    epochMs: Date.parse(focusAnchor.span.fromTs),
    sha8: focusAnchor.span.userSha8,
  };

  it('session siblings outrank community kin, which outrank space kin; unrelated drop', () => {
    const docs = [
      doc('focus', focusAnchor, 'proj-x'),
      doc('sib-near', anchorAt('sess-a', 12), 'proj-x'),
      doc('sib-far', anchorAt('sess-a', 200), 'proj-x'),
      doc('kin', anchorAt('sess-b', 11), 'general'),
      doc('spacemate', anchorAt('sess-c', 11), 'proj-x'),
      doc('stranger', anchorAt('sess-d', 11), 'general'),
    ];
    const communities = [{ memberIds: ['focus', 'kin'] }];
    const related = deriveRelatedRefs({ ...focusKey, docs, communities });
    expect(related.map((r) => r.ref)).toEqual([
      formatMemoryRef(docs[1].anchor),
      formatMemoryRef(docs[2].anchor),
      formatMemoryRef(docs[3].anchor),
    ]);
    expect(JSON.stringify(related)).not.toContain('stranger');
  });

  it('is deterministic — identical inputs, identical lists (AC-P3-1)', () => {
    const docs = [doc('focus', focusAnchor), doc('b', anchorAt('sess-a', 20)), doc('a', anchorAt('sess-a', 30))];
    const one = deriveRelatedRefs({ ...focusKey, docs, communities: [] });
    const two = deriveRelatedRefs({ ...focusKey, docs, communities: [] });
    expect(one).toEqual(two);
  });

  it('anchorless docs cannot enter the web; an uncrystallized focus still finds session siblings', () => {
    const docs = [
      doc('legacy', null),
      doc('sibling', anchorAt('sess-a', 5)),
      doc('elsewhere', anchorAt('sess-z', 5)),
    ];
    const related = deriveRelatedRefs({ ...focusKey, docs, communities: [] });
    expect(related).toHaveLength(1);
    expect(related[0].ref).toBe(formatMemoryRef(docs[1].anchor));
  });
});

describe('crystallize bridge carries the anchor BOTH directions (FR-P3-01 amended)', () => {
  it('observation → episode → observation keeps the anchor byte-equal', () => {
    const anchor = anchorAt('sess-a', 3);
    const obs = {
      id: 'obs1', type: 'exchange', userMessage: 'u', response: 'r',
      significance: 0.8, space: { id: 'proj-x' }, occurredAt: ts(3), anchor,
    };
    const episode = episodeFromObservation(obs);
    expect(episode.meta.anchor).toEqual(anchor);
    const back = observationFromEpisode({ ...episode, id: 'rec1', recordedAt: ts(4) });
    expect(back.anchor).toEqual(anchor);
  });
});
