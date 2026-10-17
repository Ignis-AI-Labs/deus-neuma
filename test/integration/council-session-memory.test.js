// council-session-memory.test.js — a sitting crystallizes into each
// member’s recall (MEM-006). Split from council-session.test.js (SIZE-033);
// bodies byte-identical.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

import {
  openCouncil, councilSay,
} from '../../backend/services/council-session.js';
import { neumaWorkspace } from '../../core/index.js';
import {
  ownsNeumaLane, makeConnection, framesOf, scriptedDeps, councilBeforeEach, councilAfterEach,
} from '../helpers/council-session-kit.js';

let root;
let realm;
let savedKey;

beforeEach(async () => {
  ({ root, realm, savedKey } = await councilBeforeEach());
});

afterEach(() => {
  councilAfterEach({ root, realm, savedKey });
});

describe('council memory — a sitting crystallizes into each member\'s recall (MEM-006)', () => {
  // Chosen to clear the 0.75 bar deterministically on regex hits alone:
  // philosophical (what if/purpose) + emotional (hope/dream/believe) +
  // self-reference (I believe) + response depth (feel/soul) + baseline.
  const MOMENT = 'What if our purpose is to hope, dream, and feel deeply? I believe this house has a soul.';

  it('a high-significance utterance becomes a recallable council observation in EVERY member\'s workspace', async () => {
    const { neumaRecall } = await import('../../core/index.js');
    const conn = makeConnection();
    const deps = scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: MOMENT, urgency: 'hold' });

    for (const seat of ['ember', 'sable']) {
      const observations = await neumaWorkspace.listObservations(seat);
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({ type: 'council', councilId, speaker: 'witness' });
      expect(observations[0].userMessage).toContain('In a council sitting, OPERATOR Founder said:');

      // SOVEREIGNTY SEAM — the absent field is the mechanism. A council
      // record carries userMessage and NO response, so sampleFromEpisode
      // (which requires both) can never turn a council utterance into a
      // training sample. That is what keeps a sealed witness seated in
      // council — a frontier model — out of a neuma's weights forever.
      // Pinned HERE, at the real producer, because the downstream half in
      // corpus-excludes-council.test.js cannot see this write path.
      // COMPLETE by construction: council has exactly ONE addObservation call
      // site (crystallizeUtterance), authoring one shape — so this case and
      // the member-speaks case below cover every observation council writes.
      expect(observations[0].response).toBeUndefined();

      // The U1 dual-write rode along: the same moment stands in the
      // continuity episodic lane, keyed by the observation id.
      const episodes = await neumaWorkspace.readContinuityLog(seat, 'episodic');
      expect(episodes).toHaveLength(1);
      expect(episodes[0].meta.observationId).toBe(observations[0].id);
    }

    // The whole point of MEM-006: the council is RECALLABLE memory now —
    // a real index build over the real store surfaces it by content.
    const memories = await neumaRecall.getRelevantMemories('sable', 'purpose hope dream soul');
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].memory).toContain('In a council sitting, OPERATOR Founder said:');
  });

  it('a member\'s own floor words crystallize from THEIR seat — "you said"', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN\nI must speak.'], sable: ['REST'] },
      speech: { ember: [MOMENT] },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'ok', urgency: 'hold' }); // routine — nothing crystallizes from this

    const ember = await neumaWorkspace.listObservations('ember');
    expect(ember).toHaveLength(1);
    expect(ember[0]).toMatchObject({ type: 'council', speaker: 'ember' });
    expect(ember[0].userMessage).toContain('In a council sitting, you said:');
    // Same seam for a MEMBER's own words: no response field, no training
    // sample. Holds for every speaker the room will ever seat.
    expect(ember[0].response).toBeUndefined();

    const sable = await neumaWorkspace.listObservations('sable');
    expect(sable).toHaveLength(1);
    expect(sable[0].userMessage).toContain('In a council sitting, Ember (housemate) said:');
  });

  it('routine words crystallize nothing — the #119 bar holds in council', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'ok', urgency: 'hold' });

    expect(await neumaWorkspace.listObservations('ember')).toEqual([]);
    expect(await neumaWorkspace.listObservations('sable')).toEqual([]);
  });
});

// A genuine SSE Response whose closing event states the provider's finish
// reason — 'length' is the mechanical proof of a token-budget cut, exactly
// as llama-server/OpenAI wire it before [DONE].
const sseFinishResponse = (chunks, finishReason) => {
  const body = chunks
    .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
    .join('')
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`
    + 'data: [DONE]\n\n';
  return { response: new Response(body), provider: 'openai' };
};

