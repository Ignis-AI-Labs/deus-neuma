// tool-chip-tone.js — which register a tool chip speaks in. Pure.
//
// LINE & CYCLE gives colour a job: `--signal` marks LIVE data, `--alert` is for
// warnings, and the screen is monochrome at rest. The chip used to ask one
// question — `status === 'ok'` — and send everything else to alert. So a render
// in progress reported itself seven times in warning red on its way to
// finishing successfully (Design note, 2026-08-01: […]).
//
// That is not just noisy, it is untrue: an action that is still happening has
// not failed, and colour that cries wolf on every long action is colour the
// operator learns to stop reading — which costs the alert register exactly the
// urgency it exists to carry.
//
// Three registers, then:
//   ok       — it happened. Signal.
//   inflight — it is happening. Signal, dimmed, with the live tick.
//   failed   — it did not happen. Alert.
//
// Unknown statuses fall to `failed`, which is the conservative direction: a
// status nobody classified is better shown as needing attention than as fine.

import { isInflightStatus } from '../../../core/runtime/tool-status.js';

/**
 * Statuses that mean the action SUCCEEDED under a different word. These were
 * reading as failures for the same reason `running` was — the chip only ever
 * recognised the literal string 'ok'.
 */
const SUCCEEDED = Object.freeze(new Set([
  'ok',
  'completed',
  'approved',
  'titled',
  'loaded',
  'released',
]));

/**
 * The register a status speaks in. Pure.
 * @param {string} status the raw backend tool status
 * @returns {'ok'|'inflight'|'failed'}
 */
export const chipTone = (status) => {
  const s = String(status || '');
  if (SUCCEEDED.has(s)) return 'ok';
  if (isInflightStatus(s)) return 'inflight';
  return 'failed';
};

/** True while the action is still happening — the chip earns the live tick. */
export const isInflight = (status) => chipTone(status) === 'inflight';

/**
 * The percent an in-flight summary is reporting, or null. Pure.
 *
 * A long action already says "rendering — 44%" in words; reading that number
 * back out lets the ONE row it occupies fill a bar instead of the operator
 * parsing text (Design note, 2026-08-02: […]). Matching
 * the summary is deliberate: progress arrives as prose on the existing tool
 * event, and inventing a parallel numeric channel for it would be a second
 * source of truth that could disagree with what the row says.
 * @param {string} summary
 * @returns {number|null} 0-100
 */
export const progressFrom = (summary) => {
  const m = /(\d{1,3})\s*%/.exec(String(summary || ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
};
