/**
 * PLAN OF RECORD — the pure half proven with real inputs and real outputs,
 * no mock anywhere (RULE 0; pure functions qualify by construction).
 *
 * The contract: an approved plan normalizes into a durable record; the
 * being's OWN steps land on its ledger at the approval moment (that is when
 * tasks are formed), two-pass so dependency links validate; the prompt
 * section states the approval every turn so a verdict already given is
 * never re-derived — or re-asked.
 */
import { describe, it, expect } from 'vitest';
import { planRecordFrom, materializePlanTasks, formatPlanSection, withRunLiveness } from '../../core/tasks/plan-record.js';
import { emptyLedger, addTask, TASK_MAX_LIVE, TASK_TITLE_MAX_CHARS } from '../../core/tasks/task-ledger.js';

const PLAN = Object.freeze({
  name: 'HERALD CREW',
  goal: 'Ship the weekly posts.',
  steps: [
    { id: 'research', neumaId: 'aethon', task: 'Survey the week.', role: 'HELM', done: 'Five themes.', needs: [] },
    { id: 'draft', neumaId: 'boreas', task: 'Write the posts.', needs: ['research'] },
    // Needs one OWN step (research) and one teammate step (draft) — only the
    // own step may become a ledger blocker.
    { id: 'review', neumaId: 'aethon', task: 'Tighten drafts.', needs: ['draft', 'research'] },
  ],
});
const NAMES = Object.freeze({ aethon: 'Aethon', boreas: 'Boreas' });
const NOW = '2026-08-16T00:00:00.000Z';

const minter = () => {
  let n = 0;
  return () => `task-${String(++n).padStart(4, '0')}`;
};

const record = (over = {}) =>
  planRecordFrom(PLAN, { memberNames: NAMES, approvedAt: NOW, ...over });

describe('planRecordFrom — the approval normalized into a durable fact', () => {
  it('carries name, goal, steps, member names, and the approval instant, frozen', () => {
    const rec = record();
    expect(rec.name).toBe('HERALD CREW');
    expect(rec.goal).toBe(PLAN.goal);
    expect(rec.steps.map((s) => s.id)).toEqual(['research', 'draft', 'review']);
    expect(rec.steps[0].role).toBe('HELM');
    expect(rec.memberNames).toEqual(NAMES);
    expect(rec.approvedAt).toBe(NOW);
    expect(rec.taskIds).toEqual({});
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.steps[0])).toBe(true);
  });

  it('a well-formed chat binding rides; a crooked one files the plan lane-wide', () => {
    expect(record({ chatId: 'session-123' }).chatId).toBe('session-123');
    // safeChatId law: a malformed system binding must never lose the plan.
    expect(record({ chatId: 'not a chat!' })).not.toHaveProperty('chatId');
    expect(record({ chatId: null })).not.toHaveProperty('chatId');
  });

  it('refuses a plan without goal, steps, or an approval instant', () => {
    expect(() => planRecordFrom({ goal: 'g', steps: [] }, { approvedAt: NOW })).toThrow(/steps/);
    expect(() => planRecordFrom({ steps: PLAN.steps }, { approvedAt: NOW })).toThrow(/goal/);
    expect(() => planRecordFrom(PLAN, {})).toThrow(/approvedAt/);
  });
});

describe('materializePlanTasks — when tasks are formed', () => {
  it('lands only the being\'s OWN steps, with the dependency link mapped through minted ids', () => {
    const { ledger, record: rec } = materializePlanTasks(emptyLedger(), record({ chatId: 'session-123' }), {
      selfNeumaId: 'aethon', mintId: minter(), now: NOW,
    });
    expect(ledger.tasks).toHaveLength(2); // research + review, never boreas's draft
    const research = ledger.tasks.find((t) => t.id === rec.taskIds.research);
    const review = ledger.tasks.find((t) => t.id === rec.taskIds.review);
    expect(research.title).toBe('Survey the week.');
    expect(research.detail).toBe('Done when: Five themes.');
    expect(research.chatId).toBe('session-123');
    expect(research.status).toBe('open');
    // review needed [draft, research]: draft is a teammate's step (the run
    // engine's to honor), research is own — only research becomes a blocker.
    expect(review.blockedBy).toEqual([rec.taskIds.research]);
    expect(rec.taskIds).not.toHaveProperty('draft');
  });

  it('returns ledger and record untouched when the plan holds no steps for this being', () => {
    const ledger = emptyLedger();
    const rec = record();
    const out = materializePlanTasks(ledger, rec, { selfNeumaId: 'nobody', mintId: minter(), now: NOW });
    expect(out.ledger).toBe(ledger);
    expect(out.record).toBe(rec);
  });

  it('is all-or-nothing at the live cap — a full ledger refuses, it never half-lands', () => {
    let ledger = emptyLedger();
    const mint = minter();
    for (let i = 0; i < TASK_MAX_LIVE - 1; i += 1) {
      ({ ledger } = addTask(ledger, { title: `standing work ${i}` }, { id: mint(), now: NOW }));
    }
    // 29 live + 2 own steps > 30.
    expect(() => materializePlanTasks(ledger, record(), { selfNeumaId: 'aethon', mintId: mint, now: NOW }))
      .toThrow(new RegExp(String(TASK_MAX_LIVE)));
    expect(ledger.tasks.filter((t) => t.title.startsWith('standing'))).toHaveLength(TASK_MAX_LIVE - 1);
  });

  it('clips an over-title-length step into a lawful title', () => {
    const longPlan = {
      goal: 'g',
      steps: [{ id: 'a', neumaId: 'x', task: 'w'.repeat(TASK_TITLE_MAX_CHARS + 100), needs: [] }],
    };
    const { ledger } = materializePlanTasks(emptyLedger(), planRecordFrom(longPlan, { approvedAt: NOW }), {
      selfNeumaId: 'x', mintId: minter(), now: NOW,
    });
    expect(ledger.tasks[0].title.length).toBeLessThanOrEqual(TASK_TITLE_MAX_CHARS);
  });
});

