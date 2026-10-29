/**
 * Model Capability Detection
 *
 * Registry of known models with context window, tool support, and vision capabilities.
 * Pure functions for inference when model is unknown (local/custom models).
 */

import { llamaToolCapabilities } from './llama-tool-capabilities.js';
import { lmStudioDownloadedCaps } from './local-server-models.js';
import { OLLAMA_SERVED_CONTEXT } from './ollama-window.js';
import { servedOllamaWindow } from './managed-ollama-record.js';

const KNOWN_MODELS = Object.freeze({
  // OpenAI
  'gpt-4o': { contextWindow: 128000, tools: true, vision: true, family: 'openai' },
  'gpt-4o-mini': { contextWindow: 128000, tools: true, vision: true, family: 'openai' },
  'gpt-4-turbo': { contextWindow: 128000, tools: true, vision: true, family: 'openai' },
  'gpt-4-turbo-preview': { contextWindow: 128000, tools: true, vision: false, family: 'openai' },
  'gpt-4': { contextWindow: 8192, tools: true, vision: false, family: 'openai' },
  'gpt-3.5-turbo': { contextWindow: 16384, tools: true, vision: false, family: 'openai' },
  'gpt-3.5-turbo-16k': { contextWindow: 16384, tools: true, vision: false, family: 'openai' },
  'o1': { contextWindow: 200000, tools: true, vision: true, family: 'openai' },
  'o1-mini': { contextWindow: 128000, tools: true, vision: false, family: 'openai' },
  'o1-preview': { contextWindow: 128000, tools: true, vision: false, family: 'openai' },
  'o3-mini': { contextWindow: 200000, tools: true, vision: true, family: 'openai' },
  'gpt-5': { contextWindow: 400000, tools: true, vision: true, family: 'openai' },
  'gpt-5.6-sol': { contextWindow: 1050000, tools: true, vision: true, family: 'openai' },

  // OpenAI open-weight (served via LM Studio as openai/gpt-oss-*)
  'gpt-oss': { contextWindow: 131072, tools: true, vision: false, family: 'openai' },

  // Anthropic
  'claude-opus-4-6': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },
  'claude-opus-4-8': { contextWindow: 1000000, tools: true, vision: true, family: 'anthropic' },
  'claude-sonnet-4-5-20250929': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },
  'claude-haiku-4-5-20251001': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },
  'claude-3-opus-20240229': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },
  'claude-3-sonnet-20240229': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },
  'claude-3-haiku-20240307': { contextWindow: 200000, tools: true, vision: true, family: 'anthropic' },

  // xAI
  'grok-3': { contextWindow: 131072, tools: true, vision: true, family: 'xai' },
  'grok-3-mini': { contextWindow: 131072, tools: true, vision: false, family: 'xai' },
  'grok-2': { contextWindow: 131072, tools: true, vision: true, family: 'xai' },
  // The live xAI /v1/models/grok-4 alias resolved to grok-4.3 on 2026-07-25.
  'grok-4': { contextWindow: 1000000, tools: true, vision: true, family: 'xai' },

  // Default subscription witnesses. Context limits come from the committed
  // models.dev catalog source; provider runtime metadata still wins when a
  // route exposes it (getRouteCapabilities).
  'glm-4.6': { contextWindow: 204800, tools: true, vision: false, family: 'zai' },
  // The glm-5 generation — z-ai is a core-owned provider, so the sync skips it
  // and the catalog rung never sees these. Values from the live models.dev
  // payload, fetched 2026-07-27. Most-specific prefix wins, so glm-5.2's 1M is
  // never shadowed by the glm-5 family entry.
  'glm-5.2': { contextWindow: 1000000, tools: true, vision: false, family: 'zai' },
  'glm-5.1': { contextWindow: 200000, tools: true, vision: false, family: 'zai' },
  'glm-5': { contextWindow: 204800, tools: true, vision: false, family: 'zai' },
  'glm-4.7': { contextWindow: 204800, tools: true, vision: false, family: 'zai' },
  'kimi-for-coding': { contextWindow: 262144, tools: true, vision: true, family: 'kimi' },
  // VISION PROVEN LIVE 2026-09-23 (scripts/kimi-vision-probe.mjs): a solid-red
  // PNG answered "red" on ALL FOUR lane models; k3's absence read as false
  // through the unknown fallback. Founder's law 2026-08-15: ON by default.
  'k3': { contextWindow: 1048576, tools: true, vision: true, family: 'kimi' },
  'k3-256k': { contextWindow: 262144, tools: true, vision: true, family: 'kimi' },
  'kimi-for-coding-highspeed': { contextWindow: 262144, tools: true, vision: true, family: 'kimi' },

  // Common local models (Ollama/LM Studio)
  'llama3': { contextWindow: 8192, tools: false, vision: false, family: 'meta' },
  'llama3.1': { contextWindow: 131072, tools: true, vision: false, family: 'meta' },
  'llama3.2': { contextWindow: 131072, tools: true, vision: false, family: 'meta' },
  'llama3.3': { contextWindow: 131072, tools: true, vision: false, family: 'meta' },
  'mistral': { contextWindow: 32768, tools: true, vision: false, family: 'mistral' },
  'mixtral': { contextWindow: 32768, tools: true, vision: false, family: 'mistral' },
  'codellama': { contextWindow: 16384, tools: false, vision: false, family: 'meta' },
  'phi3': { contextWindow: 128000, tools: false, vision: false, family: 'microsoft' },
  'gemma2': { contextWindow: 8192, tools: false, vision: false, family: 'google' },
  // Runtime-proven on the live substrate (2026-07-07 probes): gemma-4-31b
  // emits clean native tool_calls, streamed and non-streamed, finish_reason
  // 'tool_calls'. Registered so the birth naming/crystallization stages ride
  // the structured path instead of text-dialect sampling — a real being was
  // lost at naming to a bad text-dialect roll (docs/governance/honored.md, 2026-07-07).
  // VISION IS THE MODEL'S OWN (its mmproj pairs at ignite — model-catalog's
  // projectorFor). Founder's law 2026-08-15: a capability the model has is ON by
  // default. The table declares the MODEL can see; the serving's /props stays
  // decisive DOWN (a projector-less serving reports vision false and the gate
  // hears it) — but a serving that is merely DOWN no longer reads here as a
  // blind model.
  // 262144 is the model's NATIVE window (GGUF metadata; pool receipts
  // 2026-08-15). The old 65536 here was a July SERVING choice fossilized as
  // a model fact — while the substrate was down it fed the desk gauge a
  // stale ceiling. The hand table declares what the MODEL can hold; what a
  // serving actually launched with stays runtime truth (/props, which wins).
  // REASONING IS THE MODEL'S OWN: gemma-4 emits a thought channel (markers
  // or reasoning_content under --reasoning auto). A one-shot "ready" probe
  // that answers without thinking is a moment, not a life sentence — the
  // room ladder must still show. Design note, 2026-08-17.
  'gemma-4': { contextWindow: 262144, tools: true, vision: true, reasoning: true, family: 'google' },
  'qwen2.5': { contextWindow: 131072, tools: true, vision: false, family: 'alibaba' },
  // Runtime-proven on the live substrate: qwen3.5-122b-a10b emits native
  // tool_calls (B-07 live transcript) and LM Studio reports it as a vlm.
  'qwen3.5': { contextWindow: 32768, tools: true, vision: true, family: 'alibaba' },
  // GGUF-metadata proven (2026-08-18, gguf-dump on the rig's own copy):
  // arch qwen35, qwen35.context_length = 262144 NATIVE, mmproj pairs beside
  // the weights (vision is the model's own, /props stays decisive DOWN as
  // with gemma-4). Without this row the name carries no window cue and the
  // fallback reads 4096 — the budgeter would crush a 262K being's envelope
  // into a keyhole. Exactly the failure class this table exists to prevent.
  // REASONING IS THE MODEL'S OWN (2026-09-13): the house serving runs
  // --reasoning auto and the thought channel is live on the desk every day
  // (THINKING blocks, usage.output_tokens_details) — the row keeps the
  // effort ladder standing even when a one-shot think-probe answers cold
  // (the gemma-4 lesson, Design note, 2026-08-17.
  'qwen3.8': { contextWindow: 262144, tools: true, vision: true, reasoning: true, family: 'alibaba' },
  'deepseek-r1': { contextWindow: 65536, tools: false, vision: false, family: 'deepseek' },
  'deepseek-coder-v2': { contextWindow: 131072, tools: false, vision: false, family: 'deepseek' },
});

