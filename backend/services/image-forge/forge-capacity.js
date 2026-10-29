/**
 * THE FORGE'S CEILING — how much VRAM the ComfyUI engine must leave free, and
 * what this machine can make. Pure, over the shared machine probe
 * (machine-probe.js). Most people who pick up a video tool do not know their
 * machine's limits, so the cap is built into the flight check rather than left
 * to them — an unbounded engine can freeze a computer.
 *
 * Every constant is a MEASUREMENT from the 2026-10-18 video reel on the RTX PRO
 * 6000 (docs/work/video-forge.md, PHASE 0 RESULTS) — never a guess:
 *   · `--vram-headroom` is a hard ceiling at no speed cost: the engine ran
 *     MiniMax H3 video at full quality in 22 GB, and within 10% in 6.7 GB.
 *   · unbounded, the engine took every free byte (97.1 of 97.9 GB).
 *   · system RAM, not the GPU, is what freezes a machine. Unbounded, the video
 *     engine staged 45-47 GB; under a hard cgroup ceiling it ADAPTS — LTX-2.3
 *     and MiniMax H3 rendered at 24 GB (output pixel-identical), LTX-2.3 was
 *     OOM-killed at 16 GB, and LTX-2.5 (the shipped model) rendered at 16 GB.
 */

// ≥1 GiB is the engine's own soft-floor law (Phase-0 spike, item 14: the floor
// was nicked by 176 MiB), plus room for the desktop's own GPU growth.
export const SAFETY_HEADROOM_GB = 2;

// The smallest engine budget the heaviest measured job (H3 video) ran in.
export const MIN_ENGINE_VRAM_GB = 7;

// The smallest RAM ceiling the shipped video model rendered under (LTX-2.5 in a
// 16 GB box, 2026-10-19; LTX-2.3 had needed 24).
export const VIDEO_RAM_GB = 16;

// The smallest RAM ceiling image jobs ran under (Anima + FLUX.2 klein peaked
// at 6.7 GB inside an 8 GB cgroup, 2026-10-18).
export const IMAGE_RAM_GB = 8;

// System RAM the engine's ceiling never takes: the desktop, the backend and the
// mind's own host memory keep running while a clip renders.
export const SYSTEM_RAM_RESERVE_GB = 6;

const roundHalf = (n) => Math.ceil(n * 2) / 2;

/**
 * VRAM (GB) the engine must keep completely free — ComfyUI counts other apps,
 * so what is ALREADY on the card needs no reserve. A mind that is not on the
 * card yet (only recommended) is reserved in full, or the engine would fill its
 * room and the being could not relight. Unknown GPU: reserve the mind anyway.
 * @param {{gpu: ({vramGB: number|null}|null), mindGB: number, mindSource: string}} machine
 * @returns {number}
 */
export const comfyHeadroomGb = (machine) => {
  const pendingMind = machine?.mindSource === 'measured' ? 0 : (machine?.mindGB ?? 0);
  return roundHalf(SAFETY_HEADROOM_GB + pendingMind);
};

// pure — system RAM (GB) free now that the engine may spend, after the reserve
// the rest of the machine keeps; null when RAM is unreadable.
const spareRamGb = (machine) => {
  const free = machine?.ram?.availableGB ?? machine?.ram?.totalGB;
  return Number.isFinite(free) ? Math.floor(free - SYSTEM_RAM_RESERVE_GB) : null;
};

/**
 * The hard system-RAM ceiling (GB) the engine launches under where the OS can
 * enforce one (engine-memory-scope.js): a job too big for the machine stops
 * the ENGINE, never the desktop. What is spare now, never below the image floor, never
 * above the machine less its reserve. Null when RAM is unreadable.
 * @param {{ram: ({totalGB: number, availableGB: number|null}|null)}} machine
 * @returns {number|null}
 */
export const engineRamCeilingGb = (machine) => {
  const spare = spareRamGb(machine);
  const total = machine?.ram?.totalGB;
  if (spare === null || !Number.isFinite(total)) return null;
  return Math.min(Math.floor(total - SYSTEM_RAM_RESERVE_GB), Math.max(spare, IMAGE_RAM_GB));
};

/**
 * What this machine can make, in words a person can act on. `engineGB` is the
 * VRAM left to the engine beside the mind and the ceiling. On unified memory
 * (Apple, GB10) the card IS system RAM, so video's staging must fit that pool.
 * @param {{gpu: ({vramGB: number|null, unified?: boolean}|null), mindGB: number,
 *   mindSource: string, ram: ({totalGB: number, availableGB: number|null}|null)}} machine
 * @returns {{engineGB: number|null, headroomGb: number,
 *   image: {ok: boolean, why: string}, video: {ok: boolean, why: string}}}
 */
export const forgeCapacity = (machine, { videoRamGB = VIDEO_RAM_GB } = {}) => {
  const headroomGb = comfyHeadroomGb(machine);
  const vram = machine?.gpu?.vramGB;
  if (!Number.isFinite(vram)) {
    const why = machine?.gpu ? 'the GPU memory size cannot be read on this machine' : 'no GPU detected';
    return { engineGB: null, headroomGb, image: { ok: false, why }, video: { ok: false, why } };
  }
  const engineGB = Math.round((vram - (machine.mindGB ?? 0) - headroomGb) * 10) / 10;
  const roomOk = engineGB >= MIN_ENGINE_VRAM_GB;
  const roomWhy = `needs ${MIN_ENGINE_VRAM_GB} GB of GPU memory beside the mind, ${Math.max(0, engineGB)} GB is left`;
  const image = roomOk
    ? { ok: true, why: `up to ${engineGB} GB of GPU memory, ${headroomGb} GB always kept free` }
    : { ok: false, why: roomWhy };
  // Unified memory: the card IS system RAM, so the machine's reserve comes out of the same pool.
  const ram = machine.gpu.unified ? Math.floor(engineGB - SYSTEM_RAM_RESERVE_GB) : spareRamGb(machine);
  let video;
  if (!roomOk) video = { ok: false, why: roomWhy };
  else if (!Number.isFinite(ram)) video = { ok: false, why: 'system memory cannot be read on this machine' };
  else if (ram < videoRamGB) video = { ok: false, why: `needs ${videoRamGB} GB of free system memory for the engine, ${Math.max(0, ram)} GB can be spared` };
  else video = { ok: true, why: `fits — while a clip renders, the mind thinks up to about 4x slower` };
  return { engineGB, headroomGb, image, video };
};
