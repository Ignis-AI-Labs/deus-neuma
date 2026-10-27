// ollama-window — the context window an Ollama is asked to serve, fitted to the GPU. Pure.
//
// THE WINDOW AN OLLAMA SERVES. Unasked, Ollama sizes its context by the GPU's TOTAL memory (a
// 96 GB card got 262,144 tokens on 2026-10-22; a card under 24 GB gets 4,096) and cuts a longer
// prompt silently, so a being's identity could be lost on exactly the laptops the 4B tier is for.
// Every chat to Ollama names the window (llm-request-builders.js), and the platform's own server
// starts with it as its default (managed-ollama.js), so no request reloads the model.
//
// FITTED, NOT FIXED (2026-10-23, after two crashes on a 12 GB RTX 5070 Ti laptop). The window was
// a fixed 65,536. Measured on Ollama 0.40.7 with the 4B the setup installs (Qwen3.8-4B Q4_K_M):
// 3.6 GiB of GPU memory at 8K, 3.9 at 16K, 4.4 at 32K, 5.7 at 64K, and a real 17,022-token
// prompt adds nothing beyond that (the KV cache is reserved whole when the model loads). So 64K
// fit that card; it is still more than a being needs, and every GiB it holds is a GiB the
// desktop, the browser and the app's own 3D view do not have on a card Windows shares with them.
// The window is now the SMALLEST that holds a being whole: its opening prompt is ~13-17K tokens,
// so 32K (room for the conversation after it), stepping down only when the GPU cannot hold that,
// never below the floor that keeps the opening whole. Below the floor the window stays at the
// floor and part of the model runs on the processor (Ollama places the layers); the being's
// words are never cut to fit.

/** The window every Ollama is asked to serve unless the GPU cannot hold it. */
export const OLLAMA_SERVED_CONTEXT = 32768;
/** The smallest window that keeps a being's opening (~13-17K tokens) and a reply whole. */
export const OLLAMA_WINDOW_FLOOR = 20480;
// largest first; every step still holds the opening
const LADDER = Object.freeze([OLLAMA_SERVED_CONTEXT, 24576, OLLAMA_WINDOW_FLOOR]);

const GIB = 1024 ** 3;
// Beyond weights + KV: the CUDA context and the compute buffers, which grow with the window.
// Measured (nvidia-smi per process, minus weights and KV): 0.62 GiB at 8K, 0.82 at 32K, 1.2 at 64K.
const RUNTIME_BASE = 0.75 * GIB;
const RUNTIME_PER_TOKEN = 8 * 1024;
// Left free on the card for everything else that draws on it: Windows' desktop, the browser,
// this app's own window. Llama.cpp's own fit leaves 1 GiB; a shared laptop card needs more.
const HEADROOM_MIN = 1.5 * GIB;
const HEADROOM_SHARE = 0.1;
// a model whose layout could not be read is sized as if every layer kept a full f16 KV cache
const UNKNOWN_KV_PER_TOKEN = 128 * 1024;

/**
 * KV-cache bytes per token from Ollama's /api/show model_info, f16 (Ollama's default). A hybrid
 * model keeps attention (and so a KV cache) in one layer of `full_attention_interval`; the rest
 * hold a fixed recurrent state. Rounded up, so a sized window is never smaller than the truth.
 * Pure.
 * @param {Record<string, unknown>|null|undefined} info model_info
 * @returns {number|null} null when the layout is not in the report
 */
