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
 *   2. the house's line runs exactly as wide as the rig was measured to run —
 *      never wider than the server's slots, one when unmeasured.
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

describe('LAW 2 — the house line runs at the measured width', () => {
  const saved = process.env.NEUMA_CAPACITY_PATH;
  let stop;
  beforeAll(() => { process.env.NEUMA_CAPACITY_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'line-width-')); });
  afterAll(() => {
    stop?.();
    if (saved === undefined) delete process.env.NEUMA_CAPACITY_PATH; else process.env.NEUMA_CAPACITY_PATH = saved;
  });

  test('a measured ceiling below the server\'s slots narrows the line to it', async () => {
    expect(substrateLine.snapshot().capacity).toBe(SERVING_PARALLEL_SLOTS); // no watch yet: the server's slots
    await writeCapacity({ runAt: '2026-10-15T10:00:00.000Z', ceiling: 3, boundClass: 'A', limitedBy: 'latency', incomplete: false, substrate: { model: null } });
    stop = startLineWidthWatch();
    await expect.poll(() => substrateLine.snapshot().capacity, { timeout: 10000 }).toBe(Math.min(3, SERVING_PARALLEL_SLOTS));
  });
});
