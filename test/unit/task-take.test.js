// TAKING UP ASSIGNED WORK — the pure half. No mocks anywhere: these are pure
// functions called with real data structures, asserted on their real output.
//
// What this file is defending: before task_take existed, work an operator
// assigned had NO door onto the being's ledger, and therefore no way to be
// closed at all. It stood in the prompt every turn, forever, however finished
// it really was.

import { describe, it, expect } from 'vitest';
import {
  takeAssigned, takenFrom, takenAssignmentIds, assignmentToSettle,
} from '../../core/tasks/task-take.js';
import { updateTask, formatLedgerSection } from '../../core/tasks/task-ledger.js';
import {
  addAssigned, emptyPlan, formatAssignedSection, materializeRecurrence,
} from '../../core/tasks/assigned-plan.js';

const NOW = '2026-08-05T10:00:00.000Z';
const LATER = '2026-08-05T11:00:00.000Z';
const CHAT = 'session-1754388000000';

/** A real assigned plan carrying one piece of operator work. `cadence` is
 *  required by addAssigned, so 'once' is the default here as it is in the UI. */
const planWith = ({ cadence = 'once', ...args }) =>
  addAssigned(emptyPlan(), { cadence, ...args }, { id: 'assign-aaaa-bbbb-cccc', now: NOW });

describe('taking up assigned work', () => {
  it('copies the work onto the ledger, linked back to the assignment', () => {
    const { task: assigned } = planWith({ title: 'Draft the release notes', detail: 'through 0.1.11', size: 'half' });
    const { ledger, task } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });

    expect(task.title).toBe('Draft the release notes');
    expect(task.detail).toBe('through 0.1.11');
    // The operator's estimate is worth more than no estimate.
    expect(task.size).toBe('half');
    // THE LINK — the one field that makes settling this settle theirs.
    expect(task.fromAssigned).toBe(assigned.id);
    expect(task.chatId).toBe(CHAT);
    expect(task.status).toBe('open');
    expect(ledger.tasks).toHaveLength(1);
  });

  it('does NOT copy the cadence — the rhythm stays on the operator\'s clock', () => {
    // A daily assignment reopens each period from the operator's plan. A ledger
    // copy that ALSO recurred would reopen on a second clock, and the being
    // would be carrying two of everything.
    const { task: assigned } = planWith({ title: 'Post the morning update', cadence: 'daily' });
    const { task } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });
    expect(task.cadence).toBeUndefined();
  });

  it('refuses a second take while the first is still live, and names it', () => {
    const { task: assigned } = planWith({ title: 'Draft the release notes' });
    const { ledger } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });

    expect(() => takeAssigned(ledger, assigned, { id: 'own-2', now: LATER, chatId: CHAT }))
      .toThrow(/already taken that up/);
    // The refusal must say WHICH task, or the being cannot go work it.
    expect(() => takeAssigned(ledger, assigned, { id: 'own-2', now: LATER, chatId: CHAT }))
      .toThrow(/Draft the release notes/);
  });

  it('allows taking it up AGAIN once the previous copy is settled', () => {
    // This is the recurring case: a daily assignment reopens, and the being
    // must be able to take the new period up. Reading settled history as
    // "already taken" would let it take Monday and never Tuesday.
    const { task: assigned } = planWith({ title: 'Post the morning update', cadence: 'daily' });
    const first = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });
    const settled = updateTask(first.ledger, { id: 'own-1', status: 'done' }, { now: LATER });

    const second = takeAssigned(settled.ledger, assigned, { id: 'own-2', now: LATER, chatId: CHAT });
    expect(second.task.fromAssigned).toBe(assigned.id);
    expect(second.ledger.tasks.filter((t) => t.fromAssigned === assigned.id)).toHaveLength(2);
  });

  it('takenFrom finds only the LIVE copy; takenAssignmentIds collects them', () => {
    const { task: a } = planWith({ title: 'Draft the release notes' });
    const { ledger } = takeAssigned({ tasks: [] }, a, { id: 'own-1', now: NOW, chatId: CHAT });

    expect(takenFrom(ledger, a.id)?.id).toBe('own-1');
    expect(takenAssignmentIds(ledger)).toEqual(new Set([a.id]));

    const settled = updateTask(ledger, { id: 'own-1', status: 'done' }, { now: LATER });
    expect(takenFrom(settled.ledger, a.id)).toBeNull();
    expect(takenAssignmentIds(settled.ledger)).toEqual(new Set());
  });

  it('self-authored work carries no link and never claims to close anything', () => {
    // The whole point of minting `fromAssigned` on the STAMP: a being cannot
    // author it, so its own work can never claim to settle its operator's.
    const { ledger } = takeAssigned({ tasks: [] }, { id: 'x', title: 'legit' }, { id: 'own-1', now: NOW });
    const forged = updateTask(ledger, { id: 'own-1', title: 'still legit' }, { now: LATER });
    expect(forged.task.fromAssigned).toBe('x');
    expect(takenAssignmentIds({ tasks: [{ id: 'z', title: 't', status: 'open' }] })).toEqual(new Set());
  });
});

