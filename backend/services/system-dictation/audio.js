// audio — the microphone side of dictation in every app (system-dictation.js): the recorders a
// Linux desktop has, each asked for 16 kHz mono 16-bit raw samples on stdout, and those samples
// wrapped as the WAV the speech engine reads. Pure.

const RATE = 16000;

/** The recorders, in the order they are tried: PipeWire's, PulseAudio's, ALSA's. */
export const RECORDERS = Object.freeze({
  'pw-record': Object.freeze(['--raw', '--rate', String(RATE), '--channels', '1', '--format', 's16', '-']),
  parecord: Object.freeze(['--raw', `--rate=${RATE}`, '--channels=1', '--format=s16le']),
  arecord: Object.freeze(['-q', '-f', 'S16_LE', '-r', String(RATE), '-c', '1', '-t', 'raw']),
});

/**
 * Raw 16 kHz mono s16le samples as a WAV file. Pure.
 * @param {Buffer} pcm
 * @returns {Buffer}
 */
export const pcmToWav = (pcm) => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(1, 22);          // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);   // bytes a second
  header.writeUInt16LE(2, 32);          // bytes a frame
  header.writeUInt16LE(16, 34);         // bits a sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/** Shorter than this was a slip of the key, not speech (ears' min_speech_sec). */
export const MIN_SPEECH_BYTES = RATE * 2 * 0.3;
