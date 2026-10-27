// gpu-driver-guard — is this NVIDIA driver new enough to be handed a model? Pure.
//
// WHY (2026-10-23): twice, a Windows 11 laptop with an RTX 5070 Ti Laptop GPU (Blackwell) crashed
// in kernel mode (KERNEL_MODE_HEAP_CORRUPTION, then a boot loop) after the app set up its model
// server and loaded a model. A kernel-mode heap corruption is a driver's fault, and a new card
// generation on a driver older than the CUDA build it is asked to run is the first suspect. So on
// Windows the platform reads the NVIDIA driver version, and below the floor for that card it
// keeps the model on the processor until the driver is updated, says so plainly with the update
// link, and lets the person decide otherwise.
//
// THE FLOORS, from their sources:
// - 550: Ollama's own minimum for NVIDIA cards (docs.ollama.com/gpu).
// - 570: compute capability 5.0-6.2 (Maxwell, Pascal), the same page.
// - 580: Blackwell (RTX 50xx, RTX PRO Blackwell, compute capability 12.x). Blackwell first runs
//   on CUDA 12.8 (Windows driver 570.65; the 12.8 Update 1 runtime Ollama 0.40.7 bundles needs
//   572.61), and the CUDA 13 build that Ollama 0.40.7 prefers needs 580 (NVIDIA's CUDA release
//   notes). The card generation is new, so it is held to the driver its preferred build needs.

export const NVIDIA_DRIVER_LINK = 'https://www.nvidia.com/en-us/drivers/';

const FLOORS = Object.freeze([
  Object.freeze({ floor: 580, generation: 'RTX 50-series (Blackwell)', test: /\bRTX\s*50[1-9]0\b|Blackwell|\bGB10\b/i }),
  Object.freeze({ floor: 570, generation: 'GTX 900/1000-series (Maxwell, Pascal)', test: /\bGTX\s*(9\d0|10\d0)\b|\bTITAN\s*Xp?\b|\b(Quadro|Tesla)\s*[MP]\d/i }),
]);
const DEFAULT_FLOOR = Object.freeze({ floor: 550, generation: 'NVIDIA', test: null });

/**
 * An NVIDIA driver version as NVIDIA writes it (581.57), from nvidia-smi's "581.57" or Windows'
 * own "32.0.15.8157" (the last five digits of the last two parts: 15 8157 → 581.57). Pure.
 * @param {string|null|undefined} raw
 * @returns {number|null}
 */
export const nvidiaDriverVersion = (raw) => {
  const text = String(raw ?? '').trim();
  const smi = /^(\d{3})\.(\d{1,2})(?:\.\d+)?$/.exec(text);
  if (smi) return Number(`${smi[1]}.${smi[2].padStart(2, '0')}`);
  const win = /^\d+\.\d+\.(\d+)\.(\d+)$/.exec(text);
  if (!win) return null;
  const digits = `${win[1]}${win[2].padStart(4, '0')}`.slice(-5);
  return digits.length === 5 ? Number(`${digits.slice(0, 3)}.${digits.slice(3)}`) : null;
};

/** The driver floor for an NVIDIA card, by its name. Pure. */
export const driverFloorFor = (name) => FLOORS.find((f) => f.test.test(String(name ?? ''))) || DEFAULT_FLOOR;

/**
 * Should the model be kept off this GPU until its driver is updated? Only an NVIDIA card on
 * Windows whose driver version was read and is below its floor is held; anything unread is not
 * (the guard never invents a reason). The person's own choice (`override`) releases it. Pure.
 * @param {{platform: string, gpu: {vendor?: string, name?: string, driver?: string|null}|null, override?: boolean}} input
 * @returns {Readonly<{hold: boolean, checked: boolean, floor?: number, have?: number|null, overridden?: boolean, line?: string, link?: string}>}
 */
export const driverGuard = ({ platform, gpu, override = false }) => {
  if (platform !== 'win32' || gpu?.vendor !== 'nvidia') return Object.freeze({ hold: false, checked: false });
  const have = nvidiaDriverVersion(gpu.driver);
  const { floor, generation } = driverFloorFor(gpu.name);
  if (have == null) return Object.freeze({ hold: false, checked: false, floor, have: null });
  if (have >= floor) return Object.freeze({ hold: false, checked: true, floor, have });
  const fixed = (n) => n.toFixed(2);
  const base = `The graphics driver here is ${fixed(have)}; ${generation} cards need ${floor} or newer to run a model safely.`;
  if (override) {
    return Object.freeze({ hold: false, checked: true, floor, have, overridden: true, link: NVIDIA_DRIVER_LINK,
      line: `${base} You chose to use the graphics card anyway. Updating the driver is still the safe way.` });
  }
  return Object.freeze({ hold: true, checked: true, floor, have, link: NVIDIA_DRIVER_LINK,
    line: `${base} Until it is updated, the model runs on the processor (slower), not the graphics card. Update it from NVIDIA (or your laptop maker), then restart Deus Neuma.` });
};
