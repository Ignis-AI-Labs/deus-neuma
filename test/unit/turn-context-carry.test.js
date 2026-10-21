// SAY IT ONCE (turn-context-carry.js) — on the local wire each turn's block
// stays in history as sent, and the next block carries only the clock and
// what changed. Driven through the real producers: stablePromptSplit,
// recentConversationMessages (rows with their turnIds) and buildStreamBody.
import { describe, test, expect } from 'vitest';
import { buildStreamBody, systemMessageWithCacheSplit, anchorVolatileAtTurn, composeLocalWireAhead } from '../../backend/services/llm-request-builders.js';
import { stablePromptSplit } from '../../core/runtime/prompt-cache.js';
import { buildPresentSection } from '../../core/runtime/prompt-assembler.js';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { CARRY_NOTE_SHORT, wireContextSections } from '../../backend/services/turn-context-carry.js';
import { recentConversationMessages } from '../../core/runtime/memory-section.js';

const LOCAL = Object.freeze({ provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'qwen3.8', temperature: 0.7, maxTokens: 4096 });

const sections = ({ clock, memory = 'MEMORY: the voice seal', tasks = 'TASKS: ship the taskbar' }) => [
  { id: 'identity', label: 'IDENTITY', text: 'You are Keir.' },
  { id: 'present', label: 'PRESENT MOMENT', text: `PRESENT ${clock}` },
  ...(memory ? [{ id: 'memory', label: 'MEMORY', text: memory }] : []),
  ...(tasks ? [{ id: 'tasks', label: 'WORKING STATE', text: tasks }] : []),
  { id: 'closing', label: 'CLOSING', text: 'CLOSING covenant' },
];

// One turn's wire, as portal-stream builds it: system, transcript, the ask.
const turnWire = ({ connection, chatId = 's1', turnId, rows = [], ask, window = null, ...state }) => {
  const list = sections(state);
  const system = systemMessageWithCacheSplit(list.map((s) => s.text).join('\n\n'), stablePromptSplit(list));
  const messages = [system, ...recentConversationMessages(rows), { role: 'user', content: ask }];
  anchorVolatileAtTurn(messages, { connection, chatId, turnId, window });
  return messages;
};
const send = (messages) => buildStreamBody(LOCAL, messages, {}).messages;
const row = (turnId, content) => ({ role: 'user', content, turnId });
const reply = (turnId, content) => ({ role: 'assistant', content, turnId });

