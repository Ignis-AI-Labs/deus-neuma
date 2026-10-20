/**
 * The stream's task rail — pure shaping, called with the real shapes the task
 * API returns (`{ plan, ledger }` from GET /api/v1/tasks/neuma/:id).
 *
 * The rail's whole job is to be honest at a glance while the operator is
 * mid-conversation. Two properties carry that, and both are asserted here:
 *   • the two registers never blur — what the BEING took on ("NOW") and what the
 *     OPERATOR assigned are separate lists, and only the second is settleable
 *   • a rail with nothing to say says so, and never claims a being has no work
 *     while the plan is still loading
 */
import { describe, expect, test } from 'vitest';
import {
  railTitle, liveCount, otherBeings, stepsLabel, railState, ownRows, settledRows,
} from '../../frontend/app/RelinkShell/stream-tasks-view.js';

const task = (over = {}) => ({
  id: 't1', title: 'Hold the post lane', cadence: 'daily', status: 'open',
  createdAt: '2026-07-26T00:00:00.000Z', updatedAt: '2026-07-26T00:00:00.000Z', ...over,
});

const PLAN = {
  tasks: [
    task({ id: 'a', cadence: 'baseline', title: 'hold the daily post lane' }),
    task({ id: 'b', cadence: 'daily', title: 'review tone with Ada' }),
    task({ id: 'c', cadence: 'daily', title: 'read the mentions feed', status: 'done' }),
    task({ id: 'd', cadence: 'milestone', title: 'launch calendar v2' }),
  ],
};

const LEDGER = {
  tasks: [
    task({ id: 'L1', title: 'drafting the launch post', status: 'active' }),
    task({ id: 'L2', title: 'read the brand voice doc', status: 'open' }),
    task({ id: 'L3', title: 'archived thing', status: 'done' }),
  ],
};

const JUNIPER = { neumaId: 'juniper-1', name: 'Juniper' };

describe('stream-tasks-view', () => {
  describe('railTitle', () => {
    test('names the being the rail is about', () => {
      expect(railTitle(JUNIPER)).toBe('TASKS // JUNIPER');
    });
    test('falls back to the lane id, then to the bare word', () => {
      expect(railTitle({ neumaId: 'witness-openai-chatgpt-Fern' })).toBe('TASKS // WITNESS-OPENAI-CHATGPT-FERN');
      expect(railTitle(null)).toBe('TASKS');
    });
  });

  describe('liveCount', () => {
    test('counts only what is still open', () => {
      expect(liveCount(PLAN)).toBe(3);
    });
    test('nothing readable counts as nothing, never NaN', () => {
      expect(liveCount(null)).toBe(0);
      expect(liveCount({})).toBe(0);
    });
  });


  describe('otherBeings', () => {
    const counts = [
      { neumaId: 'juniper-1', name: 'Juniper', kind: 'neuma', count: 3 },
      { neumaId: 'holly-1', name: 'Holly', kind: 'neuma', count: 3 },
      { neumaId: 'witness-kimi-code-Fern', name: 'Fern', kind: 'witness', count: 5 },
      { neumaId: 'birch-1', name: 'Birch', kind: 'neuma', count: 0 },
    ];

    test('heaviest first, then alphabetical, and the rail\'s own being is excluded', () => {
      expect(otherBeings(counts, 'juniper-1').map((o) => o.name)).toEqual(['FERN', 'HOLLY']);
    });

    test('a being with nothing open is omitted — a row reading 0 is noise', () => {
      expect(otherBeings(counts, null).some((o) => o.name === 'BIRCH')).toBe(false);
    });

    test('a witness is marked as one, so the two standings never read alike', () => {
      expect(otherBeings(counts, null).find((o) => o.name === 'FERN').kind).toBe('witness');
      expect(otherBeings(counts, null).find((o) => o.name === 'HOLLY').kind).toBe('neuma');
    });

    test('garbage in, empty out', () => {
      expect(otherBeings(null, null)).toEqual([]);
      expect(otherBeings([{ count: 4 }], null)).toEqual([]); // no id — not addressable
    });
  });

  describe('stepsLabel', () => {
    // REGRESSION: the rail handed React the raw {open, total} object and the
    // whole stream went down with […]
    // (caught in the browser, 2026-07-27). The label is a STRING, always.
    test('counts done steps out of the total, as one string', () => {
      expect(stepsLabel({ subtasks: [{ status: 'done' }, { status: 'open' }, { status: 'done' }] }))
        .toBe('STEPS 2/3');
    });
    test('a task with no checklist prints nothing — never a hollow 0/0', () => {
      expect(stepsLabel({})).toBe('');
      expect(stepsLabel({ subtasks: [] })).toBe('');
    });
    test('every return is a string, whatever goes in', () => {
      for (const input of [null, undefined, {}, { subtasks: [{ status: 'open' }] }]) {
        expect(typeof stepsLabel(input)).toBe('string');
      }
    });
  });

  describe('railState', () => {
    test('a being with work: NOW, the assigned groups by cadence, and the count', () => {
      const bar = railState({ being: JUNIPER, plan: PLAN, ledger: LEDGER, counts: [] });
      expect(bar.show).toBe(true);
      expect(bar.title).toBe('TASKS // JUNIPER');
      // `own` replaced `now`, and it is WIDER on purpose: the rail shows every
      // live goal — taken on (L2) as well as being worked (L1) — because a goal
      // nobody has started is exactly the thing that sits unclosed. L3 is done,
      // so it moves to the CLOSED fold rather than the live list.
      expect(bar.own.map((t) => t.id)).toEqual(['L1', 'L2']);
      expect(bar.own.map((t) => t.state)).toEqual(['active', 'open']);
      expect(bar.settled.map((t) => t.id)).toEqual(['L3']);
      expect(bar.groups.map((g) => g.cadence)).toEqual(['baseline', 'daily', 'milestone']);
      // The settled daily is not in the open groups — it is resting, not standing.
      expect(bar.groups.find((g) => g.cadence === 'daily').tasks.map((t) => t.id)).toEqual(['b']);
      expect(bar.live).toBe(3);
      expect(bar.loading).toBe(false);
      expect(bar.unreadable).toBe(false);
    });

    test('no being (the council room): the rail does not render', () => {
      expect(railState({ being: null, plan: PLAN }).show).toBe(false);
      expect(railState({}).show).toBe(false);
    });

    test('loading is loading — never "this being has no work"', () => {
      const bar = railState({ being: JUNIPER, plan: undefined });
      expect(bar.loading).toBe(true);
      expect(bar.unreadable).toBe(false);
      expect(bar.groups).toEqual([]);
    });

    test('an unreadable plan says so instead of reading as empty', () => {
      const bar = railState({ being: JUNIPER, plan: null });
      expect(bar.loading).toBe(false);
      expect(bar.unreadable).toBe(true);
    });

    test('the foot counts only OTHER beings with live work', () => {
      const bar = railState({
        being: JUNIPER,
        plan: PLAN,
        counts: [
          { neumaId: 'juniper-1', name: 'Juniper', count: 3 },
          { neumaId: 'holly-1', name: 'Holly', count: 2 },
          { neumaId: 'birch-1', name: 'Birch', count: 0 },
        ],
      });
      expect(bar.othersLive).toBe(1);
      expect(bar.others[0].name).toBe('HOLLY');
    });
  });
});

