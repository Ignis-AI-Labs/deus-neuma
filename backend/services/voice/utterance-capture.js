// UTTERANCE CAPTURE — the person's own audio for one spoken line, so the voice
// can hear how they said it (the speech-context ring's `person` segments). Pure.
//
// The mic path forwards 16 kHz s16le mono PCM to the whisper sidecar
// (voice:mic_pcm → VoiceStreamSession.sendPcm). Beside it, this keeps:
//   - before speech: a short rolling PRE-ROLL, because the VAD declares
//     speech_started a beat after the first syllable;
//   - from speech_started to the utterance: everything, up to MAX_MS (the most
//     recent kept — a line longer than that keeps its end, nearest the reply).
// The utterance (the sidecar's finalized words) closes the line: its audio and
// words become one segment and the capture starts over. Memory only, never
// disk, never logged (threat control #5).

export const CAPTURE = Object.freeze({ sampleRate: 16_000, preRollMs: 500, maxMs: 30_000, minMs: 300 });

const bytesFor = (ms) => Math.round((ms * CAPTURE.sampleRate) / 1000) * 2;

/** pure — nothing heard yet. */
export const emptyCapture = () => Object.freeze({ chunks: Object.freeze([]), bytes: 0, speaking: false });

// pure — the newest `maxBytes` (whole samples) of the chunks.
const keepTail = (chunks, bytes, maxBytes) => {
  if (bytes <= maxBytes) return { chunks, bytes };
  // maxBytes is whole samples, so the kept tail stays sample-aligned to the newest byte.
  let drop = bytes - maxBytes;
  const kept = [];
  for (const c of chunks) {
    if (drop >= c.length) { drop -= c.length; continue; }
    kept.push(drop > 0 ? c.subarray(drop) : c);
    drop = 0;
  }
  return { chunks: kept, bytes: kept.reduce((n, c) => n + c.length, 0) };
};

/**
 * pure — the capture with one more mic chunk: bounded to the pre-roll before
 * speech, to MAX_MS during it.
 * @param {object} cap
 * @param {Buffer} pcm - 16 kHz s16le mono
 */
export const withPcm = (cap, pcm) => {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0) return cap;
  const limit = bytesFor(cap.speaking ? CAPTURE.maxMs : CAPTURE.preRollMs);
  const { chunks, bytes } = keepTail([...cap.chunks, pcm], cap.bytes + pcm.length, limit);
  return Object.freeze({ chunks: Object.freeze(chunks), bytes, speaking: cap.speaking });
};

/** pure — the VAD heard speech start: keep everything from here (and the pre-roll). */
export const withSpeechStarted = (cap) => (cap.speaking ? cap : Object.freeze({ ...cap, speaking: true }));

/**
 * pure — close the line. A line with words and at least MIN_MS of audio heard
 * since speech started becomes a `person` segment; either way the capture
 * starts over.
 * @param {object} cap
 * @param {string} words - the finalized utterance text
 * @returns {{capture: object, segment: object|null}}
 */
export const takeUtterance = (cap, words) => {
  const heard = cap.speaking && cap.bytes >= bytesFor(CAPTURE.minMs) && typeof words === 'string' && words.trim();
  return {
    capture: emptyCapture(),
    segment: heard
      ? Object.freeze({ speaker: 'person', words: words.trim(), pcm: Buffer.concat(cap.chunks), sampleRate: CAPTURE.sampleRate })
      : null,
  };
};
