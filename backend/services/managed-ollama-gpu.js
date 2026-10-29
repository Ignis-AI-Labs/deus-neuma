// managed-ollama-gpu — what the platform's own model server may ask of this graphics card.
// impure (fs, nvidia-smi, the server's own reports). The decisions are pure: the window in
// ollama-window.js, the driver floor in gpu-driver-guard.js, the server's environment in
// managed-ollama-plan.js (managedServeEnv).
//
// Two questions, asked when the server starts (never on a timer):
//   - Is the driver new enough to be handed a model? On Windows an NVIDIA driver below its card's
//     floor keeps the model on the processor until it is updated, unless the person chose
//     otherwise (their choice is kept in settings/gpu-driver.json).
//   - How large a window can the card hold? Read from the model's own layout (/api/show), its
//     size (/api/tags) and the card's free memory, before the model is loaded.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettingsDir } from './data-root.js';
import { detectGpu, readNvidiaMemory } from './gpu-probe.js';
import { driverGuard } from './gpu-driver-guard.js';
import { fitOllamaWindow, gpuRoomBytes, kvBytesPerToken, OLLAMA_SERVED_CONTEXT } from './ollama-window.js';

const choicePath = () => path.join(getSettingsDir(), 'gpu-driver.json');
const REPORT_MS = 3000;

/** Has the person chosen to use the graphics card despite an old driver? impure */
const gpuAnyway = () => {
  try { return JSON.parse(fs.readFileSync(choicePath(), 'utf8')).useGpuAnyway === true; } catch { return false; }
};

/** Keep the person's choice (tmp + rename, so a crash never leaves half a file). impure */
export const saveGpuAnyway = async (useGpuAnyway, wallet = null) => {
  const file = choicePath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ useGpuAnyway: Boolean(useGpuAnyway), by: wallet, at: new Date().toISOString() }, null, 2));
  await fsp.rename(tmp, file);
};

/** The driver guard for this machine now (gpu-driver-guard.js). impure. Never throws. */
export const currentDriverGuard = async () => {
  const gpu = await detectGpu().catch(() => null);
  return driverGuard({ platform: process.platform, gpu, override: gpuAnyway() });
};

// impure — one of the server's own reports, or null
const report = async (url, body) => {
  try {
    const res = await fetch(url, body ? {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(REPORT_MS),
    } : { signal: AbortSignal.timeout(REPORT_MS) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
};

/**
 * The window to serve a model at on this card, read before the model loads: its layout and size
 * from the server, the card's free memory from the driver, no more than NEUMA_MODEL_BUDGET_GB.
 * A model on the processor (the driver guard holds the card) is served the usual window. impure
 * @param {string} endpoint the server holding the model
 * @param {string} model its Ollama name
 * @param {{onGpu?: boolean}} [opts] onGpu false: the card is not used
 * @returns {Promise<Readonly<{window: number, onGpu: boolean|null, line: string}>>}
 */
export const fitManagedWindow = async (endpoint, model, { onGpu = true } = {}) => {
  if (!onGpu) return Object.freeze({ window: OLLAMA_SERVED_CONTEXT, onGpu: false, line: `Served on the processor at a ${OLLAMA_SERVED_CONTEXT.toLocaleString('en-US')}-token window.` });
  const [show, tags, memory, gpu] = await Promise.all([
    report(`${endpoint}/api/show`, { model }), report(`${endpoint}/api/tags`), readNvidiaMemory(), detectGpu().catch(() => null),
  ]);
  const weightsBytes = (tags?.models || []).find((m) => m.name?.toLowerCase() === model.toLowerCase())?.size || 0;
  const totalBytes = memory?.totalBytes ?? (Number.isFinite(gpu?.vramGB) && !gpu?.unified ? gpu.vramGB * 1024 ** 3 : null);
  const roomBytes = gpuRoomBytes({ freeBytes: memory?.freeBytes, totalBytes, budgetGB: Number(process.env.NEUMA_MODEL_BUDGET_GB) || null });
  return fitOllamaWindow({ roomBytes: weightsBytes ? roomBytes : null, weightsBytes, kvPerToken: kvBytesPerToken(show?.model_info) });
};
