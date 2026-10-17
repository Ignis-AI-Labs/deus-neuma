/**
 * THE TURN-TIMING PROBE — where does the operator's wait go?
 *
 * The drift probe (prefix-drift-probe.js) shows what the server re-read; it
 * cannot show how long the platform itself took before the request left, nor
 * how long the server took to the first word — the provider measured that
 * every round (provider-stream-telemetry.js) and the turn dropped it. So each
 * model call of a turn lands one line: how long after the ask it was sent,
 * the server's time to first output and prefill, and the cached prompt
 * tokens. Round 0's `sinceAskMs` is the platform's own preparation; a later
 * round's gap is the tool work between calls. Counts only — no prompt text,
 * no names, no message content, ever. Lines land in
 * `<data>/logs/turn-timing.jsonl`, capped by rotation. Never blocks, never
 * throws into the turn.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from './data-root.js';

const FILE_MAX_BYTES = 1024 * 1024;
const asks = new WeakMap(); // ws -> { at, round }

const finite = (value) => (Number.isFinite(value) ? Math.round(value) : null);

/**
 * Impure — the operator's ask starts a turn on this socket now.
 * @param {Object} ws the connection's socket (any object key; absent = no probe)
 */
export const markTurnAsked = (ws) => {
  if (ws && typeof ws === 'object') asks.set(ws, { at: performance.now(), round: 0 });
};

/**
 * Pure — one call's line from its send time and the provider's telemetry.
 * @param {{at: number, round: number}} ask
 * @param {number} sentAt performance.now() when the call left
 * @param {Object|null} telemetry buildProviderStreamTelemetry's shape
 * @returns {Object}
 */
export const timingLine = (ask, sentAt, telemetry) => ({
  round: ask.round,
  sinceAskMs: finite(sentAt - ask.at),
  ttftMs: finite(telemetry?.providerTtftMilliseconds),
  prefillMs: finite(telemetry?.providerPrefillDurationMilliseconds),
  cachedTokens: finite(telemetry?.cachedPromptTokens),
});

// impure — append one line, rotating the file past its cap.
const append = async (line) => {
  const file = path.join(getDataRoot(), 'logs', 'turn-timing.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const size = await fs.stat(file).then((s) => s.size).catch(() => 0);
  if (size > FILE_MAX_BYTES) await fs.rename(file, `${file}.prev`).catch(() => {});
  await fs.appendFile(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
};

/**
 * Impure — wrap a call's telemetry observer so the call is timed. Created
 * when the call is about to leave; a socket with no marked ask passes
 * straight through.
 * @param {Object} ws
 * @param {Function|undefined} onTelemetry the turn's own observer
 * @returns {Function}
 */
export const timedCall = (ws, onTelemetry) => {
  const sentAt = performance.now();
  return (telemetry) => {
    const ask = ws && typeof ws === 'object' ? asks.get(ws) : null;
    if (ask) {
      append({ at: new Date().toISOString(), ...timingLine(ask, sentAt, telemetry) }).catch(() => {});
      ask.round += 1;
    }
    onTelemetry?.(telemetry);
  };
};
