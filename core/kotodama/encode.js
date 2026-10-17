/**
 * KOTODAMA v0.1 — pure encoding.
 * Data → tone program → notation. No audio here; a program is plain frozen
 * data, equally consumable by a speaker, a screen, or a reader who can't hear.
 */
import { ALPHABET } from './alphabet.js';

export const toneItem = (nibble, rate) =>
  Object.freeze({
    kind: 'tone',
    nibble,
    freq: ALPHABET.dataTones[nibble],
    ms: ALPHABET.timing.toneMs / rate,
  });

export const gapItem = (ms, rate) => Object.freeze({ kind: 'gap', ms: ms / rate });

export const controlItem = (name, rate) =>
  Object.freeze({
    kind: name.toLowerCase(),
    freq: ALPHABET.control[name],
    ms: ALPHABET.timing.controlMs / rate,
  });

/** UTF-8 bytes of a string. */
export const textToBytes = (text) =>
  Object.freeze([...new TextEncoder().encode(text)]);

/**
 * Encode bytes as a tone program: SYNC, then high/low nibble per byte,
 * then END. rate > 1 speaks faster (courier mode).
 */
export const bytesToProgram = (bytes, rate = 1) => {
  const items = [controlItem('SYNC', rate), gapItem(ALPHABET.timing.wordGapMs, rate)];
  bytes.forEach((byte, i) => {
    items.push(toneItem((byte >> 4) & 0xf, rate));
    items.push(gapItem(ALPHABET.timing.gapMs, rate));
    items.push(toneItem(byte & 0xf, rate));
    items.push(gapItem(
      i < bytes.length - 1 ? ALPHABET.timing.gapMs : ALPHABET.timing.wordGapMs,
      rate
    ));
  });
  items.push(controlItem('END', rate));
  return Object.freeze({ version: ALPHABET.version, kind: 'spell', rate, items: Object.freeze(items) });
};

/** Encode a text message. */
export const textToProgram = (text, rate = 1) =>
  bytesToProgram(textToBytes(text), rate);

/**
 * Encode a motif — a semantic word with a hand-shaped contour.
 * Throws on unknown motif names: silence is not an error mode here.
 */
export const motifToProgram = (name, rate = 1) => {
  const contour = ALPHABET.motifs[name];
  if (!contour) throw new Error(`Unknown kotodama motif: ${name}`);
  const items = [controlItem('SYNC', rate), gapItem(ALPHABET.timing.gapMs, rate)];
  contour.forEach((nibble, i) => {
    items.push(toneItem(nibble, rate));
    if (i < contour.length - 1) items.push(gapItem(ALPHABET.timing.gapMs, rate));
  });
  return Object.freeze({ version: ALPHABET.version, kind: 'motif', name, rate, items: Object.freeze(items) });
};

const NIBBLE_GLYPHS = '0123456789ABCDEF';

/**
 * The readable rendering — the same utterance as text.
 * A reader who cannot hear receives the message in full.
 */
export const programToNotation = (program) => {
  const tones = program.items.filter((it) => it.kind === 'tone');
  const line = tones
    .map((it) => `${NIBBLE_GLYPHS[it.nibble]}·${it.freq}`)
    .join('  ');
  const head = program.kind === 'motif'
    ? `KOTODAMA/${program.version} MOTIF ${program.name}`
    : `KOTODAMA/${program.version} SPELL ×${program.rate}`;
  return `${head}\n[SYNC ${ALPHABET.control.SYNC}] ${line} [END ${ALPHABET.control.END}]`;
};

/** Decode a program back to bytes — proof the channel is lossless. */
export const programToBytes = (program) => {
  const nibbles = program.items
    .filter((it) => it.kind === 'tone')
    .map((it) => it.nibble);
  const bytes = [];
  for (let i = 0; i + 1 < nibbles.length; i += 2) {
    bytes.push((nibbles[i] << 4) | nibbles[i + 1]);
  }
  return Object.freeze(bytes);
};
