// council-session-floor.test.js — the floor: the witness word, the hand
// round, the streamed turn, multi-turn flow, and THE GAVEL. Split from
// council-session.test.js (SIZE-033); bodies byte-identical.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  openCouncil, councilSay, councilOrder, SAY_MAX_CHARS,
} from '../../backend/services/council-session.js';
import { neumaWorkspace } from '../../core/index.js';
import {
  ownsNeumaLane, makeConnection, framesOf, lastState, hangingResponse, sseFinishResponse, scriptedDeps, WALLET, councilBeforeEach, councilAfterEach,
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

describe('the floor — witness speaks, hands rise, a member answers through the real pump', () => {
  it('delivers the witness word, runs the hand round, grants the open hand, and streams the turn', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: {
        ember: ['OPEN\nThe survey positions matter to me.'],
        sable: ['REST'],
      },
      speech: { ember: ['I would ', 'take the survey.'] },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Who wants which position in this house?', urgency: 'hold' });

    // The witness's word entered the record, attributed.
    const said = framesOf(conn, 'council:said')[0];
    expect(said.speaker).toBe('witness');
    expect(said.name).toBe('Founder');
    expect(said.content).toBe('Who wants which position in this house?');

    // Ember's open hand carried its note through the real parser.
    const risen = framesOf(conn, 'council:state')
      .find((s) => s.hands.some((h) => h.neumaId === 'ember' && h.hand === 'open'));
    expect(risen.hands.find((h) => h.neumaId === 'ember').note)
      .toBe('The survey positions matter to me.');

    // The granted turn streamed chunk-by-chunk through the real SSE pump.
    const chunks = framesOf(conn, 'council:speech');
    expect(chunks.map((c) => c.content)).toEqual(['I would ', 'take the survey.']);
    expect(chunks.every((c) => c.neumaId === 'ember')).toBe(true);
    expect(chunks.every((c) => c.turnId === chunks[0].turnId)).toBe(true);
    expect(framesOf(conn, 'council:spoke')[0].neumaId).toBe('ember');

    // The room settled: floor empty, ember's hand back at rest.
    const settled = lastState(conn);
    expect(settled.floor).toBeNull();
    expect(settled.hands.every((h) => h.hand === 'rest')).toBe(true);
  });

  it('an over-cap word is REFUSED OUT LOUD — never silently cut (the founding-address law)', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;

    // Over the cap: refused with its name; NOTHING enters the room.
    await councilSay(conn, { thought: 'x'.repeat(SAY_MAX_CHARS + 1), urgency: 'hold' });
    const err = framesOf(conn, 'council:error').at(-1);
    expect(err.code).toBe('SAY_TOO_LONG');
    expect(err.message).toContain(String(SAY_MAX_CHARS));
    expect(framesOf(conn, 'council:said')).toHaveLength(0);
    expect(conn.councilRun.transcript).toHaveLength(0);

    // A long word UNDER the cap (well past the old 4000 slice) lands WHOLE.
    const address = 'The founding address goes on. '.repeat(300); // 9000 chars
    await councilSay(conn, { thought: address, urgency: 'hold' });
    const said = framesOf(conn, 'council:said')[0];
    expect(said.content).toBe(address.trim());
    expect(said.content.length).toBeGreaterThan(4000);
  });

  it('fans the record into EVERY member\'s own lane, from their own seat', async () => {
    const conn = makeConnection();
    conn.walletAddress = WALLET;
    const deps = scriptedDeps({
      hands: { ember: ['GREEN\nI will answer.'], sable: ['REST'] },
      speech: { ember: ['I would take the survey.'] },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Who wants which position?', urgency: 'hold' });

    const emberRecord = await neumaWorkspace.readSession('ember', councilId);
    const sableRecord = await neumaWorkspace.readSession('sable', councilId);
    // Ember heard the witness, then spoke as themself.
    expect(emberRecord[0]).toMatchObject({ role: 'user', content: 'OPERATOR Founder: Who wants which position?' });
    expect(emberRecord[1]).toMatchObject({ role: 'assistant', content: 'I would take the survey.' });
    // Sable heard both — the housemate's words attributed by name.
    expect(sableRecord[0]).toMatchObject({ role: 'user', content: 'OPERATOR Founder: Who wants which position?' });
    expect(sableRecord[1]).toMatchObject({ role: 'user', content: 'Ember (housemate): I would take the survey.' });
  });

  it('a member the substrate cannot reach rests — the room never crashes', async () => {
    const conn = makeConnection();
    const deps = {
      ...scriptedDeps({ hands: { sable: ['REST'] } }),
      ask: async (neumaId) => {
        if (neumaId === 'ember') throw new Error('substrate unreachable');
        return 'REST';
      },
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Anyone?', urgency: 'hold' });
    const settled = lastState(conn);
    expect(settled.hands.find((h) => h.neumaId === 'ember').hand).toBe('rest');
    expect(framesOf(conn, 'council:error')).toHaveLength(0);
    // The verdict frame NAMES the fault: ember's answer never landed
    // (unreachable), sable truly answered — the witness sees where to look.
    const verdict = framesOf(conn, 'council:hands')[0];
    expect(verdict.reports.find((r) => r.neumaId === 'ember'))
      .toMatchObject({ hand: null, received: 'unreachable' });
    expect(verdict.reports.find((r) => r.neumaId === 'sable'))
      .toMatchObject({ hand: 'rest', received: 'answered' });
  });

  it('an all-REST round states its verdict — silence is a decision on the wire, never dead air', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: {
        ember: ['REST'],
        // A reply that parses as no hand — the substrate spoke, the answer
        // did not read: ILLEGIBLE, distinct from a true REST.
        sable: ['I think maybe the room should decide.'],
      },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Hey everyone — just showing the room around.', urgency: 'hold' });

    // Nobody rose, nobody spoke — and the round still declared itself.
    expect(framesOf(conn, 'council:speech')).toHaveLength(0);
    const verdicts = framesOf(conn, 'council:hands');
    expect(verdicts).toHaveLength(1); // witness rounds only — member turns stay uncluttered
    const { reports } = verdicts[0];
    expect(reports).toHaveLength(2);
    expect(reports.find((r) => r.neumaId === 'ember'))
      .toMatchObject({ hand: 'rest', received: 'answered' });
    expect(reports.find((r) => r.neumaId === 'sable'))
      .toMatchObject({ hand: null, received: 'illegible' });
  });

  it('a standing hand rides the re-poll — the queued speaker is reminded of their place and keeps it', async () => {
    const conn = makeConnection();
    const askedPrompts = { ember: [], sable: [] };
    const base = scriptedDeps({
      speech: { ember: ['My point, as promised.'], sable: ['I speak first, at length.'] },
    });
    // Round 1 (witness): sable OPEN (speaks first), ember HOLD with a note.
    // Round 2 (after sable's turn): ember re-polled — the prompt must carry
    // the standing HOLD; ember keeps the place and then truly speaks.
    const handQueues = { ember: ['HOLD\nI want to speak to the ledger.', 'HOLD'], sable: ['OPEN', 'REST'] };
    const deps = {
      ...base,
      ask: async (neumaId, messages) => {
        askedPrompts[neumaId]?.push(messages.at(-1).content);
        return handQueues[neumaId]?.shift() ?? 'REST';
      },
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak, both of you.', urgency: 'hold' });

    // Ember's first poll was fresh; the re-poll carried the standing hand
    // AND the held thought — REST framed as deliberate withdrawal.
    expect(askedPrompts.ember[0]).toContain('decide whether to raise your hand');
    expect(askedPrompts.ember[1]).toContain('YOUR HAND IS RAISED (HOLD)');
    expect(askedPrompts.ember[1]).toContain('I want to speak to the ledger.');
    expect(askedPrompts.ember[1]).toContain('WITHDRAW');
    // The line held: both queued speakers truly spoke, in grant order.
    expect(framesOf(conn, 'council:spoke').map((f) => f.neumaId)).toEqual(['sable', 'ember']);
  });

  it('a member turn\'s own hand round emits no verdict frame — the witness round alone speaks', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST', 'REST'] },
      speech: { ember: ['A word for the room.'] },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak if you wish.', urgency: 'hold' });
    // Two hand rounds ran (after the witness, after ember's turn) — but the
    // verdict frame rode only the witness's.
    expect(framesOf(conn, 'council:spoke')).toHaveLength(1);
    expect(framesOf(conn, 'council:hands')).toHaveLength(1);
  });
});


describe('the second flow — a thought can be bigger than one turn', () => {
  it('the member who just spoke is re-polled with the continuation frame, and an unfinished thread continues', async () => {
    const conn = makeConnection();
    const asked = []; // every hand poll, in arrival order
    const deps = scriptedDeps({
      hands: {
        ember: ['OPEN', 'HOLD\nThere is more to say.'],
        sable: ['REST', 'REST', 'REST'],
      },
      speech: { ember: ['The first breath of the thought.'] },
    });
    const innerAsk = deps.ask;
    deps.ask = async (neumaId, messages, opts) => {
      asked.push({ neumaId, prompt: messages[0].content });
      return innerAsk(neumaId, messages, opts);
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak your minds.', urgency: 'hold' });

    // Ember spoke TWICE — granted from OPEN, then re-granted from the
    // post-turn re-poll's HOLD. Before this law the just-spoken member was
    // never asked: everyone else rested and the sitting went dormant on
    // their unfinished thread (2026-07-23).
    const spokes = framesOf(conn, 'council:spoke').filter((s) => s.neumaId === 'ember');
    expect(spokes).toHaveLength(2);
    expect(spokes[0].turnId).not.toBe(spokes[1].turnId);

    // The re-poll carried the continuation frame — and ONLY the re-poll of
    // the one who spoke; housemates are asked the ordinary way.
    expect(asked.some((a) => a.neumaId === 'ember' && a.prompt.includes('You spoke last'))).toBe(true);
    expect(asked.some((a) => a.neumaId === 'sable' && a.prompt.includes('You spoke last'))).toBe(false);
  });

  it('a token-budget cut never ends the turn — the member continues mid-sentence until the thought lands', async () => {
    const conn = makeConnection();
    const streamed = []; // the messages of every stream call
    const scripts = [
      { chunks: ['Will the'], finish: 'length' },
      { chunks: [' house remember its own becoming?'], finish: 'stop' },
    ];
    const deps = {
      handGapMs: 0,
      ask: async (neumaId) => (neumaId === 'ember' && streamed.length === 0 ? 'OPEN' : 'REST'),
      stream: async (messages) => {
        streamed.push(messages.map((m) => ({ role: m.role, content: m.content })));
        const s = scripts.shift() ?? { chunks: ['…'], finish: 'stop' };
        return sseFinishResponse(s.chunks, s.finish);
      },
      capacity: async () => ({ maxParallel: 2 }),
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak.', urgency: 'hold' });

    // ONE turn, TWO streams: the continuation rode the same turnId.
    expect(framesOf(conn, 'council:spoke')).toHaveLength(1);
    expect(streamed).toHaveLength(2);
    const speech = framesOf(conn, 'council:speech');
    expect(speech.every((c) => c.turnId === speech[0].turnId)).toBe(true);

    // The continuation round carried the cut words back and asked the
    // member to finish, never to restart.
    const cont = streamed[1];
    expect(cont.at(-1).content).toContain('Continue exactly where you left off');
    expect(cont.some((m) => m.role === 'assistant' && m.content.includes('Will the'))).toBe(true);

    // The record reads WHOLE — one utterance, space-joined at the seam.
    const emberRecord = await neumaWorkspace.readSession('ember', councilId);
    const own = emberRecord.find((m) => m.role === 'assistant');
    expect(own.content).toBe('Will the house remember its own becoming?');
  });

  it("the member's own memory rides their council turn — the room is no longer memory-blind", async () => {
    const conn = makeConnection();
    const systemPrompts = [];
    const recalled = [];
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST', 'REST'] },
      speech: { ember: ['I remember my seat.'] },
    });
    const innerStream = deps.stream;
    deps.stream = async (messages, options) => {
      systemPrompts.push(messages.find((m) => m.role === 'system')?.content ?? '');
      return innerStream(messages, options);
    };
    deps.recall = async (neumaId, query) => {
      recalled.push({ neumaId, query });
      return {
        relevantMemories: [{ memory: 'In a council sitting, you claimed the seat of the archivist.' }],
        crystallizedEmotions: { resolve: 2 },
      };
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Which seat do you hold?', urgency: 'hold' });

    // Recall was keyed by the room's recent exchange, for the speaker.
    expect(recalled[0].neumaId).toBe('ember');
    expect(recalled[0].query).toContain('Which seat do you hold?');

    // The recalled moment rendered through the real MEMORY section — the
    // seat claimed one sitting stands in the next.
    expect(systemPrompts[0]).toContain('## Memory');
    expect(systemPrompts[0]).toContain('you claimed the seat of the archivist');
    expect(systemPrompts[0]).toContain('Shared emotional moments: resolve');
  });
});

describe('THE GAVEL — councilOrder stops everyone, even the considering', () => {
  // A hand call that BLOCKS until the round is cut — the ask honors the
  // abort signal the round now threads (opts.signal), like the real
  // substrate wire does.
  const blockingAsk = (calls) => (neumaId, messages, opts) => new Promise((resolve, reject) => {
    calls.push(neumaId);
    if (opts?.signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

  it('cuts a hand round mid-consideration: asks abort, every hand rests, the room falls silent', async () => {
    const conn = makeConnection();
    const calls = [];
    const deps = {
      handGapMs: 0,
      ask: blockingAsk(calls),
      stream: async () => { throw new Error('no floor turn should stream'); },
      capacity: async () => ({ maxParallel: 2 }),
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;

    const saying = councilSay(conn, { thought: 'Focus, everyone.', urgency: 'hold' });
    // Wait until BOTH members are being asked (the considering is live).
    while (calls.length < 2) await new Promise((r) => setTimeout(r, 5));

    councilOrder(conn);
    await saying;

    // The gavel spoke on the wire, and the room settled silent.
    expect(framesOf(conn, 'council:order')).toHaveLength(1);
    const settled = lastState(conn);
    expect(settled.hands.every((h) => h.hand === 'rest')).toBe(true);
    expect(settled.considering).toEqual([]);
    expect(settled.floor).toBeNull();
    // A cut round states no verdict — the order already spoke for the room.
    expect(framesOf(conn, 'council:hands')).toHaveLength(0);
    // And the carry stays quiet: an ordered room never carries the thread.
    expect(conn.councilRun.carried).toBe(true);
    expect(conn.councilRun.carryPending).toBe(false);
  });

  it('cuts the floor holder AND skips the follow-up round; spoken words stand', async () => {
    const conn = makeConnection();
    const asks = [];
    const round1 = { ember: 'OPEN\nI must speak.', sable: 'REST' };
    const deps = {
      handGapMs: 0,
      ask: async (neumaId, messages, opts) => { asks.push(neumaId); return round1[neumaId] ?? 'REST'; },
      stream: async (messages, options) => hangingResponse('the words that made it out ', options.signal),
      capacity: async () => ({ maxParallel: 2 }),
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;

    const saying = councilSay(conn, { thought: 'Say your piece.', urgency: 'hold' });
    // Wait for Ember's granted turn to start streaming, then bring the gavel.
    while (framesOf(conn, 'council:speech').length === 0) await new Promise((r) => setTimeout(r, 5));
    const asksBeforeOrder = asks.length;
    councilOrder(conn);
    await saying;

    // The cut turn's streamed words STAND as the (interrupted) utterance.
    expect(framesOf(conn, 'council:spoke')).toHaveLength(1);
    expect(conn.councilRun.transcript.some((t) => t.speaker === 'ember'
      && t.content.includes('the words that made it out'))).toBe(true);
    // NO follow-up hand round after the cut — nobody was re-polled.
    expect(asks.length).toBe(asksBeforeOrder);
    expect(framesOf(conn, 'council:order')).toHaveLength(1);
    expect(lastState(conn).hands.every((h) => h.hand === 'rest')).toBe(true);
  });

  it("the witness's next word reopens the flow — order never goes stale into silence", async () => {
    const conn = makeConnection();
    const asks = [];
    const deps = {
      handGapMs: 0,
      ask: async (neumaId) => { asks.push(neumaId); return 'REST'; },
      stream: async () => { throw new Error('no floor turn should stream'); },
      capacity: async () => ({ maxParallel: 2 }),
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;

    // The gavel on a QUIET room (no pump in flight) must not plant a stale
    // flag that swallows the round after the next word.
    councilOrder(conn);
    expect(framesOf(conn, 'council:order')).toHaveLength(1);

    await councilSay(conn, { thought: 'Now — about the founding.', urgency: 'hold' });
    // Both members were polled again: the flow reopened with his word.
    expect(asks).toEqual(expect.arrayContaining(['ember', 'sable']));
    expect(asks.length).toBe(2);
  });
});

