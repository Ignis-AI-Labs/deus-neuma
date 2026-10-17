// Voice tier — which voice tier fits this machine. Pure.
//
// Design note, 2026-10-01 (docs/work/one-voice.md, THREE TIERS; High/MisoTTS dropped
// the same day — CSM sounded better, so Standard is the top): every tier clones the
// SAME Voice DNA clip; only quality and speed change. Neuma recommends the best
// tier that fits beside the mind, and the person may override it with a plain
// word about what that costs the mind.
//
//   no usable GPU, or not NVIDIA  → light     (Chatterbox Nano on the processor)
//   GPU room left beside the mind → the roomiest GPU profile that fits:
//                                   standard/full (CSM-1B bf16), standard/lean
//                                   (CSM-1B int8)
//   too little room               → light
//
// The memory each profile needs is READ from voice-engines/engines.json (the
// measured process peak, `memMB`) and padded by MEMORY_HEADROOM — never typed
// here. The rungs are every GPU profile the registry declares, roomiest first.

import { getTier, listTiers } from './engine-registry.js';

export const TIER_IDS = Object.freeze(listTiers().map((t) => t.id));
export const TIER_CHOICES = Object.freeze(['auto', ...TIER_IDS]);

// The engines.json figures are measured process peaks on one card; the CUDA
// context and the allocator grow past them on other cards and drivers, and the
// mind's KV cache moves too. 12% keeps a voice from tipping the mind into an
// out-of-memory load: standard/full ≈ 6.3 GB, standard/lean ≈ 2.7 GB.
export const MEMORY_HEADROOM = 1.12;

const MB_PER_GB = 1024;
const round1 = (n) => Math.round(n * 10) / 10;

/** pure — GB a tier profile needs free on the GPU (null for an unknown pair). */
export const needGB = (tierId, profileId) => {
  const memMB = getTier(tierId)?.profiles?.[profileId]?.memMB;
  return Number.isFinite(memMB) ? round1((memMB * MEMORY_HEADROOM) / MB_PER_GB) : null;
};

// pure — every GPU profile in the registry, roomiest first.
const gpuRungs = () => listTiers()
  .filter((t) => t.device === 'cuda')
  .flatMap((t) => Object.entries(t.profiles ?? {}).map(([profile, p]) => ({ tier: t.id, profile, memMB: p.memMB })))
  .sort((a, b) => b.memMB - a.memMB);

// pure — the processor tier (the one with no GPU device).
const cpuTier = () => listTiers().find((t) => t.device === 'cpu');

const choice = (tier, profile, reason, spareGB = null) =>
  Object.freeze({ tier, profile, reason, spareGB, needGB: tier ? needGB(tier, profile) : null });

const light = (reason, spareGB = null) => {
  const t = cpuTier();
  return choice(t.id, t.defaultProfile, reason, spareGB);
};

// pure — normalise an override: a tier id string, or the settings record {tier, profile}.
const overrideOf = (override) => {
  const o = typeof override === 'string' ? { tier: override } : (override ?? {});
  return TIER_IDS.includes(o.tier) ? { tier: o.tier, profile: o.profile ?? null } : null;
};

// pure — GB left on the GPU beside the mind, or null when the GPU is not one the
// Sesame voice can use (with the plain reason why).
const spareOf = (gpu, mindGB) => {
  if (!gpu) return { why: 'No GPU was found, so the voice runs on the processor.' };
  if (gpu.vendor !== 'nvidia') {
    return { why: `This ${gpu.vendor || 'unknown'} GPU is not yet proven for the Sesame voice, so the voice runs on the processor.` };
  }
  if (!(gpu.vramGB > 0)) return { why: "The GPU's memory could not be read, so the voice runs on the processor." };
  return { spare: round1(gpu.vramGB - (Number.isFinite(mindGB) ? mindGB : 0)) };
};

// pure — the person's own pick, with the plain cost when it does not fit.
const chosenByPerson = ({ tier, profile }, spare) => {
  const t = getTier(tier);
  const fits = (p) => spare !== null && spare !== undefined && spare >= needGB(tier, p);
  const profiles = Object.keys(t.profiles ?? {});
  const picked = profiles.includes(profile) ? profile
    : (t.device === 'cuda'
      ? (profiles.filter(fits).sort((a, b) => needGB(tier, b) - needGB(tier, a))[0]
        ?? profiles.sort((a, b) => needGB(tier, a) - needGB(tier, b))[0])
      : t.defaultProfile);
  if (t.device !== 'cuda') return choice(tier, picked, 'Chosen by you: the voice runs on the processor.', spare);
  const need = needGB(tier, picked);
  if (fits(picked)) return choice(tier, picked, `Chosen by you: needs about ${need} GB of GPU memory, ${spare} GB is free beside the mind.`, spare);
  return choice(tier, picked, spare === null || spare === undefined
    ? `Chosen by you: needs about ${need} GB of GPU memory, and this machine's GPU cannot be used for it — the voice may fail to start.`
    : `Chosen by you: needs about ${need} GB of GPU memory but only ${spare} GB is free beside the mind — the mind may run out of room or the voice may fail to start.`,
  spare);
};

/**
 * The voice tier for this machine. Pure.
 * @param {{gpu?: {vendor?: string, vramGB?: number|null}|null, mindGB?: number|null,
 *   override?: string|{tier?: string, profile?: string|null}|null}} machine
 *   gpu: detectGpu()'s record; mindGB: the mind's GPU footprint (measured, else
 *   the recommended model's size); override: the person's pick ('auto' or absent = recommend)
 * @returns {Readonly<{tier: string, profile: string, reason: string, spareGB: number|null, needGB: number|null}>}
 */
export const autoTier = ({ gpu = null, mindGB = null, override = null } = {}) => {
  const { spare = null, why } = spareOf(gpu, mindGB);
  const picked = overrideOf(override);
  if (picked) return chosenByPerson(picked, spare);
  if (why) return light(why);
  const rung = gpuRungs().find((r) => spare >= needGB(r.tier, r.profile));
  if (rung) {
    return choice(rung.tier, rung.profile,
      `${spare} GB of GPU memory is free beside the mind; this voice needs about ${needGB(rung.tier, rung.profile)} GB.`, spare);
  }
  const smallest = gpuRungs().at(-1);
  return light(`Only ${spare} GB of GPU memory is free beside the mind; the smallest Sesame voice needs about ${needGB(smallest.tier, smallest.profile)} GB, so the voice runs on the processor.`, spare);
};
