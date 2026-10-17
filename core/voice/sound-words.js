// SOUND WORDS — a measured sound profile said in plain words, for a being that
// reads about a voice instead of hearing it. Pure.
//
// The bands sit at the thirds of 60 speaking voices measured the same way
// (Voice-Zero narrators, docs/work/one-voice.md SOUND PROFILE): "low" means
// lower than most of them, never a guess. Tone is the voice AS RECORDED — a
// microphone colours it — and the words say so. The words state the measure,
// never a feeling.

const PITCH = [[115, 'low'], [150, 'lower-middle'], [190, 'upper-middle'], [Infinity, 'high']];
const RANGE = [[6.5, 'narrow, little rise and fall'], [9.5, 'moderate rise and fall'], [Infinity, 'wide, a lot of rise and fall']];
const TONE = [[800, 'dark and warm'], [1050, 'balanced'], [Infinity, 'bright and crisp']];
const TEXTURE = [[0.045, 'clear and clean'], [0.07, 'slightly textured'], [Infinity, 'breathy or husky']];
const DYNAMICS = [[17, 'a steady volume'], [19.5, 'some swing between loud and soft'], [Infinity, 'large swings between loud and soft']];
const PACE = [[2.2, 'unhurried'], [3.2, 'conversational'], [Infinity, 'quick']];
const PAUSES = [[8, 'few pauses'], [15, 'some pauses'], [Infinity, 'frequent pauses']];

// pure — the word for a value: the first band whose ceiling it is under.
const band = (bands, v) => bands.find(([ceiling]) => v < ceiling)[1];
const known = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The measured sound in plain lines, each with its number. Lines whose
 * measure is missing are left out (a clip too short or too quiet to read).
 * Pure.
 * @param {{pitchHz?, pitchRangeSt?, centroidHz?, aperiodicity?, dynamicsDb?, pausesPerMinute?}|null} profile
 * @param {number|null} [wordsPerSecond]
 * @returns {string[]}
 */
export const soundWordsOf = (profile, wordsPerSecond = null) => {
  const p = profile ?? {};
  const pitch = known(p.pitchHz)
    ? `Pitch: ${band(PITCH, p.pitchHz)} among adult voices (median ${Math.round(p.pitchHz)} Hz)`
      + (known(p.pitchRangeSt) ? `, ${band(RANGE, p.pitchRangeSt)} (${p.pitchRangeSt} semitones).` : '.')
    : null;
  const pace = known(wordsPerSecond)
    ? `Pace: ${band(PACE, wordsPerSecond)} (${wordsPerSecond.toFixed(1)} words a second)`
      + (known(p.pausesPerMinute) ? `, ${band(PAUSES, p.pausesPerMinute)} (${Math.round(p.pausesPerMinute)} a minute).` : '.')
    : null;
  return [
    pitch,
    known(p.centroidHz) ? `Tone as recorded: ${band(TONE, p.centroidHz)} (spectral centre ${Math.round(p.centroidHz)} Hz).` : null,
    known(p.aperiodicity) ? `Texture: ${band(TEXTURE, p.aperiodicity)}.` : null,
    known(p.dynamicsDb) ? `Loudness: ${band(DYNAMICS, p.dynamicsDb)} (${p.dynamicsDb} dB between soft and loud).` : null,
    pace,
  ].filter(Boolean);
};