describe('say it once — the local wire carries the per-turn block', () => {
  test('turn 2 keeps turn 1 block byte-for-byte and adds only the clock', () => {
    const connection = {};
    const first = send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    const block1 = first[1].content.slice(0, first[1].content.indexOf('\n\none'));
    expect(block1).toContain('MEMORY: the voice seal');

    const second = send(turnWire({ connection, turnId: 't2', rows: [row('t1', 'one'), reply('t1', 'ok')], ask: 'two', clock: '12:02' }));
    expect(second[0]).toEqual(first[0]); // the stable head
    expect(second[1].content).toBe(first[1].content); // turn 1 exactly as it was sent
    const block2 = second[3].content;
    expect(block2).toContain('PRESENT 12:02');
    expect(block2).toContain('Still standing from earlier in this chat (unchanged): MEMORY, WORKING STATE, CLOSING.');
    expect(block2).not.toContain('MEMORY: the voice seal');
  });

  test('a stamped history row goes back exactly as sent; a row that says something else keeps its render', () => {
    const connection = {};
    const first = send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    const stamped = { ...row('t1', 'one'), timestamp: '2026-10-05T12:01:00.000Z' };
    const second = send(turnWire({ connection, turnId: 't2', rows: [stamped, reply('t1', 'ok')], ask: 'two', clock: '12:02' }));
    expect(second[1].content).toBe(first[1].content); // the (hh:mm) stamp rides the block's own clock

    // An ask sent with a document attached: history holds the words only.
    const withDocs = send(turnWire({ connection, turnId: 't3', rows: [], ask: 'three\n\n<document>x</document>', clock: '12:03' }));
    const block3 = withDocs[1].content.slice(0, withDocs[1].content.indexOf('\n\nthree'));
    const next = send(turnWire({ connection, turnId: 't4', rows: [{ ...row('t3', 'three'), timestamp: '2026-10-05T12:03:00.000Z' }], ask: 'four', clock: '12:04' }));
    expect(next[1].content.startsWith(`${block3}\n\n`)).toBe(true);
    expect(next[1].content).toMatch(/\(\d\d:\d\d [AP]M\) three$/); // the history render, stamp and all
    expect(next[1].content).not.toContain('<document>');
  });

  test('a later block carries the short note and only the clock lines that moved', () => {
    const connection = {};
    const wireAt = (turnId, rows, ask, when) => {
      const list = [
        { id: 'identity', label: 'IDENTITY', text: 'You are Keir.' },
        { id: 'present', label: 'PRESENT MOMENT', text: buildPresentSection(new Date(when), 'Asia/Jakarta') },
        { id: 'closing', label: 'CLOSING', text: 'CLOSING covenant' },
      ];
      const messages = [systemMessageWithCacheSplit(list.map((x) => x.text).join('\n\n'), stablePromptSplit(list)), ...recentConversationMessages(rows), { role: 'user', content: ask }];
      anchorVolatileAtTurn(messages, { connection, chatId: 's1', turnId });
      return send(messages);
    };
    const first = wireAt('t1', [], 'one', '2026-10-05T13:00:00Z');
    expect(first[1].content).toContain('Never infer today');
    const next = wireAt('t2', [row('t1', 'one'), reply('t1', 'ok')], 'two', '2026-10-05T13:05:00Z');
    const block = next[3].content;
    expect(block).toContain(CARRY_NOTE_SHORT);
    expect(block).not.toContain('Never infer today'); // the guidance stands in turn 1's block
    expect(block).toMatch(/## Present Moment\n.*08:05 PM/);
    expect(block).not.toContain('Yesterday was'); // same day: that line stands too
  });

  test('a changed section is sent again; an emptied one says it no longer stands', () => {
    const connection = {};
    send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    const next = send(turnWire({
      connection, turnId: 't2', rows: [row('t1', 'one'), reply('t1', 'ok')], ask: 'two',
      clock: '12:02', memory: 'MEMORY: the taskbar night', tasks: null,
    }));
    const block = next[3].content;
    expect(block).toContain('MEMORY: the taskbar night');
    expect(block).toContain('WORKING STATE: none now — the earlier one no longer stands.');
    expect(block).toContain('(unchanged): CLOSING.');
  });

  test('a section whose carrier left the wire is sent whole again', () => {
    const connection = {};
    send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    // turn 1's row is gone (shed or compacted): nothing of its block stands
    const next = send(turnWire({ connection, turnId: 't2', rows: [reply(null, 'summary')], ask: 'two', clock: '12:02' }));
    expect(next[2].content).toContain('MEMORY: the voice seal');
    expect(next[2].content).toContain('CLOSING covenant');
    expect(next[2].content).not.toContain('Still standing');
  });

  test('every round of one turn sends the same bytes', () => {
    const connection = {};
    send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    const messages = turnWire({ connection, turnId: 't2', rows: [row('t1', 'one'), reply('t1', 'ok')], ask: 'two', clock: '12:02' });
    const round1 = send(messages);
    messages.push({ role: 'assistant', content: 'calling' }, { role: 'user', content: '<tool_response>x</tool_response>' });
    const round2 = send(messages);
    expect(round2.slice(0, round1.length)).toEqual(round1);
  });

  test('a small window drops the oldest half of the carried blocks, and what they carried is sent again', () => {
    const connection = {};
    const rows = [];
    for (let i = 1; i <= 4; i += 1) {
      send(turnWire({ connection, turnId: `t${i}`, rows: [...rows], ask: `ask ${i}`, clock: `12:0${i}`, window: 100000 }));
      rows.push(row(`t${i}`, `ask ${i}`), reply(`t${i}`, 'ok'));
    }
    // The same chat on a window that cannot hold all four blocks.
    const tight = send(turnWire({ connection, turnId: 't5', rows, ask: 'ask 5', clock: '12:05', window: 1180 }));
    const carried = tight.filter((m) => m.role === 'user' && m.content.startsWith('<harness-context>')).length;
    expect(carried).toBeLessThan(5);
    expect(tight[1].content.startsWith('<harness-context>')).toBe(false); // the oldest went first
    const total = tight.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual((1180 - 1024) * 3.6 + 4000); // inside the window, give or take this turn's block
  });

  test('a retry of a carried point sends its sections whole, and the next turn still carries them', () => {
    const connection = {};
    const first = send(turnWire({ connection, turnId: 't1', ask: 'one', clock: '12:01' }));
    expect(first[1].content).toContain('MEMORY: the voice seal');
    // The retry re-runs t1 on the same chat — its own row still in a tail
    // that did not exclude it — under a fresh turn key.
    const retry = send(turnWire({ connection, turnId: 't1', rows: [row('t1', 'one'), reply('t1', 'take one')], ask: 'one', clock: '12:02' }));
    const retryBlock = retry.at(-1).content;
    expect(retryBlock).toContain('MEMORY: the voice seal');
    expect(retryBlock).not.toContain('Still standing');
    // The next fresh turn: t1's block (the retry's, whole) is restored in front of its ask.
    const next = send(turnWire({ connection, turnId: 't2', rows: [row('t1', 'one'), reply('t1', 'take two')], ask: 'two', clock: '12:03' }));
    expect(next.map((m) => m.content).join('\n')).toContain('MEMORY: the voice seal');
  });

  test('without a chat the wire keeps the plain law, byte-identical', () => {
    const plain = send(turnWire({ connection: null, turnId: 't1', ask: 'one', clock: '12:01' }));
    expect(plain[1].content).toMatch(/^<harness-context>\nThe harness's standing context for this turn — the clock, your memory, your working lists\. These are not the operator's words; the operator's message follows this block\.\n\nPRESENT 12:01/);
  });
});

// The gauge (the context:composition event) must describe what rode: the
// sections are counted as portal-stream counts them — the wire built ahead of
// round one (composeLocalWireAhead), the sections through wireContextSections.
describe('say it once — the gauge counts what the carry put on the wire', () => {
  const STABLE_IDS = new Set(['identity']);
  const charsOf = (list) => list.reduce((n, m) => n + m.content.length, 0);
  // One turn's composition sections as portal-stream builds them: the prompt
  // sections, the transcript's words, the operator's ask.
  const contextSectionsFor = (messages, args) => {
    const transcript = messages.slice(1, -1);
    return [
      ...sections(args),
      ...(transcript.length ? [{ id: 'recentConversation', label: 'RECENT CONVERSATION', text: transcript.map((m) => `${m.role}: ${m.content}`).join('\n\n') }] : []),
      { id: 'currentTurn', label: 'CURRENT TURN', text: args.ask },
    ];
  };
  const gaugedTurn = (args) => {
    const messages = turnWire(args);
    composeLocalWireAhead(LOCAL, messages);
    const context = contextSectionsFor(messages, args);
    const before = buildCompositionEvent({ sections: wireContextSections(context, messages[0]) });
    const wire = send(messages); // round one
    const after = buildCompositionEvent({ sections: wireContextSections(context, messages[0]) });
    // What the harness context added: the wire against the same turn with no harness block at all.
    const bare = [{ role: 'system', content: messages[0].cacheSplit.stable }, ...messages.slice(1)];
    const harnessChars = (event) => event.sections
      .filter((s) => !STABLE_IDS.has(s.id) && s.id !== 'recentConversation' && s.id !== 'currentTurn')
      .reduce((n, s) => n + s.chars, 0);
    return { wire, before, after, added: charsOf(wire) - charsOf(bare), harnessChars };
  };

  test('over five turns — a changed section, then a window that drops the oldest blocks — the gauge sums to the wire', () => {
    const connection = {};
    const rows = [];
    const turns = [];
    for (let i = 1; i <= 5; i += 1) {
      const args = {
        connection, turnId: `t${i}`, rows: [...rows], ask: `ask ${i}`, clock: `12:0${i}`,
        window: i === 5 ? 1180 : 100000, ...(i >= 3 ? { memory: 'MEMORY: the taskbar night' } : {}),
      };
      const turn = gaugedTurn(args);
      // Counted before inference, and again after round one: the same wire.
      expect(turn.after.sections).toEqual(turn.before.sections);
      expect(turn.harnessChars(turn.before)).toBe(turn.added);
      expect(turn.before.totals.chars).toBe(turn.before.sections.reduce((n, s) => n + s.chars, 0));
      turns.push(turn);
      rows.push(row(`t${i}`, `ask ${i}`), reply(`t${i}`, 'ok'));
    }
    const ids = (turn) => turn.before.sections.map((s) => s.id);
    // Turn 1 sends every section whole; nothing earlier rides.
    expect(ids(turns[0])).toEqual(['identity', 'harnessFrame', 'present', 'memory', 'tasks', 'closing', 'currentTurn']);
    // Turn 2: only the clock moved — the rest stands in turn 1's block, restored on the wire.
    expect(ids(turns[1])).toEqual(['identity', 'harnessCarry', 'harnessFrame', 'present', 'recentConversation', 'currentTurn']);
    const carry2 = turns[1].before.sections.find((s) => s.id === 'harnessCarry');
    expect(carry2.chars).toBe(turns[1].wire[1].content.length - 'ask 1'.length);
    // Turn 3: the memory changed, so it rides again — counted at what it sent.
    const memory3 = turns[2].before.sections.find((s) => s.id === 'memory');
    expect(memory3.chars).toBe('MEMORY: the taskbar night'.length);
    // Turn 5: the tight window dropped the oldest blocks — the gauge counts only the ones restored.
    const restored = turns[4].wire.filter((m) => m.role === 'user' && m.content.startsWith('<harness-context>')).length - 1;
    expect(restored).toBeLessThan(4);
    const carry5 = turns[4].before.sections.find((s) => s.id === 'harnessCarry');
    expect(carry5.chars).toBeLessThan(turns[3].before.sections.find((s) => s.id === 'harnessCarry').chars);
  });

  test('any other wire is counted exactly as before — same sections, untouched', () => {
    const CLOUD = { provider: 'openai', endpoint: 'https://api.openai.com', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 4096 };
    const args = { connection: {}, turnId: 't1', ask: 'one', clock: '12:01' };
    const messages = turnWire(args);
    composeLocalWireAhead(CLOUD, messages);
    buildStreamBody(CLOUD, messages, {});
    const context = contextSectionsFor(messages, args);
    expect(wireContextSections(context, messages[0])).toBe(context);
  });
});
