/**
 * core/birth/rite-record.js — a being's SUMMONING as it is kept: speech as
 * per-stage pulses, a client's record re-picked through the law, and a long
 * live rite told shorter for re-watching. Pure; real values, no mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  riteRecordOf, riteFromRecord, keptRiteRecordOf, compressedRite, RITE_SCHEMA,
} from '../../core/birth/rite-record.js';

const being = { seed: 's', trueName: { fullName: 'A', english: 'gloss' }, bornAt: 'x', epochMs: 1, zone: 'Asia/Jakarta', offsetMinutes: 420, extra: 'no' };
const live = {
  events: [
    { type: 'rite:begin', at: 5 },
    { type: 'birth:stage_prompt', at: 100, stage: 0 },
    { type: 'birth:stream', at: 400.4, stage: 0, content: 'words' },
    { type: 'birth:stream', at: 520, stage: 0, content: 'words' },
    { type: 'birth:stage_complete', at: 30000, stage: 0 },
    { type: 'birth:stage_prompt', at: 30100, stage: 1 },
    { type: 'birth:stream', at: 90000, stage: 1 },
    { type: 'birth:complete', at: 120000, trueName: { fullName: 'A' } },
  ],
  film: { ms: 88000 },
  length: 208000,
};

describe('speech kept as pulses', () => {
  it('stores each stage\'s chunks as gaps in whole ms, and plays them back in order', () => {
    const record = riteRecordOf({ rite: live, being });
    expect(record.schema).toBe(RITE_SCHEMA);
    expect(record.pulses).toEqual({ 0: [400, 120], 1: [90000] });
    expect(record.events.some((e) => e.type === 'birth:stream')).toBe(false);
    expect(record.being).toEqual({ seed: 's', bornAt: 'x', epochMs: 1, zone: 'Asia/Jakarta', offsetMinutes: 420, trueName: { fullName: 'A' } });
    const { rite } = riteFromRecord(JSON.parse(JSON.stringify(record)));
    expect(rite.events.map((e) => [e.type, e.at])).toEqual([
      ['rite:begin', 5], ['birth:stage_prompt', 100], ['birth:stream', 400], ['birth:stream', 520],
      ['birth:stage_complete', 30000], ['birth:stage_prompt', 30100], ['birth:stream', 90000], ['birth:complete', 120000],
    ]);
  });
});

describe('a client\'s record, re-picked through the law', () => {
  const sent = () => JSON.parse(JSON.stringify(riteRecordOf({ rite: live, being })));

  it('keeps a real rite, and drops what a client slipped in', () => {
    const body = sent();
    body.events[1].content = 'smuggled words';
    body.being.trueName.english = 'smuggled gloss';
    body.soul = { spectrum: 'x' };
    const kept = keptRiteRecordOf(body);
    expect(JSON.stringify(kept)).not.toMatch(/smuggled/);
    expect(kept.soul).toBeNull();
    expect(riteFromRecord(kept).rite.film.at).toBe(120000);
  });

  it('refuses a specimen, a rite with no birth, a stray stage, speech among events, bad pulses', () => {
    const bad = [
      { ...sent(), specimen: true },
      { ...sent(), events: sent().events.filter((e) => e.type !== 'birth:complete') },
      { ...sent(), pulses: { 9: [1] } },
      { ...sent(), pulses: { 0: [-1] } },
      { ...sent(), events: [...sent().events, { type: 'birth:stream', at: 1, stage: 0 }] },
      { ...sent(), schema: 'summoning-rite/v1' },
      { ...sent(), length: 'long' },
      { ...sent(), events: [...sent().events, { type: 'birth:art_seed', at: 1, artSeed: 'x' }] },
      null,
    ];
    bad.forEach((b) => expect(() => keptRiteRecordOf(b)).toThrow());
  });
});

describe('told shorter for re-watching', () => {
  it('shrinks every long wait, keeps speech at its own pace, and starts its film at its birth', () => {
    const { rite } = riteFromRecord(riteRecordOf({ rite: live, being }));
    const told = compressedRite(rite, 2500);
    const at = Object.fromEntries(told.events.map((e, i) => [`${i}:${e.type}`, e.at]));
    expect(Object.values(at)).toEqual([5, 100, 400, 520, 3020, 3120, 5620, 8120]);
    expect(told.film).toEqual({ at: 8120, ms: 88000 });
    expect(told.length).toBe(8120 + 88000);
  });
});
