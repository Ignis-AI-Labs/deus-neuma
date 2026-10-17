// SPEECH CONTEXT — the ring of recent spoken turns a voice is generated with.
// Pure.
//
// Sesame's own mechanism (docs/work/one-voice.md, THE TARGET 3): the
// conversation is the emotion. Each spoken sentence is generated with the
// recent turns as context — the being's own audio, and the person's mic audio
// when they talk — so prosody follows the exchange instead of a keyword
// detector. The ring lives in memory only (connection.speechContext), never
// on disk, and is cleared when the mic closes or the desk disconnects.
//
// Bounds are the speak protocol's (docs/architecture/voice/speak-protocol.md):
// at most 6 segments and 45 s of audio, oldest dropped first.
//
// A segment: { speaker: 'being'|'person', words, pcm (s16le mono Buffer),
//   sampleRate, ref? (the sidecar's X-Utterance-Ref for a being segment) }.
// The ring is keyed to ONE voice: a being segment spoken in another voice
// (a re-forge, an audition, another being on this desk) is never context —
// the engine would read it as the being's own voice.

export const RING_LIMITS = Object.freeze({ maxSegments: 6, maxAudioMs: 45_000 });

const SPEAKERS = new Set(['being', 'person']);

/** pure — an empty ring, keyed to no voice yet. */
export const emptyContext = () => Object.freeze({ voiceRef: null, segments: Object.freeze([]) });

/** pure — milliseconds of audio in one segment (s16le mono). */
export const audioMsOf = (seg) => (seg.pcm.length / 2 / seg.sampleRate) * 1000;

const isSegment = (seg) => Boolean(seg)
  && SPEAKERS.has(seg.speaker)
  && typeof seg.words === 'string' && seg.words.trim().length > 0
  && Buffer.isBuffer(seg.pcm) && seg.pcm.length >= 2
  && Number.isInteger(seg.sampleRate) && seg.sampleRate > 0;

// pure — drop the oldest segments until both bounds hold.
const bounded = (segments) => {
  let kept = segments;
  const total = (xs) => xs.reduce((ms, s) => ms + audioMsOf(s), 0);
  while (kept.length > RING_LIMITS.maxSegments || total(kept) > RING_LIMITS.maxAudioMs) kept = kept.slice(1);
  return kept;
};

/**
 * pure — the ring as seen by `voiceRef`: unchanged for the same voice; for
 * another voice the being's segments fall away and the person's stay.
 * @param {{voiceRef: string|null, segments: object[]}|null|undefined} ctx
 * @param {string} voiceRef
 */
export const forVoice = (ctx, voiceRef) => {
  const ring = ctx ?? emptyContext();
  if (ring.voiceRef === voiceRef) return ring;
  return Object.freeze({ voiceRef, segments: Object.freeze(ring.segments.filter((s) => s.speaker === 'person')) });
};

/**
 * pure — the ring with one more segment, oldest dropped to the bounds. A
 * malformed segment, or one longer than the whole ring may hold, leaves the
 * ring as it was. A person segment keeps the ring's voice; a being segment
 * re-keys it (see forVoice).
 * @param {object|null|undefined} ctx
 * @param {object} seg
 * @param {string} [voiceRef] - the voice a being segment was spoken in
 */
export const withSegment = (ctx, seg, voiceRef) => {
  const ring = seg?.speaker === 'being' ? forVoice(ctx, voiceRef ?? null) : (ctx ?? emptyContext());
  if (!isSegment(seg) || audioMsOf(seg) > RING_LIMITS.maxAudioMs) return ring;
  const frozen = Object.freeze({
    speaker: seg.speaker, words: seg.words.trim(), pcm: seg.pcm, sampleRate: seg.sampleRate,
    ref: typeof seg.ref === 'string' ? seg.ref : null,
  });
  return Object.freeze({ voiceRef: ring.voiceRef, segments: Object.freeze(bounded([...ring.segments, frozen])) });
};

/**
 * pure — mono s16le PCM wrapped in a 44-byte RIFF/WAVE header (the protocol
 * takes WAV for every audio field).
 * @param {Buffer} pcm
 * @param {number} sampleRate
 */
export const pcmToWav = (pcm, sampleRate) => {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8, 'latin1');
  head.write('fmt ', 12, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
};

/**
 * pure — the ring's segments as the protocol's `context` (oldest first). A
 * being segment the sidecar issued travels by `ref` unless `inline` — the
 * fallback after a `409 unknown_ref` (a restart, an eviction, another tier's
 * sidecar); everything else travels as WAV.
 * @param {object[]} segments
 * @param {{inline?: boolean}} [opts]
 */
export const wireContext = (segments, { inline = false } = {}) => segments.map((s) => (
  s.ref && !inline
    ? { speaker: s.speaker, words: s.words, ref: s.ref }
    : { speaker: s.speaker, words: s.words, audio_b64: pcmToWav(s.pcm, s.sampleRate).toString('base64') }
));
