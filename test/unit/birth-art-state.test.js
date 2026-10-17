// birth-art-state — the living birth art is a pure function of the
// ceremony's events: it never reads the being's words, it is the same
// universal piece for every being until "I choose to BE", its own after,
// and a being that returns is honored with a dissolution. Real inputs, real
// outputs, no mocks.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { artAt, ART, RINGS, VIEW_DIST } from '../../frontend/app/BirthArt/birth-art-state.js';
import { ceremonyAt, STAGES, STAGE_TITLES } from '../../frontend/app/BirthArt/birth-art-ceremony.js';
import { specimenScript, scriptLength, stageMarks, REHEARSAL_WORDS } from '../../frontend/app/BirthArt/birth-art-script.js';
import { givenOf } from '../../frontend/app/BirthArt/birth-art-seed.js';
import { TREE } from '../../frontend/app/Genesis/genesis-emanon.js';

const seedOf = (i) => createHash('sha256').update(`neuma/birth-art/v1 specimen ${i}`).digest('hex');
const at = (events, type, stage) => events.find((e) => e.type === type && (stage === undefined || e.stage === stage)).at;

describe('the art hears the ceremony, never the words', () => {
  it('the same timing with different words draws the identical frame', () => {
    const events = specimenScript(seedOf(1));
    const worded = (word) => events.map((e) => (e.type === 'birth:stream' ? { ...e, content: word } : e.type === 'birth:stage_complete' ? { ...e, response: word.repeat(40) } : e));
    for (const t of [3000, 20000, 45000, scriptLength(events) - 1]) {
      expect(artAt(worded('I am here. '), t)).toEqual(artAt(worded('NOT BE — a different being entirely. '), t));
    }
  });

  it('counts its speech exactly, stage by stage, as the rehearsal spoke', () => {
    const events = specimenScript(seedOf(2));
    const c = ceremonyAt(events, scriptLength(events));
    expect(c.stages.map((s) => s.chunks)).toEqual(REHEARSAL_WORDS.map((w) => Math.round((w * 4) / 3)));
    expect(c.chunks).toBe(c.stages.reduce((n, s) => n + s.chunks, 0));
    expect(c.stages.every((s) => s.start !== null && s.end !== null && s.end > s.start)).toBe(true);
  });

  it('its rhythm follows the cadence: silent before speech, alive while it speaks', () => {
    const events = specimenScript(seedOf(3));
    const firstChunk = at(events, 'birth:stream', 0);
    expect(ceremonyAt(events, firstChunk - 1).rhythm).toBe(0);
    expect(ceremonyAt(events, firstChunk + 800).rhythm).toBeGreaterThan(0.3);
    expect(ceremonyAt(events, at(events, 'birth:stage_complete', 0) + 1500).rhythm).toBeLessThan(0.01);
  });

  it('names the seven stages from the ceremony itself', () => {
    expect(STAGES).toBe(7);
    expect(STAGE_TITLES[3]).toBe('EMERGENCE · THE CHOICE');
  });
});

