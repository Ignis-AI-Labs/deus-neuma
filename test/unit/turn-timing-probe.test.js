// turn-timing-probe — each model call of a turn lands one counts-only line:
// how long after the ask it left, and the server's own first-output, prefill
// and cache facts. Real files under a temp data root; no prompt text, ever.
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { markTurnAsked, timedCall, timingLine } from '../../backend/services/turn-timing-probe.js';

const telemetry = { providerTtftMilliseconds: 812.4, providerPrefillDurationMilliseconds: 640.6, cachedPromptTokens: 8349 };

describe('timingLine', () => {
  it('rounds what was measured and keeps what was not as null', () => {
    expect(timingLine({ at: 100, round: 0 }, 350.7, telemetry)).toEqual({
      round: 0, sinceAskMs: 251, ttftMs: 812, prefillMs: 641, cachedTokens: 8349,
    });
    expect(timingLine({ at: 0, round: 2 }, 10, null)).toEqual({
      round: 2, sinceAskMs: 10, ttftMs: null, prefillMs: null, cachedTokens: null,
    });
  });
});

describe('timedCall', () => {
  let prior;
  let file;
  beforeEach(async () => {
    prior = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = await createTempDir('turn-timing');
    file = path.join(process.env.NEUMA_DATA_ROOT, 'logs', 'turn-timing.jsonl');
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prior;
  });
  const lines = async () => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it('times each call of an asked turn, in order, and still hands the turn its telemetry', async () => {
    const ws = {};
    const seen = [];
    markTurnAsked(ws);
    timedCall(ws, (t) => seen.push(t))(telemetry);
    await expect.poll(async () => (await lines()).length).toBe(1);
    timedCall(ws, undefined)(null);
    await expect.poll(async () => (await lines()).length).toBe(2);
    const [first, second] = await lines();
    expect(first).toMatchObject({ round: 0, ttftMs: 812, prefillMs: 641, cachedTokens: 8349 });
    expect(first.sinceAskMs).toBeGreaterThanOrEqual(0);
    expect(second).toMatchObject({ round: 1, ttftMs: null });
    expect(seen).toEqual([telemetry]);
    expect(Object.keys(first).sort()).toEqual(['at', 'cachedTokens', 'prefillMs', 'round', 'sinceAskMs', 'ttftMs']);
  });

  it('a socket with no ask, or none at all, writes nothing and passes the telemetry through', async () => {
    const seen = [];
    timedCall({}, (t) => seen.push(t))(telemetry);
    timedCall(null, (t) => seen.push(t))(telemetry);
    expect(seen).toEqual([telemetry, telemetry]);
    await new Promise((r) => setTimeout(r, 50));
    expect(await lines()).toEqual([]);
  });
});