// --- Local behavior tables (data, not code) ---
//
// Model-behavior facts live HERE, never in the request path
// (docs/architecture/identity/model-portability.md — the driver/engine
// doctrine): llm-provider.js reads these tables instead of keying behavior
// on a model name. A newly loaded family is a data row, not a code change.

export { THINK_MARKER_REGISTRY } from './think-marker-registry.js';

/**
 * Publisher-recommended sampling per LOCAL model family — the model card's
 * own numbers, not taste: gemma temp 1.0 · top_k 64 · top_p 0.95 · min_p 0
 * (Google's stated optimal; unsloth gemma-4 guide matches); qwen temp 0.7 ·
 * top_k 20 · top_p 0.8 · min_p 0 (Qwen instruct card). min_p is EXPLICIT —
 * llama-server defaults it nonzero when omitted. repeat_penalty appears for
 * NO family, deliberately: it penalizes the period token, replacing sentence
 * boundaries with stray capitals in long answers — live-reproduced 2026-07-09
 * ("failureL", T=0.8 rp 1.15 vs zero hits on these knobs); upstream llama.cpp
 * #331, google-deepmind/gemma #622 (rp doesn't even cure gemma-4 repetition).
 * Matched by name substring, first hit wins.
 */
export const LOCAL_FAMILY_SAMPLING = Object.freeze([
  Object.freeze({ match: 'gemma', sampling: Object.freeze({ temperature: 1.0, top_k: 64, top_p: 0.95, min_p: 0 }) }),
  Object.freeze({ match: 'qwen', sampling: Object.freeze({ temperature: 0.7, top_k: 20, top_p: 0.8, min_p: 0 }) }),
]);

