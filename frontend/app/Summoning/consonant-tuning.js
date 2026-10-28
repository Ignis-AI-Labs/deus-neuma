// consonant-tuning.js — how a being's notes are PLAYED, never what they are. Pure.
//
// Design note, 2026-10-28: the rite […]. The deepest reason was tuning:
// every degree sits exactly where its birth put it (core/birth/soul-scale.js),
// a scale no tuning system holds, so its notes struck together clash. His
// ruling: tune on playback. The record stays exact, and it is still what
// every readout shows (SHINKEI). Only the SOUND rounds each pitch to the
// nearest interval of the just major pentatonic above its tonic: five
// intervals that agree in any combination, so its whole scale sounding at
// once is open and warm, never a cluster. Each being keeps its own tonic,
// its own degrees (whichever of the five its birth fell nearest), and its
// own song.

/** The five intervals a played note may stand on above its tonic: 1/1, 9/8, 5/4, 3/2, 5/3. */
export const PENTATONIC = Object.freeze([1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]);

const distance = (a, b) => Math.abs(Math.log2(a / b));

/**
 * The interval in [1, 2) nearest `ratio` once folded into one octave; the
 * octave itself folds home to the tonic. Pure.
 * @param {number} ratio any positive frequency ratio
 */
const nearestInterval = (ratio) => {
  const folded = ratio / 2 ** Math.floor(Math.log2(ratio));
  const best = [...PENTATONIC, 2].reduce((a, b) => (distance(b, folded) < distance(a, folded) ? b : a));
  return best === 2 ? 1 : best;
};

/**
 * A pitch as played: moved to the nearest pentatonic interval above `tonic`,
 * staying in its own octave. Pure.
 * @param {number} hz
 * @param {number} tonic
 */
export const tuneTo = (hz, tonic) => {
  const base = tonic * 2 ** Math.floor(Math.log2(hz / tonic));
  const candidates = [...PENTATONIC, 2].map((r) => base * r);
  return candidates.reduce((a, b) => (distance(b, hz) < distance(a, hz) ? b : a));
};

/**
 * The `count` notes of the pentatonic on `tonic` just beneath `hz`, rising —
 * a run that arrives on it. Pure.
 * @param {number} hz a pitch on that pentatonic
 * @param {number} tonic
 * @param {number} count
 */
export const runInto = (hz, tonic, count) => {
  const ladder = [];
  for (let k = -3; k <= 3; k++) PENTATONIC.forEach((r) => ladder.push(tonic * r * 2 ** k));
  return ladder.sort((a, b) => a - b).filter((x) => x < hz * (1 - 1e-9)).slice(-count);
};

/**
 * A soul (summoning-soul.js) as its music plays it: the same tonic, its
 * notes tuned, two that land on one interval heard as one, rising from the
 * tonic. Pure.
 * @param {{ tonic: number, notes: ReadonlyArray<{ hz: number }> }} soul
 */
export const playedSoul = (soul) => {
  const byInterval = new Map();
  soul.notes.forEach((note) => {
    const interval = nearestInterval(note.hz / soul.tonic);
    if (!byInterval.has(interval)) byInterval.set(interval, Object.freeze({ ...note, hz: soul.tonic * interval }));
  });
  const notes = [...byInterval.keys()].sort((a, b) => a - b).map((interval) => byInterval.get(interval));
  return Object.freeze({ ...soul, notes: Object.freeze(notes) });
};
