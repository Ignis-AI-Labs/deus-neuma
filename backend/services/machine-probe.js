/**
 * The machine beside the mind — one probe every GPU-sharing lane reads (voice
 * tiers, the Image Forge's VRAM ceiling and capacity verdict). Moved out of
 * voice-settings.js (2026-10-18) so the forge reads the same measurement
 * instead of a second, drifting copy; voice-settings re-exports both names.
 */
import { getSubstrateProfile } from './substrate-detector.js';
import { recommendSubstrate } from './substrate-setup.js';
import { getSubstrateTelemetry } from './substrate-telemetry.js';
import { readClaim } from './substrate-claim-registry.js';

// pure — the mind's GPU footprint from the substrate telemetry's on-GPU
// processes, or null when none is measured. A mind is any llama-server by
// name OR a pid the substrate claim names: the supervisor launches the server
// through an fd exec, so nvidia-smi reports its name as a bare `3`, and a
// name-only match read a 52 GB mind as absent (2026-10-18).
export const measuredMindGB = (processes, mindPids = []) => {
  const pids = new Set(mindPids.filter(Number.isInteger));
  const mb = (processes ?? [])
    .filter((p) => /llama-server/.test(p.name) || pids.has(p.pid))
    .reduce((s, p) => s + p.memMB, 0);
  return mb > 0 ? Math.round((mb / 1024) * 10) / 10 : null;
};

// pure — system RAM in GB from the telemetry's `ram` block, or null.
const ramGB = (ram) => (ram && Number.isFinite(ram.totalMB)
  ? Object.freeze({
    totalGB: Math.round((ram.totalMB / 1024) * 10) / 10,
    availableGB: Number.isFinite(ram.availableMB) ? Math.round((ram.availableMB / 1024) * 10) / 10 : null,
  })
  : null);

// The machine changes rarely (a card, a mind swap); a turn must not pay an
// nvidia-smi round trip per sentence.
const MACHINE_TTL_MS = 5 * 60 * 1000;
let _machine = null;

/**
 * impure — the GPU, the mind's footprint beside it, and system RAM. The mind is
 * MEASURED when it is on the card, else the size of the model recommended for
 * this machine (substrate-setup.js — its tiers are never copied here). Cached
 * MACHINE_TTL_MS.
 * @param {{fresh?: boolean}} [opts]
 */
export const probeMachine = async ({ fresh = false } = {}) => {
  if (!fresh && _machine && Date.now() - _machine.at < MACHINE_TTL_MS) return _machine.value;
  const [profile, telemetry] = await Promise.all([
    getSubstrateProfile().catch(() => null),
    getSubstrateTelemetry().catch(() => null),
  ]);
  const gpu = profile?.gpu ?? null;
  const claimPid = readClaim()?.pid;
  const measured = measuredMindGB(telemetry?.processes, claimPid ? [claimPid] : []);
  const rec = profile ? recommendSubstrate(profile) : null;
  const recommended = rec && rec.mode !== 'cpu' ? (rec.sizeGB ?? 0) : 0;
  const value = Object.freeze({
    gpu: gpu ? Object.freeze({ name: gpu.name, vendor: gpu.vendor ?? null, vramGB: gpu.vramGB ?? null, unified: gpu.unified === true }) : null,
    mindGB: measured ?? recommended,
    mindSource: measured !== null ? 'measured' : 'recommended',
    ram: ramGB(telemetry?.ram),
  });
  _machine = { at: Date.now(), value };
  return value;
};