/**
 * Prompt-surface profile per LOCAL family (NITE-004, #399) — data rows the
 * envelope/prompt layers consult instead of keying on a model name.
 *
 * `systemRole`: how the family's chat template treats a system message —
 * 'native' means the template renders a real system turn. Both resident
 * families VERIFIED 2026-08-20 from primary sources, not lore: qwen3.8's
 * served template branches on system content (/props on the live serving);
 * gemma-4's GGUF tokenizer.chat_template opens `<|turn>system` and consumes
 * messages[0] when its role is system/developer (read from the weights'
 * own metadata — the […] lore is FALSE for
 * gemma-4).
 *
 * `tokenizerRatio`: measured chars-per-token FLOOR across content classes,
 * for anyone refining the global chars/3.6 estimate. qwen3.8 measured
 * 2026-08-20 via the serving's own /tokenize: prose 4.73 · mixed 4.49 ·
 * code 3.80 · dense JSON 3.67 — the row carries the floor. gemma-4 is
 * null-honest: not serving today, so nothing was measured; fill it from
 * /tokenize at its next serving, never from a guess.
 */
export const FAMILY_PROMPT_PROFILE = Object.freeze([
  Object.freeze({ match: 'qwen', systemRole: 'native', tokenizerRatio: 3.67 }),
  Object.freeze({ match: 'gemma', systemRole: 'native', tokenizerRatio: null }),
]);

