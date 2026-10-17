// Chat scope — the law that lets one being hold several parallel chats without
// each one's work crowding the others. Pure modules end to end: real inputs,
// real outputs, no mock anywhere in the path (RULE 0).

import { describe, it, expect } from 'vitest';
import { normalizeChatId, safeChatId, isChatId, isLaneWide, splitByChat, chatOf, CHAT_ID_MAX_CHARS } from '../../core/tasks/task-chat.js';
import {
  addTask, updateTask, formatLedgerSection, formatLedgerForBeing, emptyLedger,
} from '../../core/tasks/task-ledger.js';
import {
  addAssigned, updateAssigned, formatAssignedSection, formatOperatorSection, emptyPlan,
} from '../../core/tasks/assigned-plan.js';

const CHAT_A = 'session-1754000000000';
const CHAT_B = 'session-1754999999999';
const stamp = (n) => ({ id: `id-${String(n).padStart(4, '0')}`, now: `2026-08-02T0${n % 10}:00:00.000Z` });

describe('chat scope — the shared law', () => {
  it('normalizes a real session id, and reads absence as lane-wide', () => {
    expect(normalizeChatId(CHAT_A)).toBe(CHAT_A);
    expect(normalizeChatId(`  ${CHAT_A}  `)).toBe(CHAT_A);
    // Every spelling of "no chat" means the same thing: this stands everywhere.
    expect(normalizeChatId(undefined)).toBeNull();
    expect(normalizeChatId(null)).toBeNull();
    expect(normalizeChatId('')).toBeNull();
    expect(normalizeChatId('   ')).toBeNull();
  });

  it('refuses a malformed chat id rather than storing an id nothing can match', () => {
    expect(() => normalizeChatId('../../etc/passwd')).toThrow(/letters, digits, dashes/);
    expect(() => normalizeChatId('session 1754')).toThrow(/letters, digits, dashes/);
    expect(() => normalizeChatId('x'.repeat(CHAT_ID_MAX_CHARS + 1))).toThrow(/under 64/);
    expect(() => normalizeChatId(1754000000000)).toThrow(/as text/);
    // The corrections are tagged so the REST layer answers 400, not 500.
    expect(() => normalizeChatId('bad id')).toThrow(expect.objectContaining({ correction: true }));
  });

  it('reads a SYSTEM-supplied id without throwing — a crooked binding is no chat, not an error', () => {
    // normalizeChatId is for ids someone AUTHORED (their mistake, they hear
    // about it). safeChatId is for `connection.sessionId`, which arrives from
    // a client `portal:resume` frame unvalidated — a being must never be told
    // its own tool call is malformed because its session binding was.
    expect(safeChatId(CHAT_A)).toBe(CHAT_A);
    expect(safeChatId(`  ${CHAT_A}  `)).toBe(CHAT_A);
    for (const crooked of ['../../etc/passwd', 'has spaces', 'x'.repeat(CHAT_ID_MAX_CHARS + 1), 42, null, undefined, '']) {
      expect(safeChatId(crooked)).toBeNull();
      expect(isChatId(crooked)).toBe(false);
    }
    expect(isChatId(CHAT_A)).toBe(true);
  });

  it('the two readers agree on shape — one law, so they cannot drift', () => {
    for (const value of [CHAT_A, 'a', 'x'.repeat(CHAT_ID_MAX_CHARS), 'a_b-c9']) {
      expect(isChatId(value)).toBe(true);
      expect(normalizeChatId(value)).toBe(value);
      expect(safeChatId(value)).toBe(value);
    }
    for (const value of ['a/b', 'a b', 'x'.repeat(CHAT_ID_MAX_CHARS + 1)]) {
      expect(isChatId(value)).toBe(false);
      expect(() => normalizeChatId(value)).toThrow();
      expect(safeChatId(value)).toBeNull();
    }
  });

  it('reads a task\'s chat defensively — anything not a non-empty string is lane-wide', () => {
    expect(chatOf({ chatId: CHAT_A })).toBe(CHAT_A);
    // NULL, never undefined — every surface that asks "is this lane-wide?"
    // relies on this exact contract, and a === null reader and a ?? reader
    // would disagree the moment it drifted.
    for (const absent of [{}, { chatId: '' }, { chatId: 42 }, null, undefined]) {
      expect(chatOf(absent)).toBeNull();
      expect(isLaneWide(absent)).toBe(true);
    }
    expect(isLaneWide({ chatId: CHAT_A })).toBe(false);
  });

  it('splits into this chat and lane-wide, and drops another chat\'s work entirely', () => {
    const tasks = [
      { id: 'a', chatId: CHAT_A },
      { id: 'b', chatId: CHAT_B },
      { id: 'wide' },
      { id: 'a2', chatId: CHAT_A },
    ];
    const { here, laneWide } = splitByChat(tasks, CHAT_A);
    expect(here.map((t) => t.id)).toEqual(['a', 'a2']);
    expect(laneWide.map((t) => t.id)).toEqual(['wide']);
    // Chat B's work is in neither bucket — that is the whole point.
    expect([...here, ...laneWide].map((t) => t.id)).not.toContain('b');
  });

  it('with no chat to scope to, every chatted task is simply not "here"', () => {
    const tasks = [{ id: 'a', chatId: CHAT_A }, { id: 'wide' }];
    expect(splitByChat(tasks, null)).toEqual({ here: [], laneWide: [{ id: 'wide' }] });
    expect(splitByChat(null, CHAT_A)).toEqual({ here: [], laneWide: [] });
  });
});