describe('the rail READS a goal\'s state — it never offers to settle it', () => {
  const CHAT = 'session-1754000000001';
  const led = (tasks, focus) => ({ tasks, ...(focus ? { focus: { [CHAT]: focus } } : {}) });
  const worked = { firstAt: '2026-08-03T01:00:00.000Z', lastAt: '2026-08-03T02:00:00.000Z', artifacts: [{ kind: 'wrote', target: '/a.js', at: '2026-08-03T02:00:00.000Z' }] };

  it('puts what is being worked NOW first, then what was interrupted', () => {
    const rows = ownRows(led([
      { id: 'plain', title: 'merely taken on', status: 'open' },
      { id: 'crashed', title: 'left half done', status: 'active', work: worked },
      { id: 'live', title: 'working this', status: 'active' },
    ], 'live'), CHAT, true);
    expect(rows.map((r) => r.id)).toEqual(['live', 'crashed', 'plain']);
    expect(rows.map((r) => r.state)).toEqual(['in-progress', 'interrupted', 'open']);
  });

  it('an INTERRUPTED task says how far it got, so it is resumed not restarted', () => {
    const rows = ownRows(led([{ id: 'crashed', title: 'half done', status: 'active', work: worked }]), CHAT, false);
    expect(rows[0].state).toBe('interrupted');
    expect(rows[0].done).toMatchObject({ count: 1, kinds: ['wrote'] });
  });

  it('with a turn LIVE the focused task reads working, not interrupted', () => {
    // The distinction is the whole crash story: a live turn is still appending
    // to its focus, so only silence means it stopped.
    const l = led([{ id: 'live', title: 'in hand', status: 'active', work: worked }], 'live');
    expect(ownRows(l, CHAT, true)[0].state).toBe('in-progress');
    expect(ownRows(l, CHAT, false)[0].state).toBe('interrupted');
  });

  it('focus belongs to ONE chat — another chat does not inherit it', () => {
    const l = led([{ id: 'live', title: 'in hand', status: 'active' }], 'live');
    expect(ownRows(l, 'session-9999999999999', true)[0].state).toBe('active');
  });

  it('settled goals are a receipt: newest first, capped, always ticked', () => {
    const rows = settledRows(led([
      { id: 'a', title: 'older', status: 'done', completedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'b', title: 'newer', status: 'done', completedAt: '2026-08-03T00:00:00.000Z' },
      { id: 'c', title: 'still open', status: 'open' },
      { id: 'd', title: 'dropped', status: 'dropped' },
    ]), 8);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows.every((r) => r.checked)).toBe(true);
  });

  it('reads an empty or absent ledger as nothing, never a throw', () => {
    for (const junk of [null, undefined, {}, { tasks: null }]) {
      expect(ownRows(junk, CHAT, false)).toEqual([]);
      expect(settledRows(junk)).toEqual([]);
    }
  });

  it('rides railState, so the rail and the being read one truth', () => {
    const bar = railState({
      being: { neumaId: 'juniper' },
      plan: { tasks: [] },
      ledger: led([{ id: 'live', title: 'in hand', status: 'active' }], 'live'),
      chatId: CHAT,
      streaming: true,
    });
    expect(bar.own[0]).toMatchObject({ id: 'live', state: 'in-progress', checked: false });
    expect(bar.settled).toEqual([]);
  });
});