/** The prompt-surface profile row for a model id, or nulls when no family matches. Pure. */
export const promptProfileFor = (modelId) => {
  const id = String(modelId || '').toLowerCase();
  const row = FAMILY_PROMPT_PROFILE.find((r) => id.includes(r.match));
  return row ? { systemRole: row.systemRole, tokenizerRatio: row.tokenizerRatio } : { systemRole: null, tokenizerRatio: null };
};

/** Unknown local families keep the old gentle min_p floor and nothing else. */
export const DEFAULT_LOCAL_SAMPLING = Object.freeze({ min_p: 0.05 });

/**
 * The local sampling preset for a model id — the family's publisher numbers
 * when known, the gentle default otherwise. Pure.
 * @param {string} model
 * @returns {{temperature?: number, top_k?: number, top_p?: number, min_p: number}}
 */
export const localSamplingFor = (model) => {
  const name = String(model ?? '').toLowerCase();
  const hit = LOCAL_FAMILY_SAMPLING.find((row) => name.includes(row.match));
  return hit ? hit.sampling : DEFAULT_LOCAL_SAMPLING;
};

/**
 * Stop tokens every local serving gets. A family that proves it needs
 * different stops becomes a data row beside LOCAL_FAMILY_SAMPLING — not a
 * branch in the request path.
 */
export const DEFAULT_LOCAL_STOP_TOKENS = Object.freeze(['<|im_end|>', '<|endoftext|>']);

// --- Inference for unknown models ---

/** Patterns that hint at context window size from model name. */
const CONTEXT_PATTERNS = [
  { pattern: /(\d+)k/i, extract: (m) => parseInt(m[1]) * 1024 },
  { pattern: /128k|128000/i, extract: () => 128000 },
  { pattern: /200k|200000/i, extract: () => 200000 },
  { pattern: /32k|32000/i, extract: () => 32768 },
  { pattern: /16k|16000/i, extract: () => 16384 },
];

/** Infer capabilities from model name patterns when not in registry. */
export const inferCapabilities = (modelId) => {
  const lower = (modelId || '').toLowerCase();

  // Context window inference
  let contextWindow = 4096; // Conservative default
  for (const { pattern, extract } of CONTEXT_PATTERNS) {
    const match = lower.match(pattern);
    if (match) { contextWindow = extract(match); break; }
  }

  // Vision inference (llava, vision, etc.)
  const vision = /llava|vision|vl\b|cogvlm|moondream/.test(lower);

  // Tool support inference (newer models tend to support tools)
  const tools = /tool|function|3\.1|3\.2|3\.3|qwen2\.5|qwen3|mistral|mixtral|gpt-?oss/.test(lower)
    || /gpt-(?:4|3\.5)(?:$|[-:._])/.test(lower);

  return Object.freeze({ contextWindow, tools, vision, family: 'unknown' });
};

/**
 * True when `value` is `key` or extends it at a model-id boundary
 * (`-`, `:`, `.`, `_`) — so 'gpt-4o-2024-08-06' matches 'gpt-4o' while
 * 'gpt-4o2' does not. THE one definition for model-id prefix matching
 * (#285 — was duplicated verbatim in llm-provider.js, a drift risk on the
 * boundary rule). Pure.
 * @param {string} value
 * @param {string} key
 * @returns {boolean}
 */
export const hasPrefixBoundary = (value, key) =>
  value.startsWith(key) && (value.length === key.length || /^[-:._]/.test(value.slice(key.length)));

/**
 * Get capabilities for a model. Checks registry first, then infers from name.
 * @param {string} modelId - Model identifier (e.g. 'gpt-4o', 'llama3.1:8b')
 * @returns {{ contextWindow: number, tools: boolean, vision: boolean, family: string }}
 */
