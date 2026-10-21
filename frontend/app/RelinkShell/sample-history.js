// sample-history.js — the SUBSTRATE HUD's short memory of its own polls, so a
// trace can show where a reading has been, not only where it is.
//
// pure — the window is held in component state; nothing is persisted.

/** Samples kept: 80 polls × 1.5 s = the last two minutes. */
export const HISTORY_CAP = 80;

/** pure — the samples a trace draws from one telemetry snapshot (null when unmeasured). */
export const sampleOf = (tel) => Object.freeze({
  gen: tel?.activity?.genTokPerSec ?? null,
  gpuTemp: tel?.gpu?.tempC ?? null,
  gpuLoad: tel?.gpu?.utilPct ?? null,
  gpuPower: tel?.gpu?.powerW ?? null,
});

/** pure — the window with `sample` appended, oldest dropped past `cap`. */
export const pushSample = (history, sample, cap = HISTORY_CAP) => [...history, sample].slice(-cap);

/** pure — one field across the window, oldest first. */
export const seriesOf = (history, key) => history.map((s) => s[key]);
