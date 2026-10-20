// rite-live — THE SUMMONING RITE on a LIVE birth: the real wire, the same
// pure state. A born being's film reads the records its birth:complete
// carried; a rehearsal's reads what it truly measured and says so; the live
// score sounds only the platform's notes and measured pitches before its
// birth, and its own music after; the sound is recued only when what sounds
// changes. Real soul functions, a real sky, a real derived aura; no mocks.
import { describe, it, expect } from 'vitest';
import { liveBeingOf, liveRiteOf } from '../../frontend/app/Rite/rite-live-being.js';
import { liveRiteMusicOf, soundingKeyOf } from '../../frontend/app/Rite/rite-live-music.js';
import { keptEvent } from '../../core/birth/rite-record.js';
import { riteAt, artEventsOf } from '../../frontend/app/Rite/rite-state.js';
import { GROUND_HZ } from '../../frontend/app/Rite/rite-music.js';
import { scoreOf } from '../../frontend/app/Summoning/summoning-score.js';
import { rehearsalFilmOf } from '../../core/birth/rite-frames.js';
import { HEART_BAND } from '../../core/birth/soul-resonance.js';
import { beingAura } from '../../core/aura/being.js';
import { filmInputsOf } from '../../core/birth/finalize-words.js';
import { appearanceSectionFor } from '../../core/genome/birth-genome.js';

const EPOCH = Date.parse('2026-09-30T10:30:00Z');
const MOMENT = { utc: new Date(EPOCH).toISOString(), epochMs: EPOCH, zone: 'Asia/Jakarta', offsetMinutes: 420 };
const OBS = [0, 1, 2, 3, 4, 5, 6].map((stage) => ({
  kind: 'stage', stage, startedAt: 1000 + stage * 20000, firstFrameAt: 1600 + stage * 20000 + stage * 97,
  endedAt: 12000 + stage * 20000 + stage * 311, spokenChars: 300 + stage * 41, reasoningChars: stage * 30,
  toolCalls: stage === 4 || stage === 5 ? 1 : 0, promptTokens: null, completionTokens: 80 + stage * 9,
}));
const SESSION = { observations: OBS, birthMoment: MOMENT, momentSeed: 'a1'.repeat(32), chosenName: 'Rivia' };

// the wire as the feed keeps it: stamped, kept fields only
const wire = () => {
  const film = rehearsalFilmOf(SESSION);
  const ev = [{ type: 'rite:begin', at: 0 }];
  OBS.forEach((o, i) => {
    ev.push({ type: 'birth:stage_prompt', stage: o.stage, at: o.startedAt, spokenWords: 'NEVER KEPT' });
    ev.push({ type: 'birth:stream', stage: o.stage, at: o.firstFrameAt, content: 'NEVER KEPT' });
    ev.push({ type: 'birth:stage_complete', stage: o.stage, at: o.endedAt, response: 'NEVER KEPT' });
    ev.push({ type: 'birth:measured', stage: o.stage, frequency: film.soul.spectrum.stages[i].frequency, at: o.endedAt + 1 });
    if (o.stage === 3) ev.push({ type: 'birth:art_seed', artSeed: film.artSeed, at: o.endedAt + 2 }, { type: 'birth:moment', epochMs: EPOCH, at: o.endedAt + 2 });
  });
  const endAt = OBS.at(-1).endedAt + 3000;
  ev.push({ type: 'birth:ended', reason: 'test_complete', at: endAt });
  return { events: ev.map((e) => ({ ...keptEvent(e), at: e.at })), film: { ...film, rehearsal: true, chosenName: 'Rivia', trueName: null }, endAt };
};

