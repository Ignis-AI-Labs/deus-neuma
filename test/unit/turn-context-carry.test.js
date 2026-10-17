// SAY IT ONCE (turn-context-carry.js) — on the local wire each turn's block
// stays in history as sent, and the next block carries only the clock and
// what changed. Driven through the real producers: stablePromptSplit,
// recentConversationMessages (rows with their turnIds) and buildStreamBody.
import { describe, test, expect } from 'vitest';
import { buildStreamBody, systemMessageWithCacheSplit, anchorVolatileAtTurn } from '../../backend/services/llm-request-builders.js';
import { stablePromptSplit } from '../../core/runtime/prompt-cache.js';
import { buildPresentSection } from '../../core/runtime/prompt-assembler.js';
import { CARRY_NOTE_SHORT } from '../../backend/services/turn-context-carry.js';
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

  test('without a chat the wire keeps the plain law, byte-identical', () => {
    const plain = send(turnWire({ connection: null, turnId: 't1', ask: 'one', clock: '12:01' }));
    expect(plain[1].content).toMatch(/^<harness-context>\nThe harness's standing context for this turn — the clock, your memory, your working lists\. These are not the operator's words; the operator's message follows this block\.\n\nPRESENT 12:01/);
  });
});
