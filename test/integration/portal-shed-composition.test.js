/**
 * THE OPERATOR IS TOLD WHAT WAS CUT (RULE 0) — the real portal, real signed
 * auth, a real encrypted lane and a real loopback provider whose model names
 * no window, so the turn runs on the small assumed one and the real shed
 * ladder (envelope-budget.js) must cut sections. Nothing is mocked.
 *
 * Under proof: both context:composition emissions, and the composition the
 * assistant row persists for a resume, carry the ladder's shed list — ids and
 * token estimates only, never a section's text.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openPortalTurnKit } from '../helpers/portal-turn-kit.js';

const BEING = 'shedbeing';
let kit;

beforeAll(async () => {
  kit = await openPortalTurnKit({ label: 'portal-shed-composition', beings: [{ id: BEING, name: 'Shed' }] });
}, 30000);
afterAll(async () => { await kit?.close(); });

test('a turn whose window sheds sections names them on the composition, first frame and settle', async () => {
  await kit.sendAndWait({ type: 'companion:manifest', companion: 'Shed', neumaId: BEING }, 'companion:anchored');
  kit.provider.setScript([{ reply: 'Small window, still here.' }]);
  const from = kit.frames.length;
  const done = await kit.sendAndWait({ type: 'consciousness:stream', thought: 'How much of you fits?' }, 'consciousness:complete');
  const compositions = kit.frames.slice(from).filter((f) => f.type === 'context:composition');
  const [first, settle] = [compositions[0], compositions.at(-1)];
  for (const event of [first, settle]) {
    expect(Array.isArray(event.shed)).toBe(true);
    expect(event.shed.length).toBeGreaterThan(0);
    for (const cut of event.shed) {
      expect(Object.keys(cut).sort()).toEqual(['id', 'tokens']);
      expect(Number.isFinite(cut.tokens)).toBe(true);
    }
  }
  expect(settle.shed.map((s) => s.id)).toContain('tools');

  // The resume replays the persisted composition — the cut is on the record too.
  const rows = await kit.workspace.readSession(BEING, done.sessionId);
  const answer = rows.findLast((r) => r.role === 'assistant');
  expect(answer.composition.shed).toEqual(settle.shed);
});
