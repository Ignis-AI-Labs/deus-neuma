// forge-tier-model.js — the voice tier corner's view model. Pure.
//
// THREE TIERS (Design note, 2026-10-01; docs/work/one-voice.md): every tier clones
// the SAME voice; only quality and speed change. Neuma recommends the best
// tier that fits beside the mind (auto); the person may choose another, with
// a plain warning about what it costs the mind.
//
// Reads the answer of GET /api/v1/voice/tier (backend/routes/voice-routes.js):
// {setting:{tier, profile}, chosen:{tier, profile, reason, spareGB, needGB},
//  auto:{…same}, reason, machine, tiers:[{id, engine, model, device,
//  defaultProfile, profiles:{id:{memMB, ramMB, needGB}}}]}.

const TIER_ORDER = Object.freeze(['light', 'standard']);

// Proper names of the voice models — never translated.
const ENGINE_NAMES = Object.freeze({
  'csm-1b': 'Sesame',
  'chatterbox-nano': 'Chatterbox',
});

const rank = (id) => TIER_ORDER.indexOf(id);
const round1 = (n) => Math.round(n * 10) / 10;

/** pure — the display name of a tier's voice model. */
export const engineNameOf = (tier) => ENGINE_NAMES[tier?.model] ?? ENGINE_NAMES[tier?.engine] ?? tier?.engine ?? '';

/**
 * What a tier costs this machine: GPU memory for a GPU tier, RAM for the
 * processor tier. Pure.
 * @param {object} tier - one row of `tiers`
 * @param {string|null} [profileId] - the profile in question (default the tier's own)
 * @returns {{device: 'gpu'|'cpu', gb: number|null}}
 */
export const costOf = (tier, profileId = null) => {
  const profile = tier?.profiles?.[profileId ?? tier?.defaultProfile] ?? null;
  if (tier?.device === 'cuda') {
    const gb = Number.isFinite(profile?.needGB) ? profile.needGB : (Number.isFinite(profile?.memMB) ? round1(profile.memMB / 1024) : null);
    return { device: 'gpu', gb };
  }
  return { device: 'cpu', gb: Number.isFinite(profile?.ramMB) ? round1(profile.ramMB / 1024) : null };
};

/**
 * The tier corner: what is in force, and every choice with its cost and
 * whether it reaches above what this machine recommends. Pure.
 * @param {object|null} answer - GET /api/v1/voice/tier
 * @returns {null|{tier: string, engineName: string, setting: string, reason: string,
 *   autoTier: string|null, spareGB: number|null,
 *   choices: Array<{id: string, engineName: string, cost: object|null, aboveAuto: boolean, fits: boolean}>}}
 */
export const tierCornerOf = (answer) => {
  const tiers = Array.isArray(answer?.tiers) ? answer.tiers : [];
  const chosen = answer?.chosen;
  if (!chosen?.tier) return null;
  const byId = Object.fromEntries(tiers.map((t) => [t.id, t]));
  const autoTier = answer.auto?.tier ?? null;
  const spareGB = Number.isFinite(answer.auto?.spareGB) ? answer.auto.spareGB : null;
  const tierChoices = [...tiers]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((t) => {
      const cost = costOf(t);
      const fits = cost.device === 'cpu' || (spareGB !== null && cost.gb !== null && spareGB >= cost.gb);
      return { id: t.id, engineName: engineNameOf(t), cost, aboveAuto: autoTier !== null && rank(t.id) > rank(autoTier), fits };
    });
  const autoRow = { id: 'auto', engineName: engineNameOf(byId[autoTier]), cost: null, aboveAuto: false, fits: true };
  return {
    tier: chosen.tier,
    engineName: engineNameOf(byId[chosen.tier]),
    setting: answer.setting?.tier ?? 'auto',
    reason: typeof answer.reason === 'string' ? answer.reason : (chosen.reason ?? ''),
    autoTier,
    spareGB,
    choices: [autoRow, ...tierChoices],
  };
};

/**
 * Whether choosing this tier earns the plain warning: it reaches above what
 * the machine recommends, or it does not fit beside the mind. Pure.
 * @param {{aboveAuto: boolean, fits: boolean}|null} choice
 */
export const tierNeedsWarning = (choice) => Boolean(choice && choice.id !== 'auto' && (choice.aboveAuto || !choice.fits));