export const kvBytesPerToken = (info) => {
  const entries = Object.entries(info || {});
  const field = (suffix) => entries.find(([k]) => k.endsWith(`.${suffix}`))?.[1];
  const layers = Number(field('block_count'));
  const kvHeadsRaw = field('attention.head_count_kv') ?? field('attention.head_count');
  const kvHeads = Array.isArray(kvHeadsRaw) ? Math.max(...kvHeadsRaw.map(Number)) : Number(kvHeadsRaw);
  const width = Number(field('embedding_length')) / Number(field('attention.head_count'));
  const keyLen = Number(field('attention.key_length') ?? width);
  const valueLen = Number(field('attention.value_length') ?? width);
  const interval = Number(field('full_attention_interval')) || 1;
  if (![layers, kvHeads, keyLen, valueLen].every((n) => Number.isFinite(n) && n > 0)) return null;
  return Math.ceil(layers / interval) * kvHeads * (keyLen + valueLen) * 2;
};

/** GPU memory a model needs at a window: weights + KV + the runtime around them. Pure. */
export const gpuBytesAt = (window, { weightsBytes, kvPerToken }) =>
  weightsBytes + window * (kvPerToken ?? UNKNOWN_KV_PER_TOKEN) + RUNTIME_BASE + window * RUNTIME_PER_TOKEN;

/**
 * The room a model may take on a card: its free memory (or its size, when only that is known),
 * no more than the operator's budget (NEUMA_MODEL_BUDGET_GB, a GPU shared with other work), less
 * the headroom everything else on the card needs. Pure.
 * @param {{freeBytes?: number|null, totalBytes?: number|null, budgetGB?: number|null}} gpu
 * @returns {number|null} null when the card's memory could not be read
 */
export const gpuRoomBytes = ({ freeBytes = null, totalBytes = null, budgetGB = null } = {}) => {
  const card = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
  const cap = Number.isFinite(budgetGB) && budgetGB > 0 ? budgetGB * GIB : Infinity;
  const size = Math.min(card ?? Infinity, cap);
  const free = Math.min(Number.isFinite(freeBytes) && freeBytes > 0 ? freeBytes : size, size);
  if (!Number.isFinite(free)) return null;
  return Math.max(free - Math.max(HEADROOM_MIN, HEADROOM_SHARE * size), 0);
};

/**
 * The window to serve a model at on this GPU: the largest step of the ladder that fits the room,
 * or the floor with `onGpu: false` when even the floor does not (Ollama then keeps part of the
 * model on the processor). An unreadable card is served the usual window, said so. Pure.
 * @param {{roomBytes: number|null, weightsBytes: number, kvPerToken: number|null}} input
 * @returns {Readonly<{window: number, onGpu: boolean|null, needBytes: number, roomBytes: number|null, line: string}>}
 */
export const fitOllamaWindow = ({ roomBytes, weightsBytes, kvPerToken }) => {
  const model = { weightsBytes: Number(weightsBytes) || 0, kvPerToken };
  const gib = (n) => (n / GIB).toFixed(1);
  if (!Number.isFinite(roomBytes)) {
    const needBytes = gpuBytesAt(OLLAMA_SERVED_CONTEXT, model);
    return Object.freeze({ window: OLLAMA_SERVED_CONTEXT, onGpu: null, needBytes, roomBytes: null,
      line: `The graphics card's free memory could not be read, so the model is served at the usual ${OLLAMA_SERVED_CONTEXT.toLocaleString('en-US')}-token window.` });
  }
  const window = LADDER.find((w) => gpuBytesAt(w, model) <= roomBytes);
  if (window) {
    const needBytes = gpuBytesAt(window, model);
    return Object.freeze({ window, onGpu: true, needBytes, roomBytes,
      line: `Served at a ${window.toLocaleString('en-US')}-token window: about ${gib(needBytes)} GB of the ${gib(roomBytes)} GB the graphics card can spare.` });
  }
  const needBytes = gpuBytesAt(OLLAMA_WINDOW_FLOOR, model);
  return Object.freeze({ window: OLLAMA_WINDOW_FLOOR, onGpu: false, needBytes, roomBytes,
    line: `The graphics card can spare ${gib(roomBytes)} GB and the model needs about ${gib(needBytes)} GB to hold a being's whole opening, so part of it runs on the processor. Replies are slower; nothing the being says is cut.` });
};
