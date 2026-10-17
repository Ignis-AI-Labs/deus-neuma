// PCM stream reader shared by the new 24 kHz sidecar adapters (kyutai now,
// qwen3 later). Lifted from zonos.js's private copy (zonos.js:58-103) per
// FR-16: imported ONLY by the new PCM adapters — the five original adapters
// keep their private copies untouched.
//
// Uniform AudioChunk shape (all adapters):
//   { bytes: Uint8Array, sampleRate, channels, format, sequence, final }
// Format is read from the sidecar's X-Audio-* headers, never assumed; slices
// are 4096 B (~85 ms of s16le mono at 24 kHz) whatever frame size the sidecar
// streams (kyutai pumps 3840 B / 80 ms frames).

const DEFAULT_SAMPLE_RATE = 24000; // NFR-6: new sidecars MUST emit 24 kHz
const CHUNK_BYTES = 4096;

// pure — read format metadata from response headers (sidecar sets them)
export const readFormatFromHeaders = (response) => ({
  sampleRate: Number(response.headers.get('x-audio-sample-rate') || DEFAULT_SAMPLE_RATE),
  channels: Number(response.headers.get('x-audio-channels') || 1),
  format: response.headers.get('x-audio-format') || 'pcm_s16le',
});

// impure — streams the POST response body as uniform PCM AudioChunks
export async function* streamPcmBody(response, signal) {
  const fmt = readFormatFromHeaders(response);
  const reader = response.body.getReader();
  let sequence = 0;
  let buf = new Uint8Array(0);

  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // accumulate then slice into CHUNK_BYTES-sized chunks for downstream queueing
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf, 0);
      merged.set(value, buf.length);
      buf = merged;

      while (buf.length >= CHUNK_BYTES) {
        const slice = buf.slice(0, CHUNK_BYTES);
        buf = buf.slice(CHUNK_BYTES);
        yield { bytes: slice, ...fmt, sequence: sequence++, final: false };
      }
    }

    if (buf.length > 0) {
      yield { bytes: buf, ...fmt, sequence, final: true };
    } else {
      yield { bytes: new Uint8Array(0), ...fmt, sequence, final: true };
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