describe('size, blocking, and the order the operator chose', () => {
  const CHAT = 'session-1754000000001';
  const CHAT_B = 'session-1755000000000';
  const led = (tasks, focus) => ({ tasks, ...(focus ? { focus: { [CHAT]: focus } } : {}) });

  it('carries the size onto the row, and says nothing for unsized work', () => {
    const rows = ownRows(led([
      { id: 'a', title: 'sized', status: 'open', size: 'epic' },
      { id: 'b', title: 'unsized', status: 'open' },
    ]), CHAT, false);
    expect(rows.find((r) => r.id === 'a').size).toBe('EPIC');
    expect(rows.find((r) => r.id === 'b').size).toBe('');
  });

  it('SINKS blocked work below everything workable, and names what it waits on', () => {
    const rows = ownRows(led([
      { id: 'blocked', title: 'waits', status: 'active', blockedBy: ['gate'] },
      { id: 'gate', title: 'the gate', status: 'open' },
      { id: 'free', title: 'can be picked up', status: 'open' },
    ]), CHAT, false);
    // A blocked ACTIVE task sits under an unblocked OPEN one: only one of the
    // two can actually be picked up, and that is what the order is answering.
    expect(rows.map((r) => r.id)).toEqual(['gate', 'free', 'blocked']);
    expect(rows.find((r) => r.id === 'blocked').blockers).toEqual([{ id: 'gate', title: 'the gate' }]);
    expect(rows.find((r) => r.id === 'free').blockers).toEqual([]);
  });

  it('resolves a blocker living in ANOTHER CHAT — narrowing must not free it', () => {
    // THE SUBTLE ONE. The rail narrows to this chat before it shapes rows, so a
    // blocker taken up in a parallel conversation is not in the narrowed slice.
    // Resolving against that slice would make the blocker vanish and the row
    // read as free — right up until the focus door refused it with no visible
    // reason. The whole ledger rides along precisely so the two agree.
    const all = [
      { id: 'here', title: 'waits on the other chat', status: 'open', chatId: CHAT, blockedBy: ['far'] },
      { id: 'far', title: 'taken up elsewhere', status: 'active', chatId: CHAT_B },
    ];
    const bar = railState({
      being: { neumaId: 'juniper' }, plan: { tasks: [] },
      ledger: { tasks: all }, chatId: CHAT,
    });
    expect(bar.own.map((r) => r.id)).toEqual(['here']);       // the other chat's work is not shown…
    expect(bar.own[0].blockers).toEqual([{ id: 'far', title: 'taken up elsewhere' }]); // …but it still blocks
  });

  it('orders by size WITHIN a state band, and never above what is being worked', () => {
    const tasks = [
      { id: 'now', title: 'in hand', status: 'active', size: 'quick' },
      { id: 'big', title: 'heavy', status: 'open', size: 'epic' },
      { id: 'small', title: 'light', status: 'open', size: 'quick' },
    ];
    const heaviest = ownRows(led(tasks, 'now'), CHAT, true, { order: 'heaviest' });
    // The focused task stays first even though it is the LIGHTEST thing here:
    // what is being worked right now is a fact, not a preference to sort by.
    expect(heaviest.map((r) => r.id)).toEqual(['now', 'big', 'small']);
    expect(heaviest[0].state).toBe('in-progress');

    const lightest = ownRows(led(tasks, 'now'), CHAT, true, { order: 'lightest' });
    expect(lightest.map((r) => r.id)).toEqual(['now', 'small', 'big']);

    const mine = ownRows(led(tasks, 'now'), CHAT, true, { order: 'mine' });
    expect(mine.map((r) => r.id)).toEqual(['now', 'big', 'small']);
  });

  it('railState reports the order it was given, and defaults to the list\'s own', () => {
    const base = { being: { neumaId: 'juniper' }, plan: { tasks: [] }, ledger: { tasks: [] } };
    expect(railState(base).order).toBe('mine');
    expect(railState({ ...base, order: 'heaviest' }).order).toBe('heaviest');
  });
});
