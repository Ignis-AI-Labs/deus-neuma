// THE SOUND PROFILE — what a voice sounds like, measured from the clip, for a
// being that cannot hear it. Pure.
//
// Design note, 2026-10-02: […] The forge measures the
// sound itself and says it in plain words: how high and how varied the pitch is, how dark
// or bright the tone, how clear or breathy, how even or dynamic, how it
// paces. Every band is a measurement against fixed thresholds — nothing here
// guesses age, accent or feeling.
//
// Numbers in, words out:
//   pitch     median Hz (YIN, 60–400 Hz) and its spread, in semitones p10→p90
//   tone      median spectral centroid of the voiced frames, in Hz
//   texture   median YIN aperiodicity of the voiced frames (0 = a pure tone)
//   dynamics  loudness spread of the speech frames, dB p10→p90
//   pauses    pauses of 0.3 s or more, per minute of clip

const FRAME_SECONDS = 0.02;
const FFT_SIZE = 512;

// pure — the value at fraction p of the sorted values, or null when empty.
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

const round = (n, places = 1) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);

/**
 * The pitch track of the voiced frames, by YIN over a 12 kHz copy (60–400 Hz:
 * the range of speaking voices): each found frame's pitch and aperiodicity
 * (how far from periodic it is — breath and rasp raise it). Every other
 * speech frame (40 ms hops). Pure.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {boolean[]} speech - which 20 ms frames carry speech
 * @returns {Array<{hz: number, aperiodicity: number, frame: number}>}
 */
export const pitchTrack = (samples, sampleRate, speech) => {
  const step = Math.max(1, Math.round(sampleRate / 12000));
  const sr = sampleRate / step;
  const x = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += samples[i * step + k];
    x[i] = s / step;
  }
  const win = Math.round(0.04 * sr);
  const minLag = Math.floor(sr / 400);
  const maxLag = Math.ceil(sr / 60);
  const d = new Float64Array(maxLag + 1);
  const found = [];
  for (let f = 0; f < speech.length; f += 2) {
    if (!speech[f]) continue;
    const t = Math.round((f * FRAME_SECONDS * sampleRate) / step);
    if (t + win + maxLag >= x.length) break;
    let running = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let j = 0; j < win; j++) {
        const diff = x[t + j] - x[t + j + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
      // YIN: the first dip under the threshold, at its local minimum.
      if (tau > minLag && d[tau - 1] < 0.15 && d[tau - 1] <= d[tau]) {
        found.push({ hz: sr / (tau - 1), aperiodicity: d[tau - 1], frame: f });
        break;
      }
    }
  }
  return found;
};

// pure — in-place radix-2 FFT of (re, im); n a power of two.
const fft = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
};

/**
 * Median spectral centroid (Hz) of the given frames: where the voice's energy
 * sits — low for a dark, warm voice, high for a bright, thin one. Pure.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {number[]} frames - 20 ms frame indexes to read
 */
const spectralCentroidHz = (samples, sampleRate, frames) => {
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  const centroids = [];
  for (const f of frames) {
    const start = Math.round(f * FRAME_SECONDS * sampleRate);
    if (start + FFT_SIZE > samples.length) break;
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) re[i] = samples[start + i] * window[i];
    fft(re, im);
    let num = 0;
    let den = 0;
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += mag * ((k * sampleRate) / FFT_SIZE);
      den += mag;
    }
    if (den > 0) centroids.push(num / den);
  }
  return round(percentile(centroids, 0.5), 0);
};

// pure — pauses of at least `minSeconds` between the first and last speech frame.
const pausesOf = (speech, minSeconds) => {
  const first = speech.indexOf(true);
  const last = speech.lastIndexOf(true);
  if (first < 0) return 0;
  let pauses = 0;
  let run = 0;
  for (let i = first; i <= last; i++) {
    if (speech[i]) {
      if (run * FRAME_SECONDS >= minSeconds) pauses++;
      run = 0;
    } else run++;
  }
  return pauses;
};

/**
 * The measured sound of a clip. Pure.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {{speech: boolean[], levels: number[]}} frames - speechFrames + frameLevels of the clip
 * @returns {{pitchHz: number|null, pitchRangeSt: number|null, centroidHz: number|null,
 *   aperiodicity: number|null, dynamicsDb: number|null, pausesPerMinute: number|null}}
 */
export const soundProfileOf = (samples, sampleRate, { speech, levels }) => {
  const track = pitchTrack(samples, sampleRate, speech);
  const enough = track.length >= 10;
  const hz = track.map((p) => p.hz);
  const lo = percentile(hz, 0.1);
  const hi = percentile(hz, 0.9);
  const speechLevels = levels.filter((_, i) => speech[i]);
  const minutes = (samples.length / sampleRate) / 60;
  return Object.freeze({
    pitchHz: enough ? round(percentile(hz, 0.5)) : null,
    pitchRangeSt: enough && lo > 0 ? round(12 * Math.log2(hi / lo)) : null,
    centroidHz: enough ? spectralCentroidHz(samples, sampleRate, track.map((p) => p.frame)) : null,
    aperiodicity: enough ? round(percentile(track.map((p) => p.aperiodicity), 0.5), 3) : null,
    dynamicsDb: speechLevels.length >= 10 ? round(percentile(speechLevels, 0.9) - percentile(speechLevels, 0.1)) : null,
    pausesPerMinute: minutes > 0 ? round(pausesOf(speech, 0.3) / minutes) : null,
  });
};
