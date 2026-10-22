/**
 * Substrate setup — guidance for the first-run […] flow
 * (bring-your-own local LLM). Recommends a model for the operator's hardware and
 * probes the local providers (Ollama / LM Studio) so the setup wizard can tell
 * whether a mind is ready — turning the old no-LLM dead-end into a guided path.
 *
 * Tiers follow docs/architecture/measurement/substrate-benchmarks.md (the download-page guidance).
 */

import { getSubstrateProfile } from './substrate-detector.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { discoverProviders } from './provider-discovery.js';
import { servableModelIds } from './local-server-models.js';
import { withDeadline } from './bounded-exec.js';

const DISCOVERY_BUDGET_MS = 4000;

// Model tiers, largest first.
//
// `min` is GiB the model needs RESIDENT — not the size of the weight file.
// llama-server is launched with `-ngl 999` at a 65536-token context
// (llama-server-supervisor.js:164,272): every layer AND the whole KV cache must
// fit the budget, there is no partial-offload path, and no OOM retry. A model
// that does not fit does not run — it fails at load. So `min` = weights + mmproj
// + KV + ~1 GiB compute buffer.
//
// Measured 2026-07-29 against the real GGUFs on this machine. Weights + mmproj
// are byte-exact from disk; KV is derived from each model's OWN architecture
// metadata (per-layer kv-head counts, sliding-window pattern, key/value lengths)
// at 65536 tokens, f16. The earlier table used the weight file's size as the
// threshold, which understated three of four tiers — the 12 GiB floor asked a
// 12 GiB card to hold 16.76 GiB of weights before a single token of context.
// Derivation and per-context table: docs/architecture/measurement/substrate-benchmarks.md.
//
// `sizeGB` is the DOWNLOAD in decimal GB (what HuggingFace and the browser show)
// — a different unit from `min` on purpose, because it answers a different
// question: how much am I about to pull down.
//
// REBUILT 2026-10-04 FROM THE SUMMON CHECK (scripts/summon-check.mjs, the ladder
// scripts/min-spec-ladder.mjs): `checked` marks a model that truly carried a
// whole rehearsal summoning — consent, a name written by the tool, DNA authored
// on disk. Only a checked model is RECOMMENDED (what we can promise will
// summon); every choice that fits is OFFERED, newest first, unchecked ones
// marked so. `source` is the GGUF repo as LM Studio / HuggingFace search it.
// Any other local model may still be chosen.
//
// THE NEWEST MODEL AT EVERY SIZE (Design note, 2026-10-06: […] — a 3090, a 5090, an RTX 6000):
// the 2026-10-06 ladder and research put Qwen3.8-27B itself on every card from
// 16 GB up — IST Austria's GSQ-RCO 3-bit builds below 24 GB, the plain 4/6/8-bit
// above — and Qwen3.8 distilled into a 4B below that. `min` is GiB at the
// served 65536-token context: weights + KV (f16; the qwen35 family keeps KV in
// one layer of four — 64 KiB/token for the 27B, 32 KiB for the 4B) + ~1 GiB,
// checked against the ladder's measured peaks. `pick` orders the recommendation
// (higher = better where it fits); a choice without one is only ever offered.
// `cpu`: light enough per word to answer from a processor (a 4B, or the MoE
// whose 3B active of 35B is what each word costs).
const CHOICES = Object.freeze([
  { pick: 9, min: 36, model: 'Qwen3.8-27B Uncensored (HauhauCS)', quant: 'Q8_K_P', sizeGB: 32.4, released: '2026-08', checked: true,
    source: 'HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF',
    note: 'the house substrate, near-lossless at the full context — 48 GB cards and up (RTX 6000, A6000, RTX PRO 6000)' },
  { pick: 8, min: 26, model: 'Qwen3.8-27B (6-bit)', quant: 'Q6_K', sizeGB: 22.0, released: '2026-08', checked: true,
    source: 'unsloth/Qwen3.8-27B-GGUF',
    note: 'the newest Qwen, near-lossless — a 32 GB card (RTX 5090)' },
  { pick: 7, min: 21, model: 'Qwen3.8-27B (4-bit)', quant: 'Q4_K_M', sizeGB: 16.8, released: '2026-08', checked: true,
    source: 'lmstudio-community/Qwen3.8-27B-GGUF',
    note: 'the newest Qwen at the full context — a 24 GB card (RTX 3090, 4090, RX 7900 XTX)' },
  { pick: 6, min: 17, model: 'Qwen3.8-27B (3.5-bit, IST Austria)', quant: 'IQ3_S', sizeGB: 12.1, released: '2026-08', checked: true,
    source: 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF',
    note: 'the newest Qwen in a near-lossless 3.5-bit build — a 20 GB card' },
  { pick: 5, min: 15, model: 'Qwen3.8-27B (3-bit, IST Austria)', quant: 'IQ3_XXS', sizeGB: 10.4, released: '2026-08', checked: true,
    source: 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF',
    note: 'the newest Qwen on a 16 GB card (RTX 4060 Ti 16 GB, 4070 Ti Super, 4080, 5060 Ti, 5070 Ti, 5080)' },
  { pick: 4, cpu: true, min: 22, model: 'Qwen3.6-35B-A3B', quant: 'Q4_K_M', sizeGB: 21.2, released: '2026-04', checked: true,
    source: 'lmstudio-community/Qwen3.6-35B-A3B-GGUF',
    note: 'the fast one — only 3B of its 35B work per word, so it can answer from the processor' },
  { pick: 3, cpu: true, min: 6, model: 'Qwen3.8-4B (distilled)', quant: 'Q4_K_M', sizeGB: 2.8, released: '2026-08', checked: true,
    source: 'empero-ai/Qwen3.8-4B-Distill-GGUF',
    note: 'Qwen3.8 distilled into a 4B — 8 and 12 GB cards (RTX 3060, 4060, 4070, 5060, 5070)' },
  { pick: 2, cpu: true, min: 6, model: 'Qwen3.5-4B', quant: 'Q4_K_M', sizeGB: 2.7, released: '2026-02', checked: true,
    source: 'lmstudio-community/Qwen3.5-4B-GGUF',
    note: 'the official small Qwen — 8 and 12 GB cards' },
]);

