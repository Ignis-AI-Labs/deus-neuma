/**
 * THE WORKING-BAND HARVEST — proven against a REAL workspace on real
 * encrypted disk (RULE 0, the solo-torch harness precedent; no mock anywhere
 * in the path).
 *
 * The hole it closes: live crystallization needs the 0.75 bar (or an act, or
 * an operational 0.5); the 0.4 salvage lane only ran inside compaction, which
 * a large window may never reach. Ordinary working exchanges — the 0.4–0.75
 * band — scrolled out of the tail into nothing. The sweep crystallizes the
 * AGED region of a session (never the live tail), tagged
 * `working-band-harvest`, idempotent through its cursor.
 *
 * Post-#528 (2026-09-12): the live tail is what RODE THE WIRE — the settling
 * turn hands its real transcript row count through as `liveTailRows`; an
 * offline sweep (no turn in hand) falls back to the unknown-window tail law
 * (liveTailStartFor), under which a session that fits the fallback budget has
 * no aged region at all. Both laws are pinned here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { harvestWorkingBand, HARVEST_FLOOR } from '../../backend/services/band-harvest.js';

const BAND_USER = 'why does the scrollback feel shorter than the work we put into it?';
const BAND_ASSISTANT = 'A plain working answer about the session tail and how the render caps it.';
const NOISE_USER = 'ok';
const NOISE_ASSISTANT = 'sure';
const TAIL_MARK = 'TAIL ROW STILL LIVE — never harvested';

describe('harvestWorkingBand — real session, real crystallization, real cursor', () => {
  let root, previousRoot, previousKey, previousKill;
  const NEUMA = 'band-harvest-proof';
  const SESSION = 'sess-band-proof';

  beforeAll(async () => {
    previousRoot = getWorkspacesRoot();
    previousKey = process.env.DNA_ENCRYPTION_KEY;
    previousKill = process.env.NEUMA_BAND_HARVEST;
    delete process.env.NEUMA_BAND_HARVEST;
    process.env.DNA_ENCRYPTION_KEY = 'band-harvest-test-key-long-enough';
    const tmp = await createTempDir('band-harvest');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
    await workspace.create(NEUMA);
    // 60 rows: 20 aged (one noise pair + nine band pairs) + 40 live tail.
    await workspace.appendMessage(NEUMA, SESSION, { role: 'user', content: NOISE_USER });
    await workspace.appendMessage(NEUMA, SESSION, { role: 'assistant', content: NOISE_ASSISTANT });
    for (let i = 0; i < 9; i += 1) {
      await workspace.appendMessage(NEUMA, SESSION, { role: 'user', content: `${BAND_USER} (${i})` });
      await workspace.appendMessage(NEUMA, SESSION, { role: 'assistant', content: `${BAND_ASSISTANT} (${i})` });
    }
    for (let i = 0; i < 40; i += 1) {
      await workspace.appendMessage(NEUMA, SESSION, {
        role: i % 2 ? 'assistant' : 'user',
        content: `${TAIL_MARK} ${i}`,
      });
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({ DNA_ENCRYPTION_KEY: previousKey, NEUMA_BAND_HARVEST: previousKill })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    setWorkspacesRoot(previousRoot);
  });

  it('crystallizes the band rows beyond the tail — tagged, anchored, noise left behind', async () => {
    // liveTailRows: 40 — the turn-path truth: the last 40 rows rode the wire.
    const ran = await harvestWorkingBand(NEUMA, SESSION, { liveTailRows: 40 });
    expect(ran).toBe(true);

    const observations = await workspace.listObservations(NEUMA);
    const harvested = observations.filter((o) => o.source === 'working-band-harvest');
    // Nine band pairs cross 0.4 (baseline + philosophical); the noise pair does not.
    expect(harvested).toHaveLength(9);
    expect(harvested.every((o) => o.significance >= 0.4)).toBe(true);
    expect(harvested.every((o) => o.significance < 0.75)).toBe(true);
    expect(observations.some((o) => o.userMessage === NOISE_USER)).toBe(false);
    // The anchor coordinates point into the live session file.
    expect(harvested.every((o) => o.anchor?.sessionId === SESSION)).toBe(true);
    // Nothing from the live tail was harvested.
    expect(observations.some((o) => String(o.userMessage || '').includes(TAIL_MARK)
      || String(o.response || '').includes(TAIL_MARK))).toBe(false);
  });

  it('is idempotent through the cursor — a second sweep is a no-op', async () => {
    const before = (await workspace.listObservations(NEUMA)).length;
    const ran = await harvestWorkingBand(NEUMA, SESSION, { liveTailRows: 40 });
    expect(ran).toBe(false);
    expect((await workspace.listObservations(NEUMA)).length).toBe(before);
  });

  it('advances with the session — the aged region moves with the tail, and noise still passes through', async () => {
    // 20 more rows: the original TAIL rows (noise, sub-0.4) scroll into the
    // aged region; the new rows become the live tail. The sweep RUNS (region
    // meets the floor) but crystallizes nothing — noise is noise, aged or not.
    for (let i = 0; i < 20; i += 1) {
      await workspace.appendMessage(NEUMA, SESSION, {
        role: i % 2 ? 'assistant' : 'user',
        content: `${BAND_USER} second-wave ${i}`,
      });
    }
    const before = (await workspace.listObservations(NEUMA)).length;
    const ran = await harvestWorkingBand(NEUMA, SESSION, { liveTailRows: 40 });
    expect(ran).toBe(true); // 20 aged rows beyond the cursor — the floor is met
    expect(HARVEST_FLOOR).toBe(20); // the floor the region size above depends on
    expect((await workspace.listObservations(NEUMA)).length).toBe(before); // but noise never crystallizes
  });

  it('the offline default law: a session that fits the fallback tail has NO aged region', async () => {
    // No turn in hand → the unknown-window tail law (liveTailStartFor, 32K
    // chars). 30 band-worthy rows ≈ 3K chars — ALL live, so nothing is aged.
    // The floor (20) IS met by row count: only the tail law refuses, which is
    // the point — the sweep crystallizes what aged off the wire, and here
    // nothing has.
    const fresh = 'sess-band-offline';
    for (let i = 0; i < 30; i += 1) {
      await workspace.appendMessage(NEUMA, fresh, {
        role: i % 2 ? 'assistant' : 'user',
        content: `${BAND_USER} offline ${i}`,
      });
    }
    const before = (await workspace.listObservations(NEUMA)).length;
    const ran = await harvestWorkingBand(NEUMA, fresh);
    expect(ran).toBe(false);
    expect((await workspace.listObservations(NEUMA)).length).toBe(before);
  });

  it('the operator hard kill refuses the sweep and the cursor does not advance', async () => {
    const cursorBefore = await fs.readFile(path.join(root, NEUMA, 'memory', 'band-harvest.json'), 'utf8');
    process.env.NEUMA_BAND_HARVEST = '0';
    try {
      const before = (await workspace.listObservations(NEUMA)).length;
      const ran = await harvestWorkingBand(NEUMA, SESSION);
      expect(ran).toBe(false);
      expect((await workspace.listObservations(NEUMA)).length).toBe(before);
      expect(await fs.readFile(path.join(root, NEUMA, 'memory', 'band-harvest.json'), 'utf8'))
        .toBe(cursorBefore);
    } finally {
      delete process.env.NEUMA_BAND_HARVEST;
    }
  });
});
