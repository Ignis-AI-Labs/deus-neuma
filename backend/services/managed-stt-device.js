// managed-stt-device — where dictation runs on an installed app: on the graphics card, as ears does,
// or on the processor. Decided from what this machine has free beside the house's own model. Pure;
// managed-stt-probe.js reads the machine.
//
// The card answers a held key in a fraction of a second with the turbo model; the processor takes
// base (managed-stt-plan.js). The card is only used where the speech model fits BESIDE the house's
// model with room to spare: the house's fit reads the card's free memory when its model loads, so a
// speech model that took the room first would leave the house a smaller window or fewer layers on
// the card. A 12 GB card running a 27B model has no such room; a 24 GB card running it does.

const GIB = 1024 ** 3;

/** What the speech model takes on the card: turbo q5_0 measured at 1,468 MiB on whisper.cpp b5454 (CUDA 13). */
export const STT_GPU_BYTES = 1.5 * GIB;

/** A model's file on the card, plus its cache and compute buffers. */
const HOUSE_MARGIN = 1.15;

/** With the house's model unknown, only a card this large is trusted to hold both. */
const UNKNOWN_HOUSE_MIN_CARD = 24 * GIB;

/** NVIDIA's driver floor for CUDA 13 on Linux (the graphics-card build is CUDA 13). */
export const CUDA13_DRIVER_MIN = 580;

const gb = (bytes) => `${(bytes / GIB).toFixed(1)} GB`;
const processor = (reason) => Object.freeze({ device: 'processor', reason });

/**
 * The card's room to keep free whatever else is on it: the larger of 2 GB and a tenth of the card.
 * @param {number} totalBytes
 */
const headroom = (totalBytes) => Math.max(2 * GIB, 0.1 * totalBytes);

/**
 * Where dictation runs. Pure.
 * @param {{
 *   build: boolean,                      a graphics-card build of the speech engine exists for this system
 *   gpu: ?{vendor: string, totalBytes: number, freeBytes: number, driverMajor: ?number},
 *   cudaLibDir: ?string,                 the CUDA 13 runtime libraries found on this machine
 *   houseBytes: ?number,                 the house model's file size, when the platform serves it
 * }} machine
 * @returns {Readonly<{device: 'gpu'|'processor', reason: string}>}
 */
export const sttDeviceFor = ({ build, gpu, cudaLibDir, houseBytes }) => {
  if (!build) return processor('there is no graphics-card build of the speech engine for this system');
  if (!gpu || gpu.vendor !== 'nvidia') return processor('there is no NVIDIA graphics card');
  if (!(gpu.driverMajor >= CUDA13_DRIVER_MIN)) {
    return processor(`the graphics driver (${gpu.driverMajor ?? 'unknown'}) is older than ${CUDA13_DRIVER_MIN}, which CUDA 13 needs`);
  }
  if (!cudaLibDir) return processor('the CUDA 13 runtime libraries are not on this computer');
  const room = headroom(gpu.totalBytes);
  // whatever is planned, the model has to fit on the card as it stands now
  if (gpu.freeBytes < STT_GPU_BYTES + GIB) {
    return processor(`the graphics card has ${gb(gpu.freeBytes)} free right now`);
  }
  if (Number.isFinite(houseBytes) && houseBytes > 0) {
    const left = gpu.totalBytes - houseBytes * HOUSE_MARGIN - STT_GPU_BYTES;
    return left >= room
      ? Object.freeze({ device: 'gpu', reason: `the graphics card holds the speech model beside the house's model with ${gb(left)} to spare` })
      : processor(`the graphics card is needed for the house's model (${gb(houseBytes)}); the speech model would leave ${gb(Math.max(left, 0))}`);
  }
  if (gpu.totalBytes < UNKNOWN_HOUSE_MIN_CARD) {
    return processor(`the house's model is not known, and a ${gb(gpu.totalBytes)} card may need all of itself for it`);
  }
  return gpu.freeBytes - STT_GPU_BYTES >= room
    ? Object.freeze({ device: 'gpu', reason: `the graphics card has ${gb(gpu.freeBytes)} free` })
    : processor(`the graphics card has ${gb(gpu.freeBytes)} free, short of the speech model and its headroom`);
};
