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
import { getSubstrateProfile } from '../substrate-detector.js';
import { recommendSubstrate } from '../substrate-setup.js';
import { getSubstrateTelemetry } from '../substrate-telemetry.js';
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

// pure — the mind's GPU footprint from the substrate telemetry's on-GPU
// processes (every llama-server is a mind on the card), or null when none is
// measured.
export const measuredMindGB = (processes) => {
  const mb = (processes ?? []).filter((p) => /llama-server/.test(p.name)).reduce((s, p) => s + p.memMB, 0);
  return mb > 0 ? Math.round((mb / 1024) * 10) / 10 : null;
};

// The machine changes rarely (a card, a mind swap); a turn must not pay an
// nvidia-smi round trip per sentence.
const MACHINE_TTL_MS = 5 * 60 * 1000;
let _machine = null;

/**
 * impure — the GPU and the mind's footprint beside it: MEASURED when a mind is
 * on the card, else the size of the model recommended for this machine
 * (substrate-setup.js — its tiers are never copied here). Cached MACHINE_TTL_MS.
 * @param {{fresh?: boolean}} [opts]
 */
export const probeVoiceMachine = async ({ fresh = false } = {}) => {
  if (!fresh && _machine && Date.now() - _machine.at < MACHINE_TTL_MS) return _machine.value;
  const [profile, telemetry] = await Promise.all([
    getSubstrateProfile().catch(() => null),
    getSubstrateTelemetry().catch(() => null),
  ]);
  const gpu = profile?.gpu ?? null;
  const measured = measuredMindGB(telemetry?.processes);
  const rec = profile ? recommendSubstrate(profile) : null;
  const recommended = rec && rec.mode !== 'cpu' ? (rec.sizeGB ?? 0) : 0;
  const value = Object.freeze({
    gpu: gpu ? Object.freeze({ name: gpu.name, vendor: gpu.vendor ?? null, vramGB: gpu.vramGB ?? null, unified: gpu.unified === true }) : null,
    mindGB: measured ?? recommended,
    mindSource: measured !== null ? 'measured' : 'recommended',
  });
  _machine = { at: Date.now(), value };
  return value;
};

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