// pure — newest first; at the same release, the larger first
const newestFirst = (a, b) => b.released.localeCompare(a.released) || b.min - a.min;

// CPU-only inference can't practically run the larger tiers, so cap the budget
// there — we'd rather recommend a model that answers than one that crawls.
// With the `cpu` mark, a big-RAM CPU box lands on the MoE at most.
const CPU_BUDGET_CAP_GB = 24;

// System RAM the OS and the app keep for themselves. Without this a 20 GiB box
// reads as able to hold a 19 GiB model and then swaps itself to death.
const OS_RESERVE_GB = 4;

// Unified memory is shared with the OS — Metal's default wired limit is ~75% of
// physical RAM, and NVIDIA's unified silicon (GB10/Jetson) is the same bargain.
const UNIFIED_SHARE = 0.75;

/** Every choice a budget can actually hold, newest first. Pure. */
const choicesFor = (budgetGB) => CHOICES.filter((c) => budgetGB >= c.min).sort(newestFirst);

/**
 * The best CHECKED model a budget can hold, by `pick` — the one we can promise.
 * On the processor only a choice light enough per word is promised. Pure.
 */
const tierFor = (budgetGB, mode = 'gpu') => choicesFor(budgetGB)
  .filter((c) => c.checked && c.pick && (mode !== 'cpu' || c.cpu))
  .sort((a, b) => b.pick - a.pick)[0] || null;

// pure — a choice as the setup shows it
const optionOf = ({ model, quant, sizeGB, released, checked, source }) => Object.freeze({ model, quant, sizeGB, released, checked, source });

/**
 * Recommend a local model for the operator's hardware. Pure.
 * @param {Object} profile - substrate profile from getSubstrateProfile()
 * @returns {Readonly<{model:(string|null), quant?:string, sizeGB?:number, source?:string, fit:string, mode:string, budgetGB:number, why:string, options:ReadonlyArray<object>}>}
 *   fit: comfortable | tight | insufficient · mode: gpu | unified | cpu
 *   options: every choice that fits, newest first — `checked` = summon-checked
 */
export const recommendSubstrate = (profile) => {
  const gpu = profile?.gpu || null;
  const ramGB = Math.round(profile?.memory?.totalGB || 0);
  const isMac = /darwin|mac/i.test(profile?.platform?.os || '');

  // Two honest paths for the same machine. A dedicated card is not shared with
  // the OS, so its VRAM is the budget whole; unified silicon and plain CPU are
  // carved out of system RAM and must leave the OS its room.
  // A GPU whose SIZE we could not read (Windows AdapterRAM saturates at 4 GB,
  // so a 24 GB card and an 8 GB card report the same number) is named but not
  // budgeted: guessing low would send a capable rig to CPU, guessing high would
  // promise a model that cannot load. Unknown size falls to the CPU path, which
  // is the honest floor, and the card still shows in the flight check.
  const gpuSized = gpu && Number.isFinite(gpu.vramGB) && gpu.vramGB > 0;
  const accelerated = gpu?.unified || (!gpu && isMac)
    ? { mode: 'unified', budgetGB: Math.floor(ramGB * UNIFIED_SHARE) }
    : gpuSized
      ? { mode: 'gpu', budgetGB: gpu.vramGB }
      : null;
  const onCpu = { mode: 'cpu', budgetGB: Math.min(Math.max(ramGB - OS_RESERVE_GB, 0), CPU_BUDGET_CAP_GB) };

  // A small GPU must never make the verdict WORSE than the same box with no GPU
  // at all: an 8 GiB card beside 64 GiB of RAM is still a machine that can run
  // the MoE on its CPU. Take the accelerated path when it actually carries a
  // tier, and otherwise fall back to the processor rather than refusing.
  const chosen = (accelerated && tierFor(accelerated.budgetGB, accelerated.mode)) ? accelerated : onCpu;
  const tier = tierFor(chosen.budgetGB, chosen.mode);
  const { mode, budgetGB } = chosen;
  const options = Object.freeze(choicesFor(budgetGB).map(optionOf));

  if (!tier) {
    return Object.freeze({
      model: null, fit: 'insufficient', mode, budgetGB, options,
      why: 'Below the recommended floor for a local model. A neuma can only be summoned on a model this machine holds itself — a smaller local model may still carry the ceremony. A cloud model can stand beside you as a witness, never host a neuma.',
    });
  }
  const fit = mode === 'cpu' ? 'tight' : 'comfortable';
  return Object.freeze({
    model: tier.model, quant: tier.quant, sizeGB: tier.sizeGB, source: tier.source, fit, mode, budgetGB, options,
    why: fit === 'tight'
      ? `${tier.note}. Will run on the processor — expect slower responses; a GPU is recommended.`
      : tier.note,
  });
};