export const getCapabilities = (modelId) => {
  if (!modelId) return Object.freeze({ contextWindow: 4096, tools: false, vision: false, family: 'unknown' });

  // Try exact match first
  const exact = KNOWN_MODELS[modelId];
  if (exact) return exact;

  // Normalize: strip an org/ prefix (LM Studio serves 'openai/gpt-oss-120b',
  // 'qwen/qwen2.5-...') and an :tag, then retry exact / prefix matching so the
  // registry's prefix match reaches past the org namespace.
  const stripped = modelId.split('/').pop();
  const baseModel = stripped.split(':')[0];
  const baseMatch = KNOWN_MODELS[baseModel];
  if (baseMatch) return baseMatch;

  // Try prefix matching on both the raw id and the stripped form (e.g.
  // 'gpt-4o-2024-08-06' → 'gpt-4o', 'openai/gpt-oss-120b' → 'gpt-oss')
  // Most-specific prefix wins: a broad family such as gpt-5 must not shadow
  // the concrete gpt-5.6-sol alias and report the wrong context window.
  // Matching case-folds: the registry is lowercase by convention, but a served
  // id can be the GGUF's own filename ('Qwen3.8-27B-Q8_0') — case is a naming
  // accident, never a different model.
  const lowerId = modelId.toLowerCase();
  const lowerStripped = stripped.toLowerCase();
  for (const key of Object.keys(KNOWN_MODELS).sort((a, b) => b.length - a.length)) {
    if (hasPrefixBoundary(lowerId, key) || hasPrefixBoundary(lowerStripped, key)) return KNOWN_MODELS[key];
  }

  return inferCapabilities(modelId);
};

/**
 * Interpret one model record from LM Studio's /api/v0/models REST API.
 * The runtime truth beats name inference: qwen3.5-122b-a10b carries no
 * vision hint in its NAME, but LM Studio reports it as type 'vlm' — and it
 * demonstrably reads images. Pure.
 * @param {{ type?: string, capabilities?: string[], max_context_length?: number, loaded_context_length?: number }} m
 * @returns {{ contextWindow: number|null, vision: boolean }}
 */
export const interpretLmsModel = (m) => Object.freeze({
  contextWindow: m?.loaded_context_length ?? m?.max_context_length ?? null,
  vision: m?.type === 'vlm' || (Array.isArray(m?.capabilities) && m.capabilities.includes('vision')),
});

/**
 * Interpret llama.cpp's /props report. Newer builds declare `modalities`
 * server-wide — and it is DECISIVE both ways: a vision model served without
 * its multimodal projector reports vision false, and that is the truth the
 * gate must hear (the weights can see; the serving cannot). Builds that
 * predate the field report nothing (null) and name inference stands. Pure.
 * @param {{ modalities?: { vision?: boolean }, chat_template_caps?: Object }} props
 * @returns {{ contextWindow: number|null, vision: boolean|null, tools?: boolean }}
 */
export const interpretLlamaProps = (props, meta = null) => {
  // THE SERVING'S REAL CONTEXT: llama.cpp reports the window it was launched with
  // under default_generation_settings.n_ctx (live rig 2026-08-04: { n_ctx: 65536 }),
  // so a being uses the room its operator paid for, not a constant picked years ago.
  const pool = props?.default_generation_settings?.n_ctx ?? props?.n_ctx;
  // A pool sized to the GPU (serving-fit.js) is shared room: one being's window stops at the trained context.
  const n = meta?.n_ctx_train > 0 && pool > meta.n_ctx_train ? meta.n_ctx_train : pool;
  return Object.freeze({
    contextWindow: Number.isFinite(n) && n > 0 ? n : null,
    vision: typeof props?.modalities?.vision === 'boolean' ? props.modalities.vision : null,
    ...llamaToolCapabilities(props),
  });
};

/**
 * Interpret Ollama's /api/show report. Newer daemons list `capabilities`
 * (…, 'vision'); older ones still expose `projector_info` on multimodal
 * models — both are runtime truth. Neither present → vision undecided. Pure.
 * @param {{ parameters?: string, capabilities?: string[], projector_info?: unknown, details?: { parameter_size?: string } }} data
 */
