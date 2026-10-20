/**
 * A RUN'S END CARRIES THE PLATFORM'S OWN RECORD OF ITS WEB READS, FOR REAL
 * (RULE 0: a real house — a real wake turn, the real run store and act ledger
 * on disk; the model a loopback OpenAI-wire server). House Aldmere,
 * 2026-10-18: a run's findings claimed four sources "opened live today"; the
 * operator's record could not check it, and the Optio relayed it as fact.
 *
 * Under proof:
 *  - the lead woken for a run's end reads what the act ledger recorded its
 *    members reading from the web while it ran — the read inside the run,
 *    never one before it or a stranger's;
 *  - a run with none says so, and to treat a live-source claim as unverified.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createWakeHouse, userText, WALLET, HOUSEMATE, BYSTANDER } from '../helpers/house-wake-kit.js';
import { createRun, updateRun } from '../../backend/services/team-run-store.js';
import { recordAct } from '../../backend/services/act-ledger.js';
import { enqueueWake } from '../../backend/services/house-clock/wake-queue.js';

// impure — a finished run led by the housemate, with the bystander on its one step
const finishedRun = async (runAt, finishedAt) => {
  const record = {
    runAt, by: WALLET, name: 'RESEARCH CREW', goal: 'Find the gap.', lane: 'lead', status: 'done', finishedAt,
    lead: { neumaId: HOUSEMATE, name: 'Quae' }, steps: [{ id: 'research', neumaId: BYSTANDER, task: 'Research it.', needs: [] }],
  };
  const id = await createRun(record);
  await updateRun(id, WALLET, record);
  return id;
};

describe('a run\'s end carries the platform\'s record of its web reads', () => {
  let house;
  beforeEach(async () => { house = await createWakeHouse(); });
  afterEach(async () => { await house.teardown(); });

  test('the read its member made inside the run is named; one before it, and a stranger\'s, are not', async () => {
    await house.serve([{ reply: 'I read the run report.' }]);
    await house.charter();
    await recordAct({ laneId: BYSTANDER, tool: 'web/web_search', scope: 'before the run', status: 'success' });
    await new Promise((r) => setTimeout(r, 20));
    const runAt = new Date().toISOString();
    await recordAct({ laneId: BYSTANDER, tool: 'web/web_search', scope: 'AI Act enforcement date', status: 'success' });
    await recordAct({ laneId: 'stranger-lane', tool: 'web/web_fetch', scope: 'https://elsewhere.example', status: 'success' });
    await new Promise((r) => setTimeout(r, 20));
    const id = await finishedRun(runAt, new Date().toISOString());
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'run-ended', ref: id, detail: { status: 'done' } });
    await house.ledgerRows(1);
    const note = userText(house.provider.turns[0]);
    expect(note).toContain('The platform recorded 1 web read(s) by its members during the run: web_search "AI Act enforcement date".');
    expect(note).not.toContain('before the run');
    expect(note).not.toContain('elsewhere.example');
  }, 60000);

  test('a run with no web reads says so, and to treat a live-source claim as unverified', async () => {
    await house.serve([{ reply: 'I read the run report.' }]);
    await house.charter();
    const runAt = new Date().toISOString();
    const id = await finishedRun(runAt, new Date(Date.now() + 1000).toISOString());
    await enqueueWake(WALLET, { seat: HOUSEMATE, reason: 'run-ended', ref: id, detail: { status: 'done' } });
    await house.ledgerRows(1);
    expect(userText(house.provider.turns[0])).toContain('The platform recorded NO web reads by its members during the run');
  }, 60000);
});