describe('the being\'s ledger carries its chat', () => {
  it('stores the chat it was taken on in, and stores NOTHING when lane-wide', () => {
    const { task: chatted } = addTask(emptyLedger(), { title: 'In this chat', chatId: CHAT_A }, stamp(1));
    expect(chatted.chatId).toBe(CHAT_A);

    const { task: wide } = addTask(emptyLedger(), { title: 'Everywhere' }, stamp(2));
    // Absence IS lane-wide — the key is not written at all, which is exactly
    // the shape every task recorded before chats existed already has.
    expect('chatId' in wide).toBe(false);
  });

  it('moves work between chats, and back to lane-wide, on update', () => {
    let { ledger, task } = addTask(emptyLedger(), { title: 'Wandering', chatId: CHAT_A }, stamp(1));
    ({ ledger, task } = updateTask(ledger, { id: task.id, chatId: CHAT_B }, stamp(2)));
    expect(task.chatId).toBe(CHAT_B);

    ({ ledger, task } = updateTask(ledger, { id: task.id, chatId: null }, stamp(3)));
    expect('chatId' in task).toBe(false);

    // A chat move alone is a real change — it must not read as "changed nothing".
    expect(() => updateTask(ledger, { id: task.id, chatId: CHAT_A }, stamp(4))).not.toThrow();
  });

  it('WORKING STATE shows this chat and lane-wide work, and hides another chat\'s', () => {
    let ledger = emptyLedger();
    ({ ledger } = addTask(ledger, { title: 'Wire the polarity screen', chatId: CHAT_A }, stamp(1)));
    ({ ledger } = addTask(ledger, { title: 'Draft the launch post', chatId: CHAT_B }, stamp(2)));
    ({ ledger } = addTask(ledger, { title: 'Keep the attempt log pruned' }, stamp(3)));

    const inA = formatLedgerSection(ledger, { chatId: CHAT_A });
    expect(inA).toContain('Wire the polarity screen');
    expect(inA).toContain('Keep the attempt log pruned');
    expect(inA).not.toContain('Draft the launch post');
    expect(inA).toContain('## Working State (this chat)');
    expect(inA).toContain('## Work You Carry In Every Chat');
    // "Standing Work" is the OPERATOR's section name — the being's own
    // lane-wide work must never wear it, or one prompt carries two owners
    // under one header.
    expect(inA).not.toContain('## Standing Work');

    const inB = formatLedgerSection(ledger, { chatId: CHAT_B });
    expect(inB).toContain('Draft the launch post');
    expect(inB).not.toContain('Wire the polarity screen');
  });

  it('a chat holding only lane-wide work says so, and never opens an empty "this chat" block', () => {
    const { ledger } = addTask(emptyLedger(), { title: 'Standing everywhere' }, stamp(1));
    const section = formatLedgerSection(ledger, { chatId: CHAT_A });
    expect(section).toContain('Standing everywhere');
    expect(section).toContain('## Work You Carry In Every Chat');
    expect(section).not.toContain('## Working State (this chat)');
  });

  it('a chat whose only live work belongs to OTHER chats rides no section at all', () => {
    const { ledger } = addTask(emptyLedger(), { title: 'Somewhere else', chatId: CHAT_B }, stamp(1));
    // An empty section never rides the prompt — it would be a header with
    // nothing under it, which reads as a claim with no evidence.
    expect(formatLedgerSection(ledger, { chatId: CHAT_A })).toBe('');
  });

  it('with no chat, the whole ledger rides — a missing chat never hides work', () => {
    let ledger = emptyLedger();
    ({ ledger } = addTask(ledger, { title: 'Alpha work', chatId: CHAT_A }, stamp(1)));
    ({ ledger } = addTask(ledger, { title: 'Beta work', chatId: CHAT_B }, stamp(2)));
    const section = formatLedgerSection(ledger, { chatId: null });
    expect(section).toContain('Alpha work');
    expect(section).toContain('Beta work');
    expect(section).toContain('## Working State (your task ledger)');
  });

  it('task_list hides nothing — it sorts the whole ledger by standing', () => {
    let ledger = emptyLedger();
    ({ ledger } = addTask(ledger, { title: 'Alpha work', chatId: CHAT_A }, stamp(1)));
    ({ ledger } = addTask(ledger, { title: 'Beta work', chatId: CHAT_B }, stamp(2)));
    ({ ledger } = addTask(ledger, { title: 'Everywhere work' }, stamp(3)));

    const listed = formatLedgerForBeing(ledger, { chatId: CHAT_A });
    expect(listed).toContain('Live in this chat:');
    expect(listed).toContain('Alpha work');
    expect(listed).toContain('Live in every chat:');
    expect(listed).toContain('Everywhere work');
    // A deliberate ask gets the whole truth, including the parallel chats.
    expect(listed).toContain('Live in your other chats (not this one):');
    expect(listed).toContain('Beta work');
  });
});

