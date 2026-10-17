/**
 * Pure WAV parsing + concatenation — the no-ffmpeg fallback for the bake.
 *
 * Only correct when every source shares the same PCM format (audio format,
 * channel count, sample rate, bits per sample). When formats differ the
 * concat is impossible without resampling, so this throws honestly rather
 * than emit a corrupted sprite. ffmpeg resamples; this module cannot.
 *
 * Pure: reads buffers in, returns buffers out. No IO, no time.
 */

const TAG_RIFF = 'RIFF';
const TAG_WAVE = 'WAVE';
const TAG_FMT = 'fmt ';
const TAG_DATA = 'data';

/**
 * Parse a WAV buffer into its PCM format + raw data bytes.
 *
 * @param {Buffer} buf
 * @returns {{ audioFormat: number, channels: number, sampleRate: number,
 *            bitsPerSample: number, data: Buffer }}
 */
export const parseWav = (buf) => {
  if (!(buf.length > 12 && buf.toString('ascii', 0, 4) === TAG_RIFF && buf.toString('ascii', 8, 12) === TAG_WAVE)) {
    throw new Error('parseWav: not a RIFF/WAVE file');
  }
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let data = null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === TAG_FMT) {
      audioFormat = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === TAG_DATA) {
      data = buf.subarray(body, body + size);
      break;
    }
    offset = body + size + (size & 1); // chunks are word-aligned
  }

  if (!data) throw new Error('parseWav: no data chunk');
  if (!audioFormat) throw new Error('parseWav: no fmt chunk');
  return { audioFormat, channels, sampleRate, bitsPerSample, data };
};

const signature = (w) => `${w.audioFormat}/${w.channels}/${w.sampleRate}/${w.bitsPerSample}`;

/**
 * Concatenate parsed WAVs into one valid WAV, inserting `gap` seconds of
 * silence between consecutive cues. Throws if the sources are not uniform.
 *
 * @param {ReturnType<parseWav>[]} wavs
 * @param {number} gapSeconds
 * @returns {Buffer} a complete WAV file buffer
 */
export const concatWavs = (wavs, gapSeconds) => {
  if (wavs.length === 0) throw new Error('concatWavs: no sources');
  const ref = signature(wavs[0]);
  for (let i = 1; i < wavs.length; i += 1) {
    if (signature(wavs[i]) !== ref) {
      throw new Error(
        `concatWavs: sources are not uniform — cue 0 is ${ref}, cue ${i} is ${signature(
          wavs[i]
        )}. Install ffmpeg to resample, or normalize the sources.`
      );
    }
  }

  const { channels, sampleRate, bitsPerSample } = wavs[0];
  const bytesPerFrame = channels * (bitsPerSample / 8);
  const gapFrames = Math.round(gapSeconds * sampleRate);
  const gapBytes = Buffer.alloc(gapFrames * bytesPerFrame, 0);

  const parts = [];
  for (let i = 0; i < wavs.length; i += 1) {
    parts.push(wavs[i].data);
    if (i < wavs.length - 1) parts.push(gapBytes);
  }
  const pcm = Buffer.concat(parts);

  const header = Buffer.alloc(44);
  header.write(TAG_RIFF, 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write(TAG_WAVE, 8, 'ascii');
  header.write(TAG_FMT, 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  header.writeUInt16LE(bytesPerFrame, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write(TAG_DATA, 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/** Resolve a cue's duration in seconds from a parsed WAV (for plan building). */
export const wavDuration = (w) =>
  w.data.length / (w.sampleRate * w.channels * (w.bitsPerSample / 8));
