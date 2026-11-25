// The stream stall guard — how long a model stream may stay silent before it
// is declared dead, and the read that enforces it.
//
// A hosted API streams every token, tool calls included, so two minutes of
// silence there means a half-open connection. A model the operator serves
// themselves does not: Ollama buffers a whole tool call and sends it in one
// frame when the call is complete, so a being writing a long document goes
// silent for as long as the call takes to generate (about 4,000 tokens at
// 34 tok/s filled the old 120s limit and the turn was cut mid-write).
// The operator's interrupt still ends any wait at once: aborting the request
// errors the pending read.

/** Silence allowed on a hosted wire, which streams every token. */
export const STREAM_STALL_MS = 120_000;

/** Silence allowed on a wire the operator serves (local or LAN server). */
export const SELF_SERVED_STALL_MS = 600_000;

const SELF_SERVED_PROVIDERS = Object.freeze(new Set(['ollama', 'lm-studio', 'llama-server']));

/**
 * The silence limit for one stream, from the provider layer's own account of
 * it ({ provider, dialect, local } as createStreamRequest returns them).
 * `local` marks a custom provider pointed at loopback.
 * @param {{ provider?: string, dialect?: string, local?: boolean }} stream
 * @returns {number} milliseconds
 */
export const stallLimitFor = ({ provider, dialect, local } = {}) =>
  local === true || dialect === 'ollama' || SELF_SERVED_PROVIDERS.has(provider)
    ? SELF_SERVED_STALL_MS
    : STREAM_STALL_MS;

/**
 * Read the next chunk, or reject once the stream has been silent for
 * `stallMs`; a half-open connection otherwise hangs reader.read() forever.
 * Cancels the reader on any failure. // impure
 * @param {ReadableStreamDefaultReader} reader
 * @param {number} [stallMs]
 */
export const readWithStallGuard = async (reader, stallMs = STREAM_STALL_MS) => {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`LLM stream stalled — no data for ${stallMs / 1000}s`)),
          stallMs
        );
      }),
    ]);
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
