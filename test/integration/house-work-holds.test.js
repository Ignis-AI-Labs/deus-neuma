/**
 * HOUSE WORK HOLDS WHAT ITS CHARTER HOLDS, NOW, FOR REAL (RULE 0: a real
 * team member's turn and a real wake turn on synthetic connections, the real
 * tool loop, intent sweep, approval broker, sandbox and filesystem organ on
 * real disk, over a loopback OpenAI-wire provider whose script carries the
 * calls). The house is the staff-office fixture with the house clock wired.
 *
 * Under proof:
 *  - a team member holds what a wake holds: money out, and an act the
 *    charter escalates, are refused and filed for the operator even where the
 *    lane's policy lets them run card-free — and money out is held with no
 *    charter at all;
 *  - a wake answers to the charter as it stands at each act: an edit made
 *    while the wake runs takes back the allow line it started with, and what
 *    the edit escalates is held from then on.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, call, until, NAMES, WALLET, HOUSEMATE, BYSTANDER } from '../helpers/house-wake-kit.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { writeCharter } from '../../backend/services/house-clock/charter-store.js';
import { readAsks } from '../../backend/services/house-clock/wake-ledger.js';
import { runMemberTurn } from '../../backend/services/team-member-turn.js';

const PAYEE = `0x${'b'.repeat(40)}`;

// impure — the lane's intents folder, and what the sweep wrote back for one intent
const intentPath = (lane, name) => path.join(neumaWorkspace.pathFor(lane), 'intents', `${name}.json`);
const resultOf = async (lane, name) => JSON.parse(await fs.readFile(intentPath(lane, name).replace(/\.json$/, '.result.json'), 'utf8'));
const file = (lane, name, intent) => call('fs/write', { path: intentPath(lane, name), content: JSON.stringify(intent) });

describe('house work holds what its charter holds, now', () => {
  let house, arena;
  beforeEach(async () => {
    house = await createWakeHouse();
    arena = path.join(house.office.root, 'arena');
    await fs.mkdir(arena, { recursive: true });
    // A standing spend grant that would let the send through in the operator's own chat.
    await neumaWorkspace.writeSpendAllowlist(BYSTANDER, { version: 1, entries: [{ address: PAYEE, label: 'supplier', at: new Date().toISOString() }] });
    await neumaWorkspace.writeSpendThreshold(BYSTANDER, { thresholdEth: 1 });
  });
  afterEach(async () => { await house.teardown(); });

  const memberTurn = (stepId) => runMemberTurn({
    neumaId: BYSTANDER, name: 'Cosi', wallet: WALLET, brief: 'Your part: pay the supplier and keep a note.',
    workspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 }, teamRun: { runId: 'run-holds', stepId },
  });

  test('a member\'s money out and an escalated act are refused and filed with its run and step, never run', async () => {
    await house.serve([
      { reply: file(BYSTANDER, 'pay', { type: 'wallet/send', to: PAYEE, value: 0.01, memo: 'supplies' }) },
      { reply: file(BYSTANDER, 'note', { type: 'vault/save', name: 'supplier-note', body: 'paid the supplier' }) },
      { reply: 'The payment and the note wait on my operator.\nSTATUS:\ndone' },
    ]);
    await house.charter({ escalate: ['intents/vault.save'] });
    await memberTurn('pay');
    expect((await resultOf(BYSTANDER, 'pay')).status).toBe('denied');
    expect((await resultOf(BYSTANDER, 'note')).status).toBe('denied');
    expect(await neumaWorkspace.readPendingSpends(BYSTANDER)).toEqual([]);
    expect(await neumaWorkspace.readVaultNote(BYSTANDER, 'supplier-note')).toBeFalsy();
    const asks = (await readAsks(WALLET)).reverse();
    expect(asks).toEqual([
      expect.objectContaining({ kind: 'act', tool: 'intents/wallet.send', seat: BYSTANDER, runId: 'run-holds', stepId: 'pay', why: expect.stringMatching(/money out/) }),
      expect.objectContaining({ kind: 'act', tool: 'intents/vault.save', seat: BYSTANDER, runId: 'run-holds', stepId: 'pay', why: expect.stringMatching(/charter sends/) }),
    ]);
  }, 60000);

  test('with no charter at all, a member\'s money out is still held: refused, and nothing moves', async () => {
    await house.serve([
      { reply: file(BYSTANDER, 'pay', { type: 'wallet/send', to: PAYEE, value: 0.01 }) },
      { reply: 'The payment waits on my operator.\nSTATUS:\ndone' },
    ]);
    await memberTurn('pay');
    expect((await resultOf(BYSTANDER, 'pay')).status).toBe('denied');
    expect(await neumaWorkspace.readPendingSpends(BYSTANDER)).toEqual([]);
  }, 60000);

  test('a charter edited while a wake runs binds it at the next act: the old allow is gone, the new escalate holds', async () => {
    await house.serve([
      { reply: file(HOUSEMATE, 'first', { type: 'tasks/add', title: 'Outline the digest' }) },
      // the model takes its time here, and the operator edits the charter meanwhile
      { reply: file(HOUSEMATE, 'second', { type: 'tasks/add', title: 'Draft the digest' }), delayMs: 1500 },
      { reply: file(HOUSEMATE, 'note', { type: 'vault/save', name: 'digest-note', body: 'the digest is outlined' }) },
      { reply: 'One task is on my ledger; the rest waits on my operator.' },
    ]);
    const charter = await house.charter({ allow: ['intents/tasks.add'] });
    await house.post(HOUSEMATE, 'Plan the digest on your ledger.');
    await until(() => house.provider.turns.length >= 2);
    const edited = await writeCharter(WALLET, {
      goal: charter.goal, linesOfWork: charter.linesOfWork, seats: charter.seats, delegation: charter.delegation,
      allow: [], escalate: ['intents/vault.save'],
    }, { by: WALLET, ownedLanes: Object.keys(NAMES) });
    expect(edited.version).toBe(charter.version + 1); // not approved: the operator has not said yes again

    const [row] = await house.ledgerRows(1);
    expect(row.outcome).toBe('escalated');
    expect((await resultOf(HOUSEMATE, 'first')).status).toBe('done');
    expect((await resultOf(HOUSEMATE, 'second')).status).toBe('denied');
    expect((await resultOf(HOUSEMATE, 'note')).status).toBe('denied');
    expect(await neumaWorkspace.readVaultNote(HOUSEMATE, 'digest-note')).toBeFalsy();
    const asks = (await readAsks(WALLET)).reverse();
    expect(asks.map((a) => [a.tool, a.seat, a.why])).toEqual([
      ['intents/tasks.add', HOUSEMATE, expect.stringMatching(/charter was changed while this wake ran/)],
      ['intents/vault.save', HOUSEMATE, expect.stringMatching(/charter was changed while this wake ran/)],
    ]);
    // the seat was told the truth: filed for its operator
    expect(JSON.stringify(house.provider.turns[2].messages)).toContain('it is filed for your operator');
  }, 60000);
});