describe('the operator-assigned plan carries its chat', () => {
  it('assigns into one chat, and STANDING WORK narrows to it', () => {
    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'Ship the forge fix', cadence: 'once', chatId: CHAT_A }, stamp(1)));
    ({ plan } = addAssigned(plan, { title: 'Post the changelog', cadence: 'once', chatId: CHAT_B }, stamp(2)));
    ({ plan } = addAssigned(plan, { title: 'Keep the house tidy', cadence: 'baseline' }, stamp(3)));

    const inA = formatAssignedSection(plan, { chatId: CHAT_A });
    expect(inA).toContain('Ship the forge fix');
    expect(inA).toContain('Keep the house tidy');
    expect(inA).not.toContain('Post the changelog');
    expect(inA).toContain('for this chat');
    expect(inA).toContain('for every chat');
  });

  it('re-files assigned work between chats and back to lane-wide', () => {
    let { plan, task } = addAssigned(emptyPlan(), { title: 'Misfiled', cadence: 'once', chatId: CHAT_A }, stamp(1));
    ({ plan, task } = updateAssigned(plan, { id: task.id, chatId: CHAT_B }, stamp(2)));
    expect(task.chatId).toBe(CHAT_B);
    ({ plan, task } = updateAssigned(plan, { id: task.id, chatId: null }, stamp(3)));
    expect('chatId' in task).toBe(false);
  });

  it('a malformed chat on an assignment is a correction, not a 500', () => {
    expect(() => addAssigned(emptyPlan(), { title: 'x', cadence: 'once', chatId: 'a/b' }, stamp(1)))
      .toThrow(expect.objectContaining({ correction: true }));
  });

  it('with no chat, the whole plan rides — unchanged from before chats existed', () => {
    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'Alpha duty', cadence: 'daily', chatId: CHAT_A }, stamp(1)));
    ({ plan } = addAssigned(plan, { title: 'Beta duty', cadence: 'daily', chatId: CHAT_B }, stamp(2)));
    const section = formatAssignedSection(plan, { chatId: null });
    expect(section).toContain('Alpha duty');
    expect(section).toContain('Beta duty');
    expect(section).toContain('## Standing Work (set by your operator)');
  });

  it('the OPERATOR\'S OWN list is never chat-scoped — it is their life, not chat work', () => {
    let plan = emptyPlan();
    ({ plan } = addAssigned(plan, { title: 'Train legs', cadence: 'weekly' }, stamp(1)));
    ({ plan } = addAssigned(plan, { title: 'Renew the passport', cadence: 'milestone', dueDate: '2026-09-01' }, stamp(2)));
    // formatOperatorSection takes no scope at all — every chat sees the whole
    // list, exactly as it did before (Founder's ruling, 2026-08-01).
    const section = formatOperatorSection(plan);
    expect(section).toContain('Train legs');
    expect(section).toContain('Renew the passport');
  });
});

describe('work recorded before chats existed', () => {
  // The migration case, and the one that must never lose anything: a ledger
  // and a plan written by the old code carry no chatId at all.
  const legacyLedger = {
    tasks: [
      { id: 'old-1', title: 'Legacy self-taken work', status: 'open', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
    ],
  };
  const legacyPlan = {
    tasks: [
      { id: 'old-2', title: 'Legacy assigned work', cadence: 'daily', status: 'open', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
    ],
  };

  it('reads as lane-wide and rides EVERY chat — nothing is stranded', () => {
    for (const chatId of [CHAT_A, CHAT_B, null]) {
      expect(formatLedgerSection(legacyLedger, { chatId })).toContain('Legacy self-taken work');
      expect(formatAssignedSection(legacyPlan, { chatId })).toContain('Legacy assigned work');
    }
  });

  it('still settles, and can be adopted into a chat', () => {
    const { task: settled } = updateTask(legacyLedger, { id: 'old-1', status: 'done' }, stamp(1));
    expect(settled.status).toBe('done');
    const { task: adopted } = updateTask(legacyLedger, { id: 'old-1', chatId: CHAT_A }, stamp(2));
    expect(adopted.chatId).toBe(CHAT_A);
  });
});
