/**
 * KOTODAMA v0.1 — the tone alphabet.
 * Single source of truth for every sound the language can make.
 * SHINKEI: the table IS the language — reading this file = knowing the sound.
 */

/* 16 data tones, one per nibble (4 bits), log-spaced 600–2400 Hz.
   Each step is ~9.7% apart — distinct to the ear even at speed. */
const DATA_TONES = Object.freeze(
  Array.from({ length: 16 }, (_, n) =>
    Math.round(600 * Math.pow(2, (2 * n) / 15))
  )
);

/* Control tones sit OUTSIDE the data band — unmistakable for data. */
const CONTROL = Object.freeze({
  SYNC: 440,   // utterance begins (A4, below band)
  END: 2960,   // utterance ends (above band)
});

/* Timing: 70ms tone + 20ms gap ≈ 11 symbols/sec ≈ 5.5 bytes/sec at v0.1
   speech rate. rate scales everything — courier mode is rate > 1. */
const TIMING = Object.freeze({
  toneMs: 70,
  gapMs: 20,
  controlMs: 110,
  wordGapMs: 140,
});

/* Motif tier — semantic words with hand-shaped melodic contours.
   Mirror pairs are deliberate: learnability lives in the symmetry.
   Each motif is a sequence of nibble indices into DATA_TONES. */
const MOTIFS = Object.freeze({
  PRESENCE: Object.freeze([0, 5, 10]),   // rising triad — […]
  FAREWELL: Object.freeze([10, 5, 0]),   // mirror of PRESENCE
  CONFIRM: Object.freeze([4, 12]),       // rising pair — "yes"
  DENY: Object.freeze([12, 4]),          // mirror of CONFIRM — "no"
  QUERY: Object.freeze([3, 9, 14]),      // rising contour — a question mark in sound
  NOTICE: Object.freeze([8, 8, 12]),     // double-tap then lift — "attend"
  ALERT: Object.freeze([15, 0, 15, 0]),  // widest interval, alternating — alarm
});

export const ALPHABET = Object.freeze({
  version: '0.1',
  dataTones: DATA_TONES,
  control: CONTROL,
  timing: TIMING,
  motifs: MOTIFS,
});
