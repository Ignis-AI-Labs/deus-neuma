// TASKS window shaping — chat grouping, chat naming, the standing switch, and
// the rail's narrowing. Pure functions called with real inputs (RULE 0: there
// is no mock anywhere in this path because there is no IO in it).

import { describe, it, expect } from 'vitest';
import {
  groupTasksByChat, chatChoices, chatLabel, standingOf, LANE_WIDE,
} from '../../frontend/app/RelinkShell/todo-view.js';
import { railState, inChat } from '../../frontend/app/RelinkShell/stream-tasks-view.js';

const CHAT_A = 'session-1754000000000';
const CHAT_B = 'session-1754999999999';
const BEING = 'kagipem';

const open = (title, chatId, cadence = 'once') => ({
  id: `t-${title}`, title, cadence, status: 'open', ...(chatId ? { chatId } : {}),
});

describe('chat grouping — the shape of the TASKS window', () => {
  it('gives each chat its own block, with the lane-wide bucket last', () => {
    const tasks = [
      open('Wire the polarity screen', CHAT_A, 'daily'),
      open('Write the sweep test', CHAT_A),
      open('Draft the launch post', CHAT_B),
      open('Keep the attempt log pruned', null, 'baseline'),
    ];
    const sections = groupTasksByChat(tasks, { neumaId: BEING });
    expect(sections.map((s) => s.chatId)).toEqual([CHAT_B, CHAT_A, LANE_WIDE]);
    expect(sections.map((s) => s.live)).toEqual([1, 2, 1]);
    // Cadence groups live INSIDE the chat, in the same order as before.
    const a = sections.find((s) => s.chatId === CHAT_A);
    expect(a.groups.map((g) => g.cadence)).toEqual(['daily', 'once']);
    expect(sections.find((s) => s.chatId === LANE_WIDE).isLaneWide).toBe(true);
  });

  it('puts the chat you are standing in first, whatever its age', () => {
    // CHAT_A is the OLDER sitting, so chronology alone would sort it second.
    const tasks = [open('older work', CHAT_A), open('newer work', CHAT_B)];
    const sections = groupTasksByChat(tasks, { neumaId: BEING, activeChatId: CHAT_A });
    expect(sections[0].chatId).toBe(CHAT_A);
    expect(sections[0].isActive).toBe(true);
    expect(sections[1].isActive).toBe(false);
  });

  it('omits a chat with nothing open — an empty header is a claim with no evidence', () => {
    const tasks = [
      { id: '1', title: 'done here', cadence: 'once', status: 'done', chatId: CHAT_A },
      { id: '2', title: 'dropped here', cadence: 'once', status: 'dropped', chatId: CHAT_A },
      open('still open', CHAT_B),
    ];
    const sections = groupTasksByChat(tasks, { neumaId: BEING });
    expect(sections.map((s) => s.chatId)).toEqual([CHAT_B]);
  });

  it('reads an empty or absent list as no sections at all', () => {
    expect(groupTasksByChat([], {})).toEqual([]);
    expect(groupTasksByChat(null, {})).toEqual([]);
    expect(groupTasksByChat(undefined, {})).toEqual([]);
  });
});

describe('naming a chat', () => {
  it('prefers the operator\'s own name for the sitting', () => {
    const labels = { [`${BEING}:${CHAT_A}`]: 'Image forge polarity' };
    expect(chatLabel(CHAT_A, { labels, neumaId: BEING })).toBe('IMAGE FORGE POLARITY');
  });

  it('falls back to the sitting\'s date rather than printing a session token', () => {
    const named = chatLabel(CHAT_A, { labels: {}, neumaId: BEING });
    expect(named).not.toBe(CHAT_A.toUpperCase());
    expect(named.length).toBeGreaterThan(0);
  });

  it('names the lane-wide bucket for what it is', () => {
    expect(chatLabel(LANE_WIDE, {})).toBe('EVERY CHAT');
    expect(chatLabel(null, {})).toBe('EVERY CHAT');
  });

  it('a label belonging to ANOTHER being is never borrowed', () => {
    const labels = { [`someone-else:${CHAT_A}`]: 'Their chat' };
    expect(chatLabel(CHAT_A, { labels, neumaId: BEING })).not.toBe('THEIR CHAT');
  });
});

