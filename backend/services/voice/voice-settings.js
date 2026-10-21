// VOICE SETTINGS — the person's voice tier pick (data/settings/voice.json) and
// the tier in force on this machine.
//
//   { "tier": "auto" | "light" | "standard", "profile"?: "full" | "lean" | … }
//
// `auto` (the default, and what an absent or unreadable file means) takes the
// tier voice-tier.js recommends from the GPU and the mind's footprint. A named
// tier is the person's override; voice-tier.js says plainly what it costs the
// mind when it does not fit.
//
// `path` may be a () => string resolved at every read/write — a boot-bound path
// is the env-isolation trap (mind-gate-settings law). Tests isolate through
// NEUMA_VOICE_SETTINGS_PATH.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from '../data-root.js';
import { measuredMindGB, probeMachine } from '../machine-probe.js';
import { getTier } from './engine-registry.js';
import { TIER_CHOICES, autoTier } from './voice-tier.js';
import { createLogger } from '../logger.js';

const log = createLogger('Voice.Settings');

const DEFAULT_PATH = join(getSettingsDir(), 'voice.json');

/**
 * Pure — the setting a persisted record resolves to. Anything unknown reads as
 * `auto`; a profile survives only when the named tier declares it.
 * @param {object|null} record
 * @returns {Readonly<{tier: string, profile: string|null}>}
 */
export const resolveVoiceSetting = (record) => {
  const tier = TIER_CHOICES.includes(record?.tier) ? record.tier : 'auto';
  const profiles = tier === 'auto' ? {} : (getTier(tier)?.profiles ?? {});
  const profile = typeof record?.profile === 'string' && Object.hasOwn(profiles, record.profile) ? record.profile : null;
  return Object.freeze({ tier, profile });
};

/**
 * Pure — why a requested setting is refused, or null when it is valid.
 * @param {{tier?: unknown, profile?: unknown}} next
 */
export const voiceSettingError = (next) => {
  if (!TIER_CHOICES.includes(next?.tier)) return `tier must be one of ${TIER_CHOICES.join(', ')}`;
  if (next.profile === undefined || next.profile === null) return null;
  if (next.tier === 'auto') return 'a profile can only be named with a tier';
  const profiles = Object.keys(getTier(next.tier)?.profiles ?? {});
  return profiles.includes(next.profile) ? null : `the ${next.tier} tier has profiles ${profiles.join(', ')}`;
};

/**
 * @param {{ path?: string|(() => string) }} [opts]
 */
export const createVoiceSettings = ({ path = DEFAULT_PATH } = {}) => ({
  _path() { return typeof path === 'function' ? path() : path; },

  /** The setting in force. impure (fs); absent or unreadable = auto. */
  async read() {
    let record = null;
    try {
      record = JSON.parse(await fs.readFile(this._path(), 'utf8'));
    } catch { /* absent or unreadable — auto */ }
    return resolveVoiceSetting(record);
  },

  /**
   * Persist the person's pick. impure (fs). Throws with the reason on an
   * invalid tier/profile — a pick that silently became something else is worse.
   * @param {{tier: string, profile?: string|null}} next
   * @param {{wallet?: string|null}} [ctx]
   */
  async write(next, { wallet = null } = {}) {
    const error = voiceSettingError(next);
    if (error) throw new Error(error);
    const file = this._path();
    const record = { tier: next.tier, ...(next.profile ? { profile: next.profile } : {}) };
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    log.info('voice tier set', { ...record, wallet });
    return this.read();
  },
});

/** The one instance the speech path and the routes share. */
export const voiceSettings = createVoiceSettings({
  path: () => process.env.NEUMA_VOICE_SETTINGS_PATH || DEFAULT_PATH,
});

// The probe lives in machine-probe.js (shared with the Image Forge's VRAM
// ceiling); these names stay exported here so the voice readers never break.
export { measuredMindGB };
export const probeVoiceMachine = probeMachine;

/**
 * impure — the voice tier in force: the person's setting, the machine, what
 * auto would pick, and what is actually chosen.
 * @param {{fresh?: boolean}} [opts] - fresh re-probes the machine
 */
export const voiceTierInForce = async ({ fresh = false } = {}) => {
  const [setting, machine] = await Promise.all([voiceSettings.read(), probeVoiceMachine({ fresh })]);
  const auto = autoTier({ gpu: machine.gpu, mindGB: machine.mindGB });
  const chosen = setting.tier === 'auto' ? auto : autoTier({ gpu: machine.gpu, mindGB: machine.mindGB, override: setting });
  return Object.freeze({ setting, machine, auto, chosen });
};
