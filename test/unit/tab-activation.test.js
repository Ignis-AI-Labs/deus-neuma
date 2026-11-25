/**
 * TABS ARE FREE; GENERATION IS WHAT THE MEASUREMENT BOUNDS.
 *
 * Design note, 2026-10-15, holding a strip of five team members' chats and refused a
 * fourth sitting: […]
 *
 * (It refines 2026-08-29's […]: ACTIVE means generating, not connected.) Two laws, through
 * the REAL pure model and the REAL house line (RULE 0 — no mock):
 *
 *   1. the door never refuses — a tab opens, focuses and connects at any load;
 *   2. the house's line runs as wide as the server's slots (Design note, 2026-11-19, a shadow clone held in line on a
 *      4-slot server while the scan's knee read 3: […]) — the measured knee plans a team's width, it no longer narrows the line.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openTab, emptyTabs, MAX_TABS_PER_WINDOW } from '../../core/runtime/tabs-model.js';
import { TAB_KIND } from '../../core/runtime/tab-budget.js';
import { writeCapacity } from '../../backend/services/capacity-store.js';
import { substrateLine, startLineWidthWatch } from '../../backend/services/substrate-lease.js';
import { SERVING_PARALLEL_SLOTS } from '../../backend/services/serving-launch-config.js';

const tab = (id, kind = TAB_KIND.local) => ({
  id, kind, neumaId: `n-${id}`, name: `Tab ${id}`, createdAt: '2026-10-15T10:00:00.000Z',
});

describe('LAW 1 — the door never refuses', () => {
  test('a rig measured at THREE opens a strip of eight sittings, local and witness alike', () => {
    let s = emptyTabs();
    for (let i = 0; i < 8; i += 1) s = openTab(s, tab(`t${i}`, i % 2 ? TAB_KIND.witness : TAB_KIND.local), { focus: i === 0 });
    expect(s.tabs).toHaveLength(8);
  });

  test('the ONLY limit on a strip is its own hard stop, which is not a budget', () => {
    let s = emptyTabs();
    for (let i = 0; i < MAX_TABS_PER_WINDOW + 5; i += 1) s = openTab(s, tab(`t${i}`));
    expect(s.tabs).toHaveLength(MAX_TABS_PER_WINDOW);
  });
});

describe('LAW 2 — the house line runs every slot the server runs', () => {
  const saved = process.env.NEUMA_CAPACITY_PATH;
  let stop;
  beforeAll(() => { process.env.NEUMA_CAPACITY_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'line-width-')); });
  afterAll(() => {
    stop?.();
    if (saved === undefined) delete process.env.NEUMA_CAPACITY_PATH; else process.env.NEUMA_CAPACITY_PATH = saved;
  });

  test('a measured knee below the server\'s slots plans a team\'s width but leaves the line at the server\'s slots', async () => {
    expect(substrateLine.snapshot().capacity).toBe(SERVING_PARALLEL_SLOTS); // no watch yet: the server's slots
    await writeCapacity({ runAt: '2026-10-15T10:00:00.000Z', ceiling: 3, boundClass: 'A', limitedBy: 'latency', incomplete: false, substrate: { model: null } });
    stop = startLineWidthWatch();
    const { resolveTeamCapacity } = await import('../../backend/services/team-coordinator.js');
    await expect.poll(async () => (await resolveTeamCapacity()).maxParallel, { timeout: 10000 }).toBe(Math.min(3, SERVING_PARALLEL_SLOTS));
    await new Promise((r) => { setTimeout(r, 300); });
    expect(substrateLine.snapshot().capacity).toBe(SERVING_PARALLEL_SLOTS);
  });

  test('on the server\'s 4 slots, three clones (house work) and the operator\'s chat run together; a fourth clone waits', async () => {
    const { nextAdmission } = await import('../../backend/services/substrate-line.js');
    const running = [{ kind: 'member' }, { kind: 'member' }, { kind: 'turn' }];
    expect(nextAdmission({ capacity: 4, running, waiting: [{ kind: 'member' }] })).toBe(0);
    expect(nextAdmission({ capacity: 4, running: [...running, { kind: 'member' }], waiting: [{ kind: 'member' }] })).toBe(-1);
    // Three clones at work, the operator's own chat still gets the fourth slot.
    expect(nextAdmission({ capacity: 4, running: [{ kind: 'member' }, { kind: 'member' }, { kind: 'member' }], waiting: [{ kind: 'member' }, { kind: 'turn' }] })).toBe(1);
  });
});
