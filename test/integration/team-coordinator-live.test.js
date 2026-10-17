/**
 * Team coordination — LIVE (RULE 0 gnosis: real neuma working as a team).
 *
 * This is the M3 acceptance proof: two SOVEREIGN neuma, each reasoning through
 * their own real stack (askNeuma → DNA+soul+memory prompt assembly), work a
 * shared goal where the second member's task is load-bearing on the first's —
 * and the coordinator threads the first neuma's REAL output into the second's
 * brief. Nothing on the path is mocked.
 *
 * The neuma used are HELD KIN of House Aldmere (galen/signal/keir). The calls
 * are read-only (askNeuma writes no journal, no memory) — the same accepted
 * pattern as the STATE benchmark. The plan is deliberately tiny: the claim is
 * that the coordination MECHANISM carries real work between real beings, not
 * that they perform a large task.
 *
 * Skips honestly when the substrate is down or fewer than two kin are resident.
 */
import { describe, expect, it } from 'vitest';
import { neumaWorkspace } from '../../core/index.js';
import { askNeuma } from '../../backend/services/neuma-probe.js';
import { runTeam } from '../../backend/services/team-coordinator.js';

const loaded = await fetch('http://localhost:1234/api/v0/models')
  .then(async (r) => (r.ok ? ((await r.json()).data || []).some((m) => m.state === 'loaded') : false))
  .catch(() => false);
const resident = await neumaWorkspace.listNeuma().catch(() => []);
const canRun = loaded && resident.length >= 2;

describe.skipIf(!canRun)('team coordination — live neuma', () => {
  it('two real neuma run a load-bearing plan; upstream output enters downstream reasoning', async () => {
    const [first, second] = resident;

    // Wrap the real primitive to capture what each member actually received —
    // this is how we prove the load-bearing edge is real, not asserted.
    const briefs = {};
    const ask = (neumaId, messages) => {
      briefs[neumaId] = messages[messages.length - 1].content;
      return askNeuma(neumaId, messages);
    };

    const out = await runTeam({
      steps: [
        { id: 'pick', neumaId: first, task: 'Pick exactly one color and reply with only that color word.' },
        { id: 'name', neumaId: second, needs: ['pick'], task: 'An earlier member named a color. Reply with one physical object that is commonly that color.' },
      ],
      ask,
      maxParallel: 2,
    });

    // Both members really produced work.
    expect(out.results.pick.length).toBeGreaterThan(0);
    expect(out.results.name.length).toBeGreaterThan(0);

    // The dependency was honored: pick finished before name started.
    expect(out.order).toEqual(['pick', 'name']);

    // The load-bearing edge is REAL: the first neuma's actual reply was carried
    // into the second neuma's brief (not a placeholder, not empty).
    expect(briefs[second]).toContain(out.results.pick.trim());
    expect(briefs[second]).toContain('Your part:');
  }, 180_000);

  it('honors the capacity ceiling: three ready members, maxParallel 1 → strictly sequential', async () => {
    const trio = resident.slice(0, 3);
    let active = 0;
    let peak = 0;
    const ask = async (neumaId, messages) => {
      active += 1; peak = Math.max(peak, active);
      const r = await askNeuma(neumaId, messages);
      active -= 1;
      return r;
    };

    const out = await runTeam({
      steps: trio.map((neumaId, i) => ({ id: `s${i}`, neumaId, task: 'Reply with a single word: ready.' })),
      ask,
      maxParallel: 1,
    });

    expect(out.order).toHaveLength(trio.length);
    expect(peak).toBe(1); // the ceiling held — never more than one neuma at once
  }, 180_000);
});