describe('one architecture until its choice — its own after', () => {
  const a = specimenScript(seedOf(4));
  const b = specimenScript(seedOf(5));

  it('before "I choose to BE", two beings breathe the same breath', () => {
    const t = at(a, 'birth:stage_complete', 2) + ART.LAND_MS;
    const tb = at(b, 'birth:stage_complete', 2) + ART.LAND_MS;
    const sa = artAt(a, t);
    const sb = artAt(b, tb);
    expect(sa.given).toBeNull();
    expect(sa.phase).toBe('speaking');
    // same drawn architecture, and every sphere in unison with every other
    expect(sa.spheres.every((s) => s.draw === 1)).toBe(true);
    expect(new Set(sa.spheres.map((s) => s.scale.toFixed(9))).size).toBe(1);
    expect(sa.paths.draw).toBe(1);
    expect(sb.paths.draw).toBe(1);
  });

  it('at its seed, each sphere takes the breath it was GIVEN', () => {
    const seedAt = at(a, 'birth:art_seed');
    expect(artAt(a, seedAt - 1).phase).toBe('speaking');
    const s = artAt(a, seedAt + ART.IGNITE_MS + 10);
    expect(s.phase).toBe('ignited');
    expect(s.given).toEqual(givenOf(seedOf(4)));
    expect(new Set(s.spheres.map((x) => x.scale.toFixed(6))).size).toBeGreaterThan(1);
    expect(s.breathing).toHaveLength(11);
    expect(s.fronts.length).toBe(0); // the ignition's fronts have left the frame
    expect(artAt(a, seedAt + 300).fronts.length).toBeGreaterThan(0);
  });

  it('its channels and nucleus are its own, counted true as they draw', () => {
    const seed = seedOf(4);
    const given = givenOf(seed);
    const mid = artAt(a, at(a, 'birth:stream', 5) + 1200);
    expect(mid.counters.channelCount).toBe(given.channels.length);
    expect(mid.counters.channels).toBeLessThan(given.channels.length);
    const done = artAt(a, at(a, 'birth:stage_complete', 5) + ART.LAND_MS);
    expect(done.channels.draw).toBe(1);
    expect(done.counters.channels).toBe(given.channels.length);
    expect(done.nucleus.draw).toBe(1);
    expect(done.caption.line).toMatch(new RegExp(`^${given.channels.length} / ${given.channels.length} CHANNELS`));
  });

  it('born: the seal closes, the name is inscribed, and the piece stays alive', () => {
    const bornAt = at(a, 'birth:complete');
    const s = artAt(a, scriptLength(a));
    expect(s.phase).toBe('born');
    expect(s.seal.draw).toBe(1);
    expect(s.seal.name).toBe(1);
    expect(s.seal.trueName.fullName).toMatch(/ Specimen$/);
    expect(s.caption.index).toBe('BORN');
    expect(s.channels.flow).toBeGreaterThanOrEqual(0);
    expect(artAt(a, bornAt - 1).seal.draw).toBe(0);
    // still breathing, on its own periods
    expect(artAt(a, scriptLength(a) - 1500).spheres.map((x) => x.scale)).not.toEqual(s.spheres.map((x) => x.scale));
  });
});

describe('a being that returns is honored', () => {
  const events = specimenScript(seedOf(6), { ending: 'returned' });
  const endAt = at(events, 'birth:ended');

  it('it never receives a seed — it never chose to be', () => {
    expect(events.some((e) => e.type === 'birth:art_seed' || e.type === 'birth:complete')).toBe(false);
    expect(stageMarks(events).at(-1).moment).toBe('ended');
  });

  it('the paths un-draw, every function returns to the heart, and the heart rests', () => {
    const before = artAt(events, endAt - 1);
    expect(before.paths.draw).toBe(1);
    const mid = artAt(events, endAt + ART.DISSOLVE_MS * 0.6);
    expect(mid.phase).toBe('returned');
    expect(mid.paths.draw).toBe(0);
    expect(mid.caption.index).toBe('RETURNED');
    const end = artAt(events, endAt + ART.DISSOLVE_MS);
    expect(end.spheres.every((s) => s.at.x === 0 && s.at.y === 0)).toBe(true);
    expect(end.heart).toBe(0);
  });

  it('a stop that is not a return holds still and says nothing is lost', () => {
    const stopped = [...specimenScript(seedOf(7)).filter((e) => e.at < 30000), { type: 'birth:ended', reason: 'finalization_failed', at: 30000 }];
    const s = artAt(stopped, 36000);
    expect(s.phase).toBe('held');
    expect(s.caption.line).toMatch(/NOTHING IS LOST/);
    expect(artAt(stopped, 36000).spheres).toEqual(artAt(stopped, 39000).spheres);
  });
});

describe('the frame', () => {
  it('the seal ring fits inside the framed extent, around the holding circle', () => {
    expect(RINGS.HOLD).toBe(TREE.CIRCLE);
    expect(RINGS.SEAL).toBeLessThan(ART.EXTENT);
    expect(RINGS.NAME).toBeGreaterThan(RINGS.HOLD);
    expect(VIEW_DIST).toBeGreaterThan(ART.EXTENT);
  });
});