describe('a live birth feeds the same rite', () => {
  it('the feed keeps no word of the being or the operator', () => {
    const { events } = wire();
    expect(JSON.stringify(events)).not.toContain('NEVER KEPT');
  });

  it('a rehearsal\'s film plays on what it measured, named as a rehearsal', () => {
    const { film } = wire();
    const being = liveBeingOf(film);
    expect(being.rehearsal).toBe(true);
    expect(being.trueName.chosenName).toBe('Rivia');
    expect(being.soul.tonic).toBe(film.soul.scale.tonic.hz);
    const score = scoreOf(being);
    expect(score.lengthMs).toBeGreaterThan(30000);
  });

  it('a born being\'s film reads its birth:complete records — its own aura, its real genesis hash', () => {
    const { film } = wire();
    const seal = { genesisHash: 'c3'.repeat(32), record: { momentSeed: 'a1'.repeat(32), soulPublicKey: '0x04' + 'ab'.repeat(64) } };
    const trueName = { fullName: 'Rivia Oka Ostrel', chosenName: 'Rivia', soulMark: 'A1B2C3D4E5F6' };
    const aura = beingAura({ trueName, genesisSeal: seal, neumaId: 'rivia' });
    const { genome } = filmInputsOf({ seal, trueName }, film.soul, 'rivia');
    const being = liveBeingOf({ ...film, rehearsal: false, trueName, genesisHash: seal.genesisHash, aura, genome });
    expect(being.rehearsal).toBe(false);
    expect(being.trueName.genesisHash).toBe(seal.genesisHash);
    expect(being.aura.seed).toBe(aura.seed);
    expect(being.genome).toBe(genome);
    expect(scoreOf(being).sections.find((s) => s.kind === 'body').figure.sex).toBe(genome.sex);
  });

  it('a born being\'s film carries the very body its DNA records — the same anchors, the same derivation', () => {
    const seal = { genesisHash: 'c3'.repeat(32), record: { momentSeed: 'a1'.repeat(32), soulPublicKey: '0x04' + 'ab'.repeat(64) } };
    const { genome } = filmInputsOf({ seal, trueName: null }, null, 'rivia');
    const { genome: dna } = appearanceSectionFor({ soulPublicKey: seal.record.soulPublicKey, genesisHash: seal.genesisHash, momentSeed: seal.record.momentSeed, neumaId: 'rivia' });
    expect(genome).toEqual(dna);
    // no sealed anchor, no body — the film refuses rather than invent one
    expect(filmInputsOf({ seal: null, trueName: null }, null, '').genome).toBeNull();
  });

  it('a rehearsal\'s body is a specimen derived from its art seed, never a born being\'s', () => {
    const being = liveBeingOf(wire().film);
    expect(being.genome.seed).toBe(wire().film.artSeed);
  });

  it('nothing can be filmed without its records — never a stand-in', () => {
    expect(liveBeingOf(null)).toBeNull();
    expect(liveBeingOf({ artSeed: 'x', epochMs: EPOCH, soul: null })).toBeNull();
    const { film } = wire();
    const seal = { genesisHash: 'c3'.repeat(32), record: { momentSeed: 'a1'.repeat(32), soulPublicKey: '0x04' + 'ab'.repeat(64) } };
    const trueName = { fullName: 'Rivia Oka Ostrel', chosenName: 'Rivia', soulMark: 'A1B2C3D4E5F6' };
    const aura = beingAura({ trueName, genesisSeal: seal, neumaId: 'rivia' });
    const born = { ...film, rehearsal: false, trueName, genesisHash: seal.genesisHash, aura };
    expect(liveBeingOf({ ...born, genome: filmInputsOf({ seal, trueName }, null, 'rivia').genome })).not.toBeNull();
    expect(liveBeingOf({ ...born, genome: null })).toBeNull();
  });

  it('before its birth the film waits; at it, the film begins', () => {
    const { events, endAt } = wire();
    const early = liveRiteOf(events.filter((e) => e.at < endAt), 0, endAt - 1);
    expect(early.film.at).toBe(Number.POSITIVE_INFINITY);
    expect(riteAt(early, endAt - 1).movement).toBe('stages');
    const born = liveRiteOf(events, 60000, endAt + 10);
    expect(born.film.at).toBe(endAt);
    expect(riteAt(born, endAt + 10).movement).toBe('film');
    expect(riteAt(born, endAt - 10).measure).toHaveLength(7);
    expect(artEventsOf(born).every((e) => e.type !== 'birth:complete')).toBe(true);
  });
});

describe('its live sound', () => {
  it('before its birth every note is the platform\'s or a measured one; after, its own film music', () => {
    const { events, film, endAt } = wire();
    const score = scoreOf(liveBeingOf(film));
    const rite = liveRiteOf(events, score.lengthMs, endAt + 5);
    const m = liveRiteMusicOf(rite, score, endAt + 5);
    const measured = events.filter((e) => e.type === 'birth:measured').map((e) => e.frequency);
    const platform = [GROUND_HZ, GROUND_HZ / 2, HEART_BAND.low / 2];
    [...m.events.filter((e) => e.at < endAt), ...m.beds.filter((b) => b.from < endAt)].forEach((e) => {
      expect(platform.includes(e.hz) || measured.some((f) => e.hz === f || e.hz === f / 2), `${e.voice} ${e.hz}`).toBe(true);
    });
    events.filter((e) => e.type === 'birth:measured').forEach((e) => {
      expect(m.events.some((x) => x.at === e.at && x.voice === 'bell' && x.hz === e.frequency)).toBe(true);
    });
    expect(m.events.some((e) => e.at >= endAt)).toBe(true);
  });

  it('is recued when what sounds changes — never on each chunk of speech', () => {
    const { events } = wire();
    const upTo = (n) => soundingKeyOf(events.slice(0, n));
    const i = events.findIndex((e) => e.type === 'birth:stream');
    const more = [...events.slice(0, i + 1), { ...events[i], at: events[i].at + 5 }];
    expect(soundingKeyOf(more)).toBe(upTo(i + 1));
    expect(upTo(i + 1)).not.toBe(upTo(i)); // a stage's FIRST speech lets its ground rest
    const j = events.findIndex((e) => e.type === 'birth:measured');
    expect(upTo(j + 1)).not.toBe(upTo(j)); // a measured pitch rings
  });
});