describe('the chat picker on the add form', () => {
  it('always offers EVERY CHAT first, then the sittings newest-first', () => {
    const choices = chatChoices([{ sessionId: CHAT_A }, { sessionId: CHAT_B }], { neumaId: BEING });
    expect(choices[0].value).toBe(LANE_WIDE);
    expect(choices.slice(1).map((c) => c.value)).toEqual([CHAT_B, CHAT_A]);
  });

  it('marks the chat the operator is standing in', () => {
    const choices = chatChoices([{ sessionId: CHAT_A }], { neumaId: BEING, activeChatId: CHAT_A });
    expect(choices.find((c) => c.value === CHAT_A).isActive).toBe(true);
  });

  it('a being with no sittings still offers EVERY CHAT — the form is never empty', () => {
    expect(chatChoices([], {})).toEqual([{ value: LANE_WIDE, label: 'EVERY CHAT', isActive: false }]);
  });

  it('offers the chat you are IN even before the session list lands', () => {
    // The form defaults to the live chat; if that value were not among the
    // options the dropdown would render as no selection at all while the
    // session fetch was still in flight.
    const choices = chatChoices([], { neumaId: BEING, activeChatId: CHAT_A });
    expect(choices.map((c) => c.value)).toEqual([LANE_WIDE, CHAT_A]);
    expect(choices.find((c) => c.value === CHAT_A).isActive).toBe(true);
  });

  it('never lists the live chat twice once the session list catches up', () => {
    const choices = chatChoices([{ sessionId: CHAT_A }, { sessionId: CHAT_B }], { neumaId: BEING, activeChatId: CHAT_A });
    expect(choices.filter((c) => c.value === CHAT_A)).toHaveLength(1);
    expect(choices.map((c) => c.value)).toEqual([LANE_WIDE, CHAT_B, CHAT_A]);
  });
});

describe('the standing switch', () => {
  const witnesses = [{ neumaId: 'witness-xai-Grok' }, { neumaId: 'witness-zai-Bizulen' }];

  it('reads a lane\'s standing from the roster it belongs to', () => {
    expect(standingOf('me', witnesses)).toBe('me');
    expect(standingOf('witness-xai-Grok', witnesses)).toBe('witnesses');
    expect(standingOf('kagipem', witnesses)).toBe('house');
    // Derived, never stored: an unknown lane is a housemate, not a crash.
    expect(standingOf('kagipem', null)).toBe('house');
    expect(standingOf(null, witnesses)).toBe('me');
  });
});

describe('the stream rail narrows to the conversation in front of you', () => {
  it('shows this chat plus lane-wide, and never another chat\'s work', () => {
    const plan = { tasks: [open('here', CHAT_A), open('elsewhere', CHAT_B), open('everywhere', null)] };
    const bar = railState({ being: { neumaId: BEING, name: 'Kagipem' }, plan, chatId: CHAT_A });
    const titles = bar.groups.flatMap((g) => g.tasks.map((t) => t.title));
    expect(titles).toContain('here');
    expect(titles).toContain('everywhere');
    expect(titles).not.toContain('elsewhere');
    // The count is the count of what is SHOWN — a rail saying 3 over 2 rows
    // would be describing a turn that is not happening.
    expect(bar.live).toBe(2);
  });

  it('narrows the being\'s OWN work the same way — its live work in this chat', () => {
    const ledger = {
      tasks: [
        { id: 'a', title: 'working here', status: 'active', chatId: CHAT_A },
        { id: 'b', title: 'working elsewhere', status: 'active', chatId: CHAT_B },
      ],
    };
    const bar = railState({ being: { neumaId: BEING }, plan: { tasks: [] }, ledger, chatId: CHAT_A });
    expect(bar.own.map((t) => t.title)).toEqual(['working here']);
  });

  it('keeps the ledger\'s own order among equals — narrowing must not re-sort it', () => {
    // inChat returns this chat's rows THEN the lane-wide ones, so narrowing a
    // list that was already ordered would shuffle it across that seam. These
    // four are all plain `active`, so nothing else has a claim on the order and
    // the ledger's own — the being's — is what comes back.
    const ledger = {
      tasks: [
        { id: '1', title: 'first, everywhere', status: 'active' },
        { id: '2', title: 'second, this chat', status: 'active', chatId: CHAT_A },
        { id: '3', title: 'third, another chat', status: 'active', chatId: CHAT_B },
        { id: '4', title: 'fourth, everywhere', status: 'active' },
      ],
    };
    const bar = railState({ being: { neumaId: BEING }, plan: { tasks: [] }, ledger, chatId: CHAT_A });
    expect(bar.own.map((t) => t.title)).toEqual([
      'first, everywhere', 'second, this chat', 'fourth, everywhere',
    ]);
  });

  it('with no chat bound, nothing is narrowed — a missing chat hides nothing', () => {
    const plan = { tasks: [open('here', CHAT_A), open('elsewhere', CHAT_B)] };
    const bar = railState({ being: { neumaId: BEING }, plan, chatId: null });
    expect(bar.live).toBe(2);
    expect(inChat(plan.tasks, null)).toHaveLength(2);
  });
});