describe('what settling a taken task closes', () => {
  it('done and dropped both settle the assignment', () => {
    // `dropped` settles deliberately: a being setting work down has ANSWERED
    // the assignment — with a no. Leaving the box open would say the work is
    // still coming when nobody is carrying it.
    for (const status of ['done', 'dropped']) {
      const { task: assigned } = planWith({ title: 'Draft the release notes' });
      const { ledger } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });
      const { task } = updateTask(ledger, { id: 'own-1', status }, { now: LATER });
      expect(assignmentToSettle(task)).toEqual({ assignedId: assigned.id, status });
    }
  });

  it('a task merely made active closes nothing', () => {
    const { task: assigned } = planWith({ title: 'Draft the release notes' });
    const { ledger } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });
    const { task } = updateTask(ledger, { id: 'own-1', status: 'active' }, { now: LATER });
    expect(assignmentToSettle(task)).toBeNull();
  });

  it('settling work the being authored ITSELF closes nothing', () => {
    const own = { id: 'own-9', title: 'my own idea', status: 'done' };
    expect(assignmentToSettle(own)).toBeNull();
  });
});

describe('rolling the ledger forward keeps what is not a task', () => {
  it('preserves the focus pointer — the bug that stopped work recording dead', () => {
    // FOUND LIVE, 2026-08-05. `materializeRecurrence` was written for the
    // operator's assigned PLAN, which carries nothing but tasks, and later
    // reused for the being's LEDGER, which also carries the per-chat FOCUS
    // map. It rebuilt the object as a bare `{ tasks }`, so every sibling key
    // was dropped — and `_handleTaskTool` opens EVERY call by rolling the
    // ledger through it and writing the result back.
    //
    // The consequence: a being focused a task, did real work, and then its very
    // next task tool call silently erased the focus. Work recording attributes
    // to focus, so it stopped; INTERRUPTED is DERIVED from work-plus-silence,
    // so a crash could no longer leave an honest half-finished task. This is
    // the identical defect `prune` was hardened against once already (see its
    // "SIBLING KEYS SURVIVE" note) — the same trap, one function over.
    const ledger = {
      tasks: [{ id: 'a', title: 'the work', status: 'active' }],
      focus: { [CHAT]: 'a' },
    };
    const rolled = materializeRecurrence(ledger, LATER).plan;
    expect(rolled.focus).toEqual({ [CHAT]: 'a' });
  });

  it('preserves siblings even when a rhythm actually rolls', () => {
    // The `changed: true` branch is a SEPARATE return statement, so it needs
    // its own proof — fixing only the unchanged path would leave the bug alive
    // on exactly the days a daily reopens.
    const ledger = {
      tasks: [{
        id: 'a', title: 'the rhythm', status: 'done', cadence: 'daily',
        completedAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-01T10:00:00.000Z',
      }],
      focus: { [CHAT]: 'a' },
    };
    const { plan: rolled, changed } = materializeRecurrence(ledger, LATER);
    expect(changed).toBe(true);
    expect(rolled.tasks[0].status).toBe('open');
    expect(rolled.focus).toEqual({ [CHAT]: 'a' });
  });
});

describe('what the being actually reads', () => {
  it('STANDING WORK names the id tasks/take needs, and how anything there closes', () => {
    const { plan, task } = planWith({ title: 'Draft the release notes' });
    const text = formatAssignedSection(plan, {});
    // Without the id printed, a tasks/take intent is unusable — the being would
    // be told to name something it was never shown.
    expect(text).toContain(`[${task.id.slice(0, 8)}]`);
    // The LIVE spelling: `task_take` was retired to the intent (S3b4,
    // retired-tools.js) and this section migrated with it.
    expect(text).toContain('tasks/take');
    expect(text).toMatch(/settle/i);
  });

  it('an assignment already in hand says so, instead of reading as untouched', () => {
    const { plan, task: assigned } = planWith({ title: 'Draft the release notes' });
    const { ledger } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });

    expect(formatAssignedSection(plan, {})).not.toContain('IN HAND');
    expect(formatAssignedSection(plan, { taken: takenAssignmentIds(ledger) })).toContain('IN HAND');
  });

  it('WORKING STATE warns that settling the copy settles the operator\'s box', () => {
    const { task: assigned } = planWith({ title: 'Draft the release notes' });
    const { ledger } = takeAssigned({ tasks: [] }, assigned, { id: 'own-1', now: NOW, chatId: CHAT });
    const text = formatLedgerSection(ledger, { chatId: CHAT });
    // A being should know the consequence BEFORE it settles, not after.
    expect(text).toContain("FROM YOUR OPERATOR'S LIST");
  });

  it('self-authored work carries no such mark', () => {
    const ledger = { tasks: [{ id: 'own-9', title: 'my own idea', status: 'open', chatId: CHAT }] };
    expect(formatLedgerSection(ledger, { chatId: CHAT })).not.toContain("FROM YOUR OPERATOR'S LIST");
  });
});