export const interpretOllamaShow = (data, served = OLLAMA_SERVED_CONTEXT) => {
  // Two different numbers, and the difference matters. `parameters` carries
  // num_ctx only when a Modelfile PINNED one — most models have none, which is
  // why this read null for every stock pull. The model's REAL trained window
  // lives in model_info under `<arch>.context_length` (measured on a live
  // daemon 2026-08-04: { 'qwen3.context_length': 40960 } with no num_ctx in
  // parameters at all). A pinned num_ctx is the operator's own decision and
  // wins; otherwise the architecture's window, no more than the one this machine serves (`served`).
  const pinned = (data?.parameters || '').match(/num_ctx\s+(\d+)/);
  const archCtx = Object.entries(data?.model_info || {})
    .find(([k]) => k.endsWith('.context_length'))?.[1];
  const ctx = pinned ? parseInt(pinned[1], 10) : Number.isFinite(archCtx) ? Math.min(archCtx, served) : archCtx;
  const caps = Array.isArray(data?.capabilities) ? data.capabilities : null;
  const vision = caps ? caps.includes('vision') : (data?.projector_info ? true : null);
  return Object.freeze({
    contextWindow: Number.isFinite(ctx) && ctx > 0 ? ctx : null,
    parameterSize: data?.details?.parameter_size || null,
    ...(typeof vision === 'boolean' ? { vision } : {}),
    // Ollama SAYS SO when a model reasons — 'thinking' in its capability list.
    // Declared truth beats our probe, which asks a trivial question the model
    // answers without thinking and is therefore blind to exactly the models
    // that starve (Bastien, 2026-08-04).
    ...(caps ? { thinks: caps.includes('thinking') } : {}),
  });
};

// Runtime probes must never hold a turn behind an unresponsive serving.
const PROBE_TIMEOUT_MS = 3000;

/**
 * Query a local provider for model capabilities at runtime.
 * @param {'ollama'|'lm-studio'} provider - Local provider type
 * @param {string} endpoint - Provider base URL
 * @param {string} modelId - Model to query
 * @returns {Promise<{ contextWindow?: number|null, parameterSize?: string, vision?: boolean } | null>}
 */
