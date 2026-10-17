// council-session-interrupt.test.js — the interrupt lane and the close:
// aborts, resume, persistence, the ground’s edge. Split from
// council-session.test.js (SIZE-033); bodies byte-identical.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  openCouncil, councilSay, councilInterrupt, closeCouncil, councilResume, councilList, houseCallTool,
} from '../../backend/services/council-session.js';
import { HOUSE_TOOL_NAMES } from '../../backend/services/council-policy.js';
import { readCouncilRecord } from '../../backend/services/council-store.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { neumaWorkspace } from '../../core/index.js';
import {
  ownsNeumaLane, makeConnection, framesOf, lastState, sseResponse, scriptedDeps, WALLET, councilBeforeEach, councilAfterEach,
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

describe('interrupt and close', () => {
  it('the witness cuts a turn mid-word — what streamed stands as the utterance', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST'] },
      speech: { ember: 'HANG' },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    const saying = councilSay(conn, { thought: 'Speak.', urgency: 'now' });
    // Wait for the first streamed chunk, then cut the floor.
    await new Promise((resolve) => {
      const probe = setInterval(() => {
        if (framesOf(conn, 'council:speech').length > 0) { clearInterval(probe); resolve(); }
      }, 10);
    });
    councilInterrupt(conn);
    await saying;
    expect(framesOf(conn, 'council:spoke')).toHaveLength(1);
    const emberRecord = await neumaWorkspace.readSession('ember', councilId);
    const own = emberRecord.find((m) => m.role === 'assistant');
    expect(own.content).toContain('the words that made it out');
  });

  it('closing mid-turn: council:closed is the last word on the wire — no stray spoke frame', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST'] },
      speech: { ember: 'HANG' },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    const saying = councilSay(conn, { thought: 'Speak.', urgency: 'now' });
    await new Promise((resolve) => {
      const probe = setInterval(() => {
        if (framesOf(conn, 'council:speech').length > 0) { clearInterval(probe); resolve(); }
      }, 10);
    });
    closeCouncil(conn);
    await saying;
    const closedAt = conn.frames.findIndex((f) => f.type === 'council:closed');
    expect(closedAt).toBeGreaterThan(-1);
    const after = conn.frames.slice(closedAt + 1).map((f) => f.type);
    expect(after).not.toContain('council:spoke');
    expect(after).not.toContain('council:speech');
  });

  it('a queued witness word is never lost on close — every record carries it, marked undelivered (CQ-029)', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST'] },
      speech: { ember: 'HANG' },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    const first = councilSay(conn, { thought: 'wake the room', urgency: 'now' });
    // Ember's OPEN hand takes the floor and her turn HANGS mid-stream.
    await new Promise((resolve) => {
      const probe = setInterval(() => {
        if (framesOf(conn, 'council:speech').length > 0) { clearInterval(probe); resolve(); }
      }, 10);
    });
    // The witness's 'hold' word queues behind the hanging floor — and the
    // room closes before it is ever granted.
    await councilSay(conn, { thought: 'the word that waits', urgency: 'hold' });
    await closeCouncil(conn);
    await first;

    // Every member's lane carries the queued word — marked undelivered.
    for (const seat of ['ember', 'sable']) {
      const record = await neumaWorkspace.readSession(seat, councilId);
      const queued = record.find((m) => typeof m.content === 'string' && m.content.includes('the word that waits'));
      expect(queued).toBeDefined();
      expect(queued.undelivered).toBe(true);
      expect(queued.role).toBe('user'); // the witness's words, from their seat
    }
    // The witness realm record carries it too, same mark.
    const realm = await readCouncilRecord(WALLET, councilId);
    expect(realm.turns.find((t) => t.content === 'the word that waits').undelivered).toBe(true);
    // Unheard words never became memory (nothing here clears the #119 bar).
    expect(await neumaWorkspace.listObservations('sable')).toEqual([]);
    // The close frame says honestly what was drained.
    expect(framesOf(conn, 'council:closed')[0].undelivered).toBe(1);

    // And a reopened sitting does not replay unheard words into the room.
    const conn2 = makeConnection();
    await councilResume(conn2, { councilId }, { ownsNeumaLane });
    const restored = framesOf(conn2, 'council:opened')[0].transcript;
    expect(restored.some((t) => t.content === 'the word that waits')).toBe(false);
    expect(restored.some((t) => t.content === 'wake the room')).toBe(true);
  });

  it('two words in the same breath: the single-flight pump delivers both, in order', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({ hands: { ember: ['REST', 'REST'], sable: ['REST', 'REST'] } });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    // Fired in the same tick — concurrent ws frames converging on one pump.
    await Promise.all([
      councilSay(conn, { thought: 'First word.', urgency: 'hold' }),
      councilSay(conn, { thought: 'Second word.', urgency: 'hold' }),
    ]);
    expect(framesOf(conn, 'council:said').map((f) => f.content))
      .toEqual(['First word.', 'Second word.']);
  });

  it('close disperses the room; a later word finds no council', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    closeCouncil(conn);
    expect(framesOf(conn, 'council:closed')).toHaveLength(1);
    expect(conn.councilRun).toBeNull();
    await councilSay(conn, { thought: 'still there?', urgency: 'hold' });
    expect(framesOf(conn, 'council:error').at(-1).code).toBe('NO_COUNCIL');
  });

  it('a dissolved council REOPENS from the witness realm — same lanes, the exchange restored', async () => {
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: { ember: ['OPEN'], sable: ['REST', 'REST'] },
      speech: { ember: ['We should hold the east road.'] },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'What do we hold?', urgency: 'hold' });
    closeCouncil(conn);

    // The shelf lists the closed sitting.
    await councilList(conn);
    const shelf = framesOf(conn, 'council:list')[0].councils;
    expect(shelf.map((c) => c.councilId)).toContain(councilId);
    expect(shelf[0].witnessName).toBe('Founder');

    // Reopen: the exchange comes back settled, hands at rest, and the
    // member lanes CONTINUE under the same councilId session.
    await councilResume(conn, { councilId }, { ownsNeumaLane });
    const reopened = framesOf(conn, 'council:opened')[1];
    expect(reopened.councilId).toBe(councilId);
    expect(reopened.transcript.map((t) => t.content)).toEqual([
      'What do we hold?',
      'We should hold the east road.',
    ]);
    // Every restored turn carries WHEN it entered the record — the room's
    // clock stamps survive a dissolve-and-reopen.
    for (const t of reopened.transcript) {
      expect(Number.isNaN(new Date(t.at).getTime())).toBe(false);
    }
    expect(lastState(conn).hands.every((h) => h.hand === 'rest')).toBe(true);

    conn.councilRun.deps = scriptedDeps({ hands: { ember: ['REST'], sable: ['REST'] } });
    await councilSay(conn, { thought: 'Then we continue.', urgency: 'hold' });
    const emberRecord = await neumaWorkspace.readSession('ember', councilId);
    expect(emberRecord.map((m) => m.content)).toEqual([
      'OPERATOR Founder: What do we hold?',
      'We should hold the east road.',
      'OPERATOR Founder: Then we continue.',
    ]);
  });

  it('reopening refuses a record that does not stand, and a seat this wallet lost', async () => {
    const conn = makeConnection();
    await councilResume(conn, { councilId: 'council-777' }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:error')[0].code).toBe('NO_RECORD');

    // A seat lost since the convening refuses at the same gate — resume
    // re-passes ownership, never trusting the old record's word for it.
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    const { councilId } = framesOf(conn, 'council:opened')[0];
    closeCouncil(conn);
    const lostSable = async (c, neumaId) => neumaId !== 'sable' && ownsNeumaLane(c, neumaId);
    await councilResume(conn, { councilId }, { ownsNeumaLane: lostSable });
    expect(framesOf(conn, 'council:error').at(-1).code).toBe('NOT_YOURS');
    expect(conn.councilRun).toBeNull();
  });

  it('a quiet witness: members carry the thread across silences, dormant only when all rest', async () => {
    const conn = makeConnection();
    const deps = {
      ...scriptedDeps({
        // Round 1 (after the witness word): both rest — the floor stays
        // open. Carry 1 finds sable with something to say; sable's spoken
        // turn RE-ARMS the carry, and carry 2 finds ember picking it up.
        // (Sable cannot re-raise on carry 2 — they are the last speaker.)
        // Carry 3 comes back all-rest: the members accepted the quiet, and
        // the room goes dormant until the witness's next word.
        hands: {
          ember: ['REST', 'REST', 'REST', 'HOLD\nI will pick that up.'],
          sable: ['REST', 'HOLD\nI kept thinking about it.', 'REST'],
        },
        speech: {
          sable: ['As I was saying — the east road.'],
          ember: ['Then I will walk it with you.'],
        },
      }),
      carryMs: 40,
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Think on it.', urgency: 'hold' });
    // Nobody spoke; the floor stands open. Wait past three carry thresholds.
    await new Promise((r) => setTimeout(r, 350));
    const spoke = framesOf(conn, 'council:spoke');
    expect(spoke.map((f) => f.neumaId)).toEqual(['sable', 'ember']);
    // Dormant: the last carry round came back all-rest, so the carried
    // flag holds until words land again.
    expect(conn.councilRun.carried).toBe(true);
    closeCouncil(conn);
  });

  it('hands land one by one, with the considering set visible — the round is never dead air', async () => {
    const conn = makeConnection();
    // capacity 1 forces the round serial (ember answers, then sable), so
    // the wire must show the in-between moment: ember's hand already up
    // while sable still considers.
    const deps = scriptedDeps({
      capacity: 1,
      hands: {
        ember: ['HOLD\nMine when you are ready.'],
        sable: ['HOLD\nAnd mine after.'],
      },
      speech: {
        ember: ['First thought.'],
        sable: ['Second thought.'],
      },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Consider it.', urgency: 'hold' });

    const states = framesOf(conn, 'council:state');
    // The round opened with both weighing their hands, all still at rest.
    const opened = states.find((s) =>
      s.considering?.length === 2 && s.hands.every((h) => h.hand === 'rest'));
    expect(opened).toBeDefined();
    // The in-between moment: ember landed HOLD while sable still considers.
    const midway = states.find((s) =>
      s.hands.find((h) => h.neumaId === 'ember')?.hand === 'hold'
      && s.considering?.includes('sable'));
    expect(midway).toBeDefined();
    expect(midway.considering).not.toContain('ember');
    // The room settles with nobody considering.
    expect(states.at(-1).considering).toEqual([]);
    closeCouncil(conn);
  });

  it('the speaking line is numbered on the wire — a late OPEN reads as 1, the early HOLD as 2', async () => {
    // The confusion from the wild: Lifovan held first, another opened later
    // and spoke "out of order". The law is OPEN > HOLD; the wire now says
    // so in numbers, and the grants follow exactly that line.
    const conn = makeConnection();
    const deps = scriptedDeps({
      hands: {
        ember: ['HOLD\nI was first, and I can wait.', 'HOLD\nStill me.'],
        sable: ['OPEN\nThis cannot wait.'],
      },
      speech: {
        sable: ['The urgent thing.'],
        ember: ['And now my patient thing.'],
      },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak.', urgency: 'hold' });

    // A state frame carried the full line: sable (open, later) at 1,
    // ember (hold, earlier) at 2.
    const lined = framesOf(conn, 'council:state').find((s) => {
      const byId = Object.fromEntries(s.hands.map((h) => [h.neumaId, h]));
      return byId.sable?.order === 1 && byId.ember?.order === 2;
    });
    expect(lined).toBeDefined();
    expect(lined.hands.find((h) => h.neumaId === 'sable').hand).toBe('open');
    expect(lined.hands.find((h) => h.neumaId === 'ember').hand).toBe('hold');

    // And the floor followed the line it showed.
    const spoke = framesOf(conn, 'council:spoke');
    expect(spoke.map((f) => f.neumaId)).toEqual(['sable', 'ember']);
    closeCouncil(conn);
  });

  it("the witness's queued word takes its own place in the line", async () => {
    const conn = makeConnection();
    // Ember takes the floor and HOLDS it (a hanging stream keeps the turn
    // open) while sable's HOLD stands. The witness then queues a 'hold'
    // word of their own: their word outranks held hands, so the line reads
    // witness first (witnessOrder 1), sable second (order 2).
    const deps = scriptedDeps({
      hands: { ember: ['OPEN\nMine.'], sable: ['HOLD\nAfter you.'] },
      speech: { ember: 'HANG' },
    });
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    const first = councilSay(conn, { thought: 'Go.', urgency: 'hold' });
    await new Promise((r) => setTimeout(r, 100)); // ember takes and holds the floor
    await councilSay(conn, { thought: 'A thought for after.', urgency: 'hold' });
    const state = framesOf(conn, 'council:state').at(-1);
    expect(state.witnessOrder).toBe(1);
    const sable = state.hands.find((h) => h.neumaId === 'sable');
    expect(sable.hand).toBe('hold');
    expect(sable.order).toBe(2);
    councilInterrupt(conn);
    await first;
    closeCouncil(conn);
  });

  it("a member's raised hand survives a garbled re-poll — the queued turn is never cut off", async () => {
    const conn = makeConnection();
    // Founder's live report (2026-07-17): a neuma raised HOLD to build on
    // another's words and never got to speak. Here sable holds while ember
    // takes the floor first; sable's re-poll after ember's turn comes back
    // as prose (unreadable), which must KEEP the hand standing — under the
    // old lower-on-garble law this exact sequence lost sable's turn.
    const handQueues = { ember: ['OPEN\nMine first.'], sable: ['HOLD\nI want to build on that.'] };
    const deps = {
      ...scriptedDeps({
        speech: {
          ember: ['The east road.'],
          sable: ['And building on that — the west gate.'],
        },
      }),
      ask: async (neumaId) => handQueues[neumaId]?.shift() ?? 'Hmm, I am not sure what to say to that...',
    };
    await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane });
    conn.councilRun.deps = deps;
    await councilSay(conn, { thought: 'Speak.', urgency: 'hold' });
    const spoke = framesOf(conn, 'council:spoke');
    expect(spoke.map((f) => f.neumaId)).toEqual(['ember', 'sable']);
    closeCouncil(conn);
  });

  it('the floor tool loop preserves the text-only catalog, broadcasts acts, and records only speech', async () => {
    const ground = path.join(process.cwd(), 'test', `.house-council-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    await setHouseWorkspace(WALLET, ground);
    const description = 'Text-only council sentinel: preserve this unique description in the system prompt.';
    const calls = [], requests = [];
    const streams = [
      sseResponse([`I will lay the decision down.\n[TOOL: filesystem/write_file {"path": "${ground}/repos/notes/decision.md", "content": "The council decided."}]`]),
      sseResponse(['The record is laid down.']),
    ];
    const deps = {
      ...scriptedDeps({ hands: { ember: ['OPEN\nI will record it.'], sable: ['REST'] } }),
      stream: async (messages, options) => {
        requests.push({ messages, options });
        return streams.shift() ?? sseResponse(['(no more words)']);
      },
      ensureRoots: async () => {},
      tools: () => [{ server: 'filesystem', name: 'write_file', description }],
      callTool: async (run, member, call) => {
        calls.push({ neumaId: member.neumaId, toolName: call.toolName, args: call.args });
        return { content: [{ type: 'text', text: 'written' }] };
      },
    };
    const conn = makeConnection();
    try {
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      expect(framesOf(conn, 'council:opened')[0].houseWorkspace).toBe(path.resolve(ground));
      await councilSay(conn, { thought: 'Record the decision.', urgency: 'hold' });
      expect(requests[0].options).not.toHaveProperty('tools');
      expect(requests[0].messages[0].content).toContain(description);
      expect(calls).toEqual([{
        neumaId: 'ember', toolName: 'write_file',
        args: { path: `${ground}/repos/notes/decision.md`, content: 'The council decided.' },
      }]);
      const toolFrames = framesOf(conn, 'council:tool');
      expect(toolFrames).toHaveLength(2);
      expect(toolFrames[0]).toMatchObject({ neumaId: 'ember', tool: 'write_file', status: 'acting' });
      expect(toolFrames[0].path).toContain('decision.md');
      expect(toolFrames[1]).toMatchObject({ neumaId: 'ember', tool: 'write_file', ok: true });
      expect(toolFrames[1].path).toContain('decision.md');
      expect(framesOf(conn, 'council:spoke')).toHaveLength(1);
      const uttered = conn.councilRun.transcript.at(-1).content;
      expect(uttered).toContain('I will lay the decision down.');
      expect(uttered).toContain('The record is laid down.');
      expect(uttered).not.toContain('[TOOL:');
      closeCouncil(conn);
    } finally {
      rmSync(ground, { recursive: true, force: true });
    }
  });

  it('the real production catalog is complete on the native council wire and the sandbox still confines it', async () => {
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    const { mcpService } = await import('../../backend/services/mcp.js');
    const ground = path.join(process.cwd(), 'test', `.house-real-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(path.join(ground, 'repos'), { recursive: true });
    await setHouseWorkspace(WALLET, ground);
    try {
      await connectFilesystemServer();
      const member = { neumaId: 'ember', name: 'Ember' };
      const run = { grounds: { ember: path.resolve(ground) } };
      await houseCallTool(run, member, {
        toolName: 'write_file', args: { path: path.join(ground, 'repos', 'decision.md'), content: 'The council decided.' },
      });
      const { readFileSync } = await import('node:fs');
      expect(readFileSync(path.join(ground, 'repos', 'decision.md'), 'utf8')).toBe('The council decided.');
      const escape = path.join(realm, 'escape.md');
      await expect(houseCallTool(run, member, {
        toolName: 'write_file', args: { path: escape, content: 'x' },
      })).rejects.toThrow();
      expect(existsSync(escape)).toBe(false);
      const requests = [];
      const deps = scriptedDeps({ hands: { ember: ['OPEN'], sable: ['REST', 'REST'] } });
      const stream = deps.stream;
      deps.stream = async (messages, options) => {
        requests.push({ messages, options });
        return stream(messages, options);
      };
      const conn = makeConnection();
      await openCouncil(conn, { neumaIds: ['ember', 'sable'], witnessName: 'Founder' }, { ownsNeumaLane }, deps);
      await councilSay(conn, { thought: 'Read the native catalog.', urgency: 'hold' });
      const request = requests[0];
      expect(request.options.tools.map((tool) => tool.function.name).sort()).toEqual(
        [...HOUSE_TOOL_NAMES].map((name) => `filesystem__${name}`).sort(),
      );
      const nativeRead = request.options.tools.find((tool) => tool.function.name === 'filesystem__read_text_file');
      expect(nativeRead.function.description).toBeTruthy();
      expect(request.messages[0].content).toContain('filesystem/read_text_file');
      expect(request.messages[0].content).not.toContain(nativeRead.function.description);
      closeCouncil(conn);
    } finally {
      await mcpService.disconnect('filesystem').catch(() => {});
      rmSync(ground, { recursive: true, force: true });
    }
  }, 60_000);

  it('a council without a ground keeps its tools dark', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    expect(framesOf(conn, 'council:opened')[0].houseWorkspace).toBeNull();
    closeCouncil(conn);
  });

  it('an empty or whitespace word is not an utterance', async () => {
    const conn = makeConnection();
    await openCouncil(conn, { neumaIds: ['ember', 'sable'] }, { ownsNeumaLane });
    await councilSay(conn, { thought: '   ', urgency: 'hold' });
    expect(framesOf(conn, 'council:said')).toHaveLength(0);
  });
});


