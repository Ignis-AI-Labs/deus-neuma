/**
 * HOUSE WORK FILES WHAT NEEDS THE OPERATOR AND GOES ON, FOR REAL (RULE 0:
 * real wake turns and a real team member's turn on synthetic connections, the
 * real tool loop, ask_operator, the approval broker, sandbox and filesystem
 * organ on real disk, over a loopback OpenAI-wire provider whose script
 * carries the calls). Design note, 2026-10-16: […].
 *
 * Under proof:
 *  - an ask_operator in a wake files each question as a 'decision' ask (its
 *    choices kept, a bare question too) and returns at once: the same turn
 *    goes on to its next act, and the wake ends escalated with a tray card;
 *  - a team member's operator-bound act is refused, FILED with its run and
 *    step named, and the member carries on; its ask_operator is filed too;
 *  - with no active charter a member's question is answered […] at once — never a card that hangs the part.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, WALLET, HOUSEMATE, BYSTANDER } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND } from '../../core/runtime/notification-record.js';
import { ASK_UNANSWERED } from '../../backend/services/operator-ask.js';
import { runMemberTurn } from '../../backend/services/team-member-turn.js';

const said = (turn) => JSON.stringify(turn.messages);

describe('house work files what needs the operator, and goes on', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  test('a decision in a wake is filed and answered at once; the same turn takes its next act', async () => {
    const outline = path.join(neumaWorkspace.pathFor(HOUSEMATE), 'outline.md');
    await house.serve([
      { reply: `The price is the operator's call. ${call('operator/ask_operator', { questions: [
        { question: 'Ratify the $250 first-job price?', header: 'Price', options: [{ label: 'Ratify', description: 'ship at $250' }, { label: 'Lower it' }] },
        { question: 'Publish the offer on the house site?' },
      ] })}` },
      { reply: `While that waits, the outline. ${call('fs/write', { path: outline, content: '# Outline' })}` },
      { reply: 'The outline is written; the price and the publishing wait on my operator.' },
    ]);
    await house.charter();
    await house.post(HOUSEMATE, 'Price and outline the first offer.');
    const [row] = await house.ledgerRows(1);
    expect(row).toMatchObject({ seat: HOUSEMATE, outcome: 'escalated' });
    expect(row.escalations.map((e) => [e.kind, e.question])).toEqual([
      ['decision', 'Ratify the $250 first-job price?'], ['decision', 'Publish the offer on the house site?'],
    ]);
    // the turn went on: the filing came back as a tool result, then the next act ran
    expect(house.provider.turns).toHaveLength(3);
    expect(said(house.provider.turns[1])).toMatch(/Filed for your operator as 2 decisions \[ask [0-9a-f-]{36}, ask [0-9a-f-]{36}\]/);
    expect(said(house.provider.turns[1])).toContain('carry on now with everything that does not need them');
    expect(await fs.readFile(outline, 'utf8')).toBe('# Outline');

    const asks = (await readAsks(WALLET)).reverse();
    expect(asks).toEqual([
      expect.objectContaining({ kind: 'decision', seat: HOUSEMATE, status: 'open', question: 'Ratify the $250 first-job price?', header: 'Price', options: ['Ratify', 'Lower it'], sessionId: row.sessionId, wakeId: row.id }),
      expect.objectContaining({ kind: 'decision', question: 'Publish the offer on the house site?', options: [] }),
    ]);
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
    expect(cards.map((c) => c.title)).toEqual(['Quae asks for your decision — filed for you', 'Quae asks for your decision — filed for you']);
    // the wake's own note told it so before it asked
    expect(said(house.provider.turns[0])).toContain('a decision only they can make goes to them through ask_operator, which files it and returns at once');
  }, 60000);

  test('a team member\'s operator-bound act is filed with its run and step; its question too; it carries on', async () => {
    const arena = path.join(house.office.root, 'arena');
    const old = path.join(arena, 'old-notes.md');
    await fs.mkdir(arena, { recursive: true });
    await fs.writeFile(old, 'old notes');
    await house.serve([
      { reply: `Tidying first. ${call('fs/edit', { path: old, delete: true })}` },
      { reply: `Then the scope. ${call('operator/ask_operator', { question: 'Cover both markets?', options: ['Both', 'One'] })}` },
      { reply: 'The delete and the scope wait on my operator.\nSTATUS:\ndone' },
    ]);
    await house.charter();
    const { text } = await runMemberTurn({
      neumaId: BYSTANDER, name: 'Cosi', wallet: WALLET, brief: 'Your part: tidy the arena and scope the digest.',
      workspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 }, teamRun: { runId: 'run-abc', stepId: 's2' },
    });
    expect(text).toContain('The delete and the scope wait on my operator.');
    expect(await fs.readFile(old, 'utf8')).toBe('old notes');
    expect(said(house.provider.turns[1])).toContain('It was NOT taken: it is filed for your operator');
    expect(said(house.provider.turns[2])).toMatch(/Filed for your operator as a decision \[ask [0-9a-f-]{36}\]/);

    const asks = (await readAsks(WALLET)).reverse();
    expect(asks).toEqual([
      expect.objectContaining({ kind: 'act', tool: 'fs/edit', seat: BYSTANDER, runId: 'run-abc', stepId: 's2', wakeId: null, why: expect.stringMatching(/delete/) }),
      expect.objectContaining({ kind: 'decision', question: 'Cover both markets?', options: ['Both', 'One'], runId: 'run-abc', stepId: 's2' }),
    ]);
    const cards = (await readNotifications(WALLET)).records.filter((n) => n.kind === KIND.houseWake);
    expect(cards.map((c) => c.title)).toContain('Cosi\'s team step was refused fs/edit — filed for you');
  }, 60000);

  test('no active charter: a member\'s question is answered "nobody can answer" at once, nothing filed', async () => {
    const arena = path.join(house.office.root, 'arena');
    await fs.mkdir(arena, { recursive: true });
    await house.serve([
      { reply: call('operator/ask_operator', { question: 'Cover both markets?', options: ['Both', 'One'] }) },
      { reply: 'I decided on both.\nSTATUS:\ndone' },
    ]);
    const { text } = await runMemberTurn({
      neumaId: BYSTANDER, name: 'Cosi', wallet: WALLET, brief: 'Your part: scope the digest.',
      workspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 }, teamRun: { runId: 'run-abc', stepId: 's1' },
    });
    expect(text).toContain('I decided on both.');
    expect(said(house.provider.turns[1])).toContain(ASK_UNANSWERED.absent.slice(0, 60));
    expect(await readAsks(WALLET)).toEqual([]);
  }, 60000);
});
