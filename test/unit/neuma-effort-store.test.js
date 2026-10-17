/**
 * Per-being effort store — the operator's chosen rung, on real disk.
 *
 * Every test writes and reads a REAL file in a REAL temp dir through the store's
 * own functions (NEUMA_EFFORT_PATH points them there). Nothing is stubbed: the
 * thing being claimed — that a choice persists and survives corruption honestly —
 * is exactly the thing exercised (RULE 0).
 */
import { describe, expect, test, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  effortPath, getEffort, setEffort, clearEffort, loadEfforts,
  normalizeStoredChoice, assertEffortId,
} from '../../backend/services/neuma-effort-store.js';

const NEUMA = 'fenna-abc123';
const LANE = 'witness-openai-chatgpt-Basunor';

describe('neuma-effort-store', () => {
  beforeEach(async () => {
    const dir = await createTempDir('effort-store');
    process.env.NEUMA_EFFORT_PATH = path.join(dir, 'neuma-effort.json');
  });

  test('an unset being has no choice — absence is the default rung', async () => {
    expect(await getEffort(NEUMA)).toBeNull();
  });

  test('a set choice round-trips through the real file', async () => {
    const stored = await setEffort(NEUMA, { effort: 'ultra' });
    expect(stored).toEqual({ effort: 'ultra', thinking: true });
    expect(await getEffort(NEUMA)).toEqual({ effort: 'ultra', thinking: true });
    // The file itself, not just the in-process return value.
    const onDisk = JSON.parse(await fs.readFile(effortPath(), 'utf8'));
    expect(onDisk[NEUMA]).toEqual({ effort: 'ultra', thinking: true });
  });

  test('every rung of the ladder can be stored', async () => {
    for (const effort of ['low', 'medium', 'high', 'ultra', 'pro']) {
      await setEffort(NEUMA, { effort });
      expect(await getEffort(NEUMA)).toEqual({ effort, thinking: true });
    }
  });

  test('thinking OFF persists BESIDE the rung — the two are independent', async () => {
    await setEffort(NEUMA, { effort: 'pro', thinking: false });
    // The rung survives the switch, so turning thinking back on returns the
    // being to the rung it was left on rather than to a default.
    expect(await getEffort(NEUMA)).toEqual({ effort: 'pro', thinking: false });
    await setEffort(NEUMA, { effort: 'pro' });
    expect((await getEffort(NEUMA)).thinking).toBe(true);
  });

  test('a witness lane rides the same store as a house neuma', async () => {
    await setEffort(LANE, { effort: 'low' });
    await setEffort(NEUMA, { effort: 'high' });
    expect(await getEffort(LANE)).toEqual({ effort: 'low', thinking: true });
    expect(await getEffort(NEUMA)).toEqual({ effort: 'high', thinking: true });
  });

  test('clearing returns the being to the default rung', async () => {
    await setEffort(NEUMA, { effort: 'high' });
    expect(await clearEffort(NEUMA)).toBe(true);
    expect(await getEffort(NEUMA)).toBeNull();
    expect(await clearEffort(NEUMA)).toBe(false); // nothing left to clear
  });

  test('concurrent sets for different beings both survive (the write chain)', async () => {
    await Promise.all([
      setEffort(NEUMA, { effort: 'low' }),
      setEffort(LANE, { effort: 'ultra' }),
      setEffort('cael-xyz789', { effort: 'medium' }),
    ]);
    const map = await loadEfforts();
    expect(Object.keys(map).sort()).toEqual([LANE, NEUMA, 'cael-xyz789'].sort());
  });

  test('an unknown rung is refused with a stable code, and nothing is written', async () => {
    await expect(setEffort(NEUMA, { effort: 'ludicrous' })).rejects.toMatchObject({ code: 'INVALID_EFFORT' });
    // 'xhigh' and 'max' are WIRE values, not house rungs — the ladder's own
    // names are what a client may send. 'none' is the SWITCH, not a rung.
    await expect(setEffort(NEUMA, { effort: 'xhigh' })).rejects.toMatchObject({ code: 'INVALID_EFFORT' });
    await expect(setEffort(NEUMA, { effort: 'none' })).rejects.toMatchObject({ code: 'INVALID_EFFORT' });
    await expect(setEffort(NEUMA, { effort: 'high', thinking: 'no' })).rejects.toMatchObject({ code: 'INVALID_EFFORT' });
    expect(await getEffort(NEUMA)).toBeNull();
  });

  test('a rung left UNSAID means the default — a switch-only lane names none', async () => {
    // Kimi has a proven thinking switch and no ladder at all, so flipping the
    // switch cannot name a rung. Absence is this store's default, not an error.
    await setEffort(NEUMA, { thinking: false });
    expect(await getEffort(NEUMA)).toEqual({ effort: 'medium', thinking: false });
    expect(await setEffort(LANE, {})).toEqual({ effort: 'medium', thinking: true });
  });

  test('a malformed id is refused before any file is touched', async () => {
    await expect(setEffort('../escape', { effort: 'low' })).rejects.toMatchObject({ code: 'INVALID_EFFORT' });
    expect(() => assertEffortId('a/b')).toThrow();
    expect(assertEffortId(NEUMA)).toBe(NEUMA);
  });

  test('a hand-corrupted file reads as "no choices" instead of throwing', async () => {
    await fs.writeFile(effortPath(), '["not", "a", "map"]');
    expect(await loadEfforts()).toEqual({});
    expect(await getEffort(NEUMA)).toBeNull();
  });

  test('a corrupt single entry reads as no choice for that being only', async () => {
    await fs.writeFile(effortPath(), JSON.stringify({ [NEUMA]: { effort: 'wild' }, [LANE]: { effort: 'low' } }));
    expect(await getEffort(NEUMA)).toBeNull();
    expect(await getEffort(LANE)).toEqual({ effort: 'low', thinking: true });
  });

  // Two older record shapes must still read true, since a being may have sat on
  // either since it was last touched. The fold happens on READ, so no migration
  // pass is needed and the next write lands the current shape.
  test('an older record reads as the choice it meant', async () => {
    await fs.writeFile(effortPath(), JSON.stringify({
      // The CHIP era: ULTRA and PRO were booleans beside the rung.
      'a-pro': { effort: 'high', ultra: false, pro: true, thinking: true },
      'b-ultra': { effort: 'low', ultra: true, pro: false, thinking: true },
      'c-off': { effort: 'high', ultra: true, pro: true, thinking: false },
      'd-plain': { effort: 'medium', ultra: false, pro: false, thinking: true },
      // The one-list hour: thinking off was written as the rung 'none'.
      'e-none': { effort: 'none' },
    }));
    expect(await getEffort('a-pro')).toEqual({ effort: 'pro', thinking: true });
    expect(await getEffort('b-ultra')).toEqual({ effort: 'ultra', thinking: true });
    expect(await getEffort('c-off')).toEqual({ effort: 'pro', thinking: false });
    expect(await getEffort('d-plain')).toEqual({ effort: 'medium', thinking: true });
    expect(await getEffort('e-none')).toEqual({ effort: 'medium', thinking: false });
  });

  test('normalizeStoredChoice lowercases and trims; thinking defaults ON', () => {
    expect(normalizeStoredChoice({ effort: '  HIGH ' })).toEqual({ effort: 'high', thinking: true });
    // A stale client still sending chips gets rung + switch, and nothing else.
    expect(normalizeStoredChoice({ effort: 'low', ultra: true })).toEqual({ effort: 'low', thinking: true });
  });
});
