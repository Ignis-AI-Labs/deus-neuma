// seal-geometry.js — pure geometry for the ceremony seal's honest gauge.
// SHINKEI: if it looks like a gauge, it gauges — the progress arc sweeps
// exactly the fraction the record holds, never a decorative approximation.

/**
 * Stroke dash geometry for a progress arc on a circle of radius r.
 * Sweep is proportional to done/total; an empty or absent total draws
 * nothing (a gauge with no measurement shows no reading).
 * @param {{done: number, total: number}|null} progress
 * @param {number} r
 * @returns {{dasharray: string, circumference: number}|null}
 */
export const progressArcOf = (progress, r) => {
  if (!progress || !Number.isFinite(r) || r <= 0) return null;
  const { done, total } = progress;
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  const circumference = 2 * Math.PI * r;
  const fraction = Math.min(Math.max(done / total, 0), 1);
  const sweep = circumference * fraction;
  return {
    dasharray: `${sweep.toFixed(2)} ${(circumference - sweep).toFixed(2)}`,
    circumference,
  };
};
