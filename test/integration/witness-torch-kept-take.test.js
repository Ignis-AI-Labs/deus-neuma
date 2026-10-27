/**
 * THE WITNESS TORCH IS ASKED OVER THE KEPT TAKES (RULE 0) — a real sealed
 * witness on a real lane, its real compaction (compactWitnessSession), and
 * its torch ask riding its own route to a real loopback provider that records
 * the request. Nothing is mocked.
 *
 * Under proof: when the operator viewed take 1 of a point and rejected take
 * 2, the torch ask replays the kept take only — the portal lane's fold law at
 * the witness seat.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';
import { compactWitnessSession } from '../../backend/services/witness-compaction.js';

let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'witness-torch-kept-take', beings: [], witness: true });
  // The lane is provisioned on first manifest, as the desk does it.
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Kit', neumaId: kit.witnessLane }, 'companion:anchored');
}, 30000);
afterAll(async () => { await kit?.close(); });

test('a witness torch ask replays the viewed take, never the rejected one', async () => {
  const lane = kit.witnessLane;
  const session = 'session-torch-takes';
  const { workspace } = kit;
  // The point with two takes, the operator's view on take 1 — then enough
  // conversation that the point falls in the compacted region, with enough
  // weight to be worth summing up (compact-region.js).
  const turnId = (await workspace.appendTurnPoint(lane, session, { role: 'user', content: 'Which lamp stays lit?' })).turnId;
  await workspace.appendTake(lane, session, turnId, 1, { role: 'assistant', content: 'KEPT TAKE: the north lamp.' });
  await workspace.appendTake(lane, session, turnId, 2, { role: 'assistant', content: 'REJECTED TAKE: the south lamp.' });
  await workspace.appendBranchView(lane, session, { [turnId]: 1 });
  for (let i = 0; i < 40; i += 1) {
    await workspace.appendMessage(lane, session, { role: i % 2 ? 'assistant' : 'user', content: `filler row ${i}${' the harbour log runs on, line after line.'.repeat(24)}` });
  }
  kit.provider.setScript([{ reply: JSON.stringify({ summary: 'We spoke of lamps.', torch: 'Pick up at the north lamp.' }) }]);
  await compactWitnessSession(lane, session, true);
  const ask = JSON.stringify(kit.provider.turns.at(-1)?.messages ?? []);
  expect(ask).toContain('KEPT TAKE: the north lamp.');
  expect(ask).not.toContain('REJECTED TAKE');
});