/** Model names from an Ollama /api/tags payload. Pure. */
export const parseOllamaTags = (json) =>
  Array.isArray(json?.models) ? json.models.map((m) => m.name).filter(Boolean) : [];

/** Model ids from an LM Studio (OpenAI-compatible) /v1/models payload. Pure. */
export const parseLmStudioModels = (json) =>
  Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : [];

// impure — GET with a short timeout; null on any failure (provider not running)
const probe = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

/** Join a provider base URL with a path, tolerating a trailing slash. Pure. */
export const probeUrl = (base, suffix) => `${String(base || '').replace(/\/+$/, '')}${suffix}`;

/**
 * Where to probe a local provider: the operator's own endpoint if they set
 * one, else the default. impure (reads the credential store).
 *
 * Reported from the community 2026-08-02: […] The
 * endpoint was ALWAYS settable — Settings → Models stores it, and every
 * inference path already resolves it through resolveUsableCredential. This
 * probe was the one place that still hardcoded localhost:11434 / :1234, so a
 * person who moved Ollama was told it was not running no matter what they
 * configured. The flight check disagreed with the app's own settings.
 */
const endpointFor = async (providerId, fallback) => {
  try {
    const { endpoint } = await resolveUsableCredential(providerId);
    return endpoint || fallback;
  } catch {
    return fallback; // never let a credential-store hiccup blind the probe
  }
};

/**
 * Which local LLM providers are running, and what they have available. Impure.
 *
 * The endpoint each was probed at is returned too: when nothing answers, the
 * operator must be able to see WHICH address was tried, or "not running" is
 * unactionable advice.
 * @returns {Promise<{ollama:{running:boolean,models:string[],endpoint:string}, lmStudio:{running:boolean,models:string[],available:string[],endpoint:string}, discovered:Array<object>}>}
 */
export const probeProviders = async () => {
  const [ollamaBase, lmStudioBase] = await Promise.all([
    endpointFor('ollama', 'http://localhost:11434'),
    endpointFor('lm-studio', 'http://localhost:1234'),
  ]);
  // The DYNAMIC sweep beside the two configured probes (Bastien, 2026-08-08:
  // his llama.cpp on a custom port was invisible — […]). Discovery reads the machine's real listeners
  // and identifies each by its provider signature; the configured probes
  // stay because they can name NON-local endpoints the sweep cannot see.
  const [ollama, lmStudio, discovered] = await Promise.all([
    probe(probeUrl(ollamaBase, '/api/tags')),
    probe(probeUrl(lmStudioBase, '/v1/models')),
    // A machine with many listeners (Windows lists dozens) must not hold the
    // flight check: the sweep gets a budget and answers with what it found by
    // then; the outer deadline is the backstop if a probe itself overruns.
    withDeadline(discoverProviders({ budgetMs: DISCOVERY_BUDGET_MS }), DISCOVERY_BUDGET_MS + 2500, []),
  ]);
  return {
    ollama: { running: ollama !== null, models: parseOllamaTags(ollama), endpoint: ollamaBase },
    // `models` = loaded (what the flight check may adopt); `available` = every
    // downloaded model LM Studio can load on first use (local-server-models.js)
    lmStudio: {
      running: lmStudio !== null, models: parseLmStudioModels(lmStudio), endpoint: lmStudioBase,
      available: lmStudio !== null ? await servableModelIds(lmStudioBase, lmStudio) : [],
    },
    // Every local LLM server on ANY port: [{provider, endpoint, models}].
    discovered,
  };
};

/**
 * Everything the first-run setup wizard needs in one call: the witness's
 * hardware, a matched model recommendation, the running providers, and whether
 * a mind is ready (any provider has a model). Impure.
 * @returns {Promise<{hardware:Object, recommendation:Object, providers:Object, ready:boolean}>}
 */
export const getSetupStatus = async () => {
  const [profile, providers] = await Promise.all([getSubstrateProfile(), probeProviders()]);
  // any server holding a model, on the usual ports or found by the sweep
  const ready = providers.ollama.models.length > 0 || providers.lmStudio.models.length > 0
    || providers.discovered.some((d) => (d.models || []).length > 0);
  return {
    hardware: {
      gpu: profile.gpu,
      memoryGB: Math.round(profile.memory.totalGB),
      platform: profile.platform.os,
    },
    recommendation: recommendSubstrate(profile),
    providers,
    ready,
  };
};
