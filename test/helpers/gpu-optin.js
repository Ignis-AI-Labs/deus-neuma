/**
 * Opt-in gate for GPU-ENGINE tests — suites that light real engines on the
 * machine's GPU (ComfyUI/SDXL, voice sidecars, whisper) or drive real
 * synthesis on one already up.
 *
 * THE LAW (Xid 79, 2026-07-24): PRESENCE IS NOT CONSENT. These suites used
 * to run whenever their engine was installed or answering — so every casual
 * full-suite run on the witness's live rig stacked fresh GPU contexts and
 * power load beside the serving substrate. At 13:40:36 the GPU fell off the
 * bus (NVRM Xid 79, "Node Reboot Required") minutes after exactly that
 * stack: gemma-4 serving + a test-suite SDXL generation + voice engines
 * resident. A driver this far gone takes the whole machine down.
 *
 * So: GPU-engine tests run ONLY when explicitly summoned, and only in the
 * serial substrate-live lane (vitest.config.js) — one engine at a time,
 * never beside the parallel suite. No auto-enable on engine presence, ever
 * — that auto-enable is the exact behavior this gate exists to end.
 *
 *   RUN_GPU_ENGINE_TESTS=1  — the operator summons the engines knowingly
 *   (anything else)         — skip, on every machine, regardless of what
 *                             is installed or serving
 */
export const shouldRunGpuEngineTests = () => process.env.RUN_GPU_ENGINE_TESTS === '1';

/** The skip line suites print so a parked proof is never silent. */
export const gpuSkipNote = (what) =>
  `[gpu-optin] ${what} parked — GPU-engine tests run only when summoned (RUN_GPU_ENGINE_TESTS=1, serial substrate-live lane). Presence is not consent (Xid 79, 2026-07-24).`;