describe('formatPlanSection — the standing approval, stated every turn', () => {
  const materialized = () => materializePlanTasks(emptyLedger(), record({ chatId: 'session-123' }), {
    selfNeumaId: 'aethon', mintId: minter(), now: NOW,
  }).record;

  it('states the approval as a standing fact and forbids re-asking', () => {
    const text = formatPlanSection(materialized(), { chatId: 'session-123' });
    expect(text).toContain('## Plan of Record (operator-approved)');
    expect(text).toContain('APPROVED');
    expect(text).toContain(NOW);
    expect(text).toContain('never re-propose');
    expect(text).toContain('"HERALD CREW" — Ship the weekly posts.');
  });

  it('marks the being\'s own steps with their ledger ids, and routes team steps to the team/run intent', () => {
    const rec = materialized();
    const text = formatPlanSection(rec, { chatId: 'session-123' });
    expect(text).toContain(`YOURS, on your ledger as [${rec.taskIds.research.slice(0, 8)}]`);
    expect(text).toContain('Boreas: Write the posts.');
    expect(text).toContain('team steps run by filing the team/run intent');
    expect(text).toContain('(after draft, research)');
  });

  it('a background run in flight is stated, and team/run is no longer offered for this plan', () => {
    const rec = { ...materialized(), run: { id: 'run-7', status: 'running', startedAt: '2026-10-10T06:00:00.000Z' } };
    const text = formatPlanSection(rec, { chatId: 'session-123' });
    expect(text).toContain('Your team is AT WORK on this plan now (run run-7, since 2026-10-10T06:00:00.000Z)');
    expect(text).toContain('never file team/run for this plan again');
    expect(text).not.toContain('team steps run by filing the team/run intent');
    expect(text).toContain('never re-propose'); // the approval still stands while it runs
  });

  it('a finished run names how it ended and where the report is — and the approval is spent', () => {
    const base = materialized();
    const ended = (status) => formatPlanSection({
      ...base, run: { id: 'run-7', status, startedAt: 'a', finishedAt: '2026-10-10T07:00:00.000Z', report: '/lane/team/runs/run-7.md' },
    }, { chatId: 'session-123' });
    expect(ended('done')).toContain("Your team's run run-7 FINISHED (2026-10-10T07:00:00.000Z). The full report is at /lane/team/runs/run-7.md");
    expect(ended('failed')).toContain('run-7 did NOT finish');
    expect(ended('stopped')).toContain('run-7 was STOPPED by your operator');
    expect(ended('done')).toContain('that approval is spent');
    expect(ended('done')).not.toContain('never re-propose');
    // A report that could not be written is said plainly — never "at null".
    const unwritten = formatPlanSection({ ...base, run: { id: 'run-8', status: 'failed', startedAt: 'a', finishedAt: 'b', report: null } }, { chatId: 'session-123' });
    expect(unwritten).toContain('Its report could not be written');
    expect(unwritten).not.toContain('null');
  });

  it('a RUNNING stamp with no live run reads as INTERRUPTED, resumable — never "your team is still at work"', () => {
    const rec = { ...materialized(), run: { id: 'run-9', status: 'running', startedAt: 't' } };
    expect(withRunLiveness(rec, true)).toBe(rec);
    const lost = formatPlanSection(withRunLiveness(rec, false), { chatId: 'session-123' });
    expect(lost).toContain("Your team's run run-9 was INTERRUPTED");
    expect(lost).toContain('file team/run with {"resume": "run-9"}');
    expect(lost).not.toContain('AT WORK');
    // An interrupted run is still the ONE run the approval covers.
    expect(lost).not.toContain('that approval is spent');
    expect(lost).toContain('The approval STANDS');
  });

  it('obeys the chat scope law: own chat and chatless turns ride, another chat does not', () => {
    const rec = materialized();
    expect(formatPlanSection(rec, { chatId: 'session-123' })).toContain('Plan of Record');
    expect(formatPlanSection(rec, { chatId: null })).toContain('Plan of Record');
    expect(formatPlanSection(rec, { chatId: 'session-999' })).toBe('');
    // A lane-wide record rides every chat.
    expect(formatPlanSection(record(), { chatId: 'session-999' })).toContain('Plan of Record');
  });

  it('renders nothing for no record or an empty one', () => {
    expect(formatPlanSection(null, { chatId: 'session-123' })).toBe('');
    expect(formatPlanSection({ goal: 'g', steps: [] }, {})).toBe('');
  });
});