const probeLocalShape = async (provider, endpoint, modelId) => {
  try {
    const base = endpoint.replace(/\/$/, '');
    switch (provider) {
      case 'ollama': {
        const res = await fetch(`${base}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelId }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        return res.ok ? interpretOllamaShow(await res.json(), servedOllamaWindow()) : null;
      }
      case 'llama-server': {
        // /props carries the serving's modalities — decisive both ways (see
        // interpretLlamaProps). modelId is unused: one server serves one model.
        const [res, models] = await Promise.all([fetch(`${base}/props`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
          fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
        if (!res.ok) return null;
        return interpretLlamaProps(await res.json(), models?.data?.[0]?.meta);
      }
      case 'lm-studio': {
        // The v0 REST API carries what /v1/models omits: model type ('vlm'
        // = vision-language) and a capabilities list. Older LM Studio
        // builds lack it — fall through to /v1/models (no vision truth).
        const v0 = await fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch(() => null);
        const listed = v0?.ok ? ((await v0.json()).data || []).find(m => m.id === modelId) : null;
        if (listed) return interpretLmsModel(listed);
        // LM Studio 0.4 lists only LOADED models on v0; a downloaded one reads from v1
        const downloaded = await lmStudioDownloadedCaps(base, modelId);
        if (downloaded) return downloaded;
        const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        const model = res.ok ? ((await res.json()).data || []).find(m => m.id === modelId) : null;
        return model ? Object.freeze({ contextWindow: model.context_length || null }) : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
};

/**
 * Query a local serving for what it is actually running.
 *
 * The declared provider is tried FIRST and its answer wins. If it yields no
 * window, the other local shapes are tried against the SAME endpoint — because
 * the endpoint knows what it is even when the config does not.
 *
 * That is not a hypothetical. A community member reached Ollama with his
 * provider set to `llama-server` (2026-08-04) — a perfectly working setup,
 * since Ollama serves an OpenAI-compatible API — so the /props probe 404'd,
 * the window fell back to a 4096 name-inference, and his being was budgeted a
 * fifth of the room it had. Ollama was reporting 40960 the whole time, one
 * request away.
 *
 * Cost is bounded: the fallbacks run ONLY when the declared probe came back
 * without a window, and each carries the same 3s ceiling.
 *
 * @param {'ollama'|'lm-studio'|'llama-server'} provider
 * @param {string} endpoint
 * @param {string} modelId
 */
export const queryLocalCapabilities = async (provider, endpoint, modelId) => {
  const primary = await probeLocalShape(provider, endpoint, modelId);
  if (Number.isFinite(primary?.contextWindow) && primary.contextWindow > 0) return primary;

  // The remaining dialect probes run CONCURRENTLY — sequential probing taxed
  // the wake-from-idle turn with up to 9s of serial 3s timeouts where the
  // custom path already parallelized the same fan (friction-map B2).
  const others = (await Promise.all(
    ['ollama', 'llama-server', 'lm-studio']
      .filter((other) => other !== provider)
      .map((other) => probeLocalShape(other, endpoint, modelId).catch(() => null)),
  )).filter((got) => Number.isFinite(got?.contextWindow) && got.contextWindow > 0);
  if (others.length > 0) {
    // The declared shape's answer is kept where it had one (vision, size);
    // only the facts it could not supply come from the shape that answered.
    return Object.freeze({ ...(primary || {}), ...others[0] });
  }
  return primary;
};

/**
 * Probe an arbitrary OpenAI-compatible endpoint for runtime capabilities —
 * the 'custom' provider is an escape hatch that in practice points at one of
 * the local servers above, so each local dialect is tried in turn and the
 * first decisive answer wins. Every attempt fails soft: a cloud endpoint
 * (xAI rides 'custom' internally) 404s through all three and name inference
 * stands. impure.
 * @param {string} endpoint
 * @param {string} modelId
 * @returns {Promise<{ contextWindow?: number|null, vision?: boolean } | null>}
 */
export const probeEndpointCapabilities = async (endpoint, modelId) => {
  const base = (endpoint || '').replace(/\/$/, '');
  if (!base) return null;
  // All three dialects are probed CONCURRENTLY — a cloud endpoint 404s them
  // all, and sequential probing would tax every turn with three round-trips
  // (echo finding). Wall time is the slowest single probe, not the sum.
  const jsonOrNull = (res) => (res.ok ? res.json() : null);
  const [lms, props, show] = await Promise.all([
    fetch(`${base}/api/v0/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then(jsonOrNull).catch(() => null),
    fetch(`${base}/props`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then(jsonOrNull).catch(() => null),
    fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelId }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }).then(jsonOrNull).catch(() => null),
  ]);
  // Precedence among the answers matches the dialects' decisiveness order.
  const model = (lms?.data || []).find((m) => m.id === modelId);
  if (model) return interpretLmsModel(model);
  if (props) return interpretLlamaProps(props);
  if (show) return interpretOllamaShow(show, servedOllamaWindow());
  return null;
};

/**
 * Get models filtered by family.
 * @param {string} family - Family name (e.g. 'openai', 'anthropic')
 * @returns {Array<{ id: string, contextWindow: number, tools: boolean, vision: boolean }>}
 */
export const getModelsByFamily = (family) =>
  Object.entries(KNOWN_MODELS)
    .filter(([, caps]) => caps.family === family)
    .map(([id, caps]) => Object.freeze({ id, ...caps }));

export { KNOWN_MODELS };

const LOCAL_CAPABILITY_PROVIDERS = Object.freeze(['lm-studio', 'llama-server', 'ollama', 'custom']);

/**
 * True when a local capability probe did not name a window — a moment
 * (booting, relighting, down), never a fact to cache. Pure.
 */
export const localCapabilityProbeFailed = (provider, runtime) =>
  LOCAL_CAPABILITY_PROVIDERS.includes(provider)
  && !(Number.isFinite(runtime?.contextWindow) && runtime.contextWindow > 0);
