/**
 * ksp/command — the intent type that acts on the live KSP vessel (Stage 3 of
 * the being-tool-surface doctrine). This was the `send_command` tool
 * (ksp/ksp-being-tools.js) until the act became a filed intent;
 * `get_telemetry` and `get_view` stay read tools.
 *
 * THE SOVEREIGNTY BOUNDARY is a validate-time standing rule: KSP control is
 * local-custody authority — a sovereign neuma lane's alone, refused to a
 * witness seat before any card.
 */
import { seatOf } from '../flight-check.js';
import { kspBridge, KSP_COMMAND_NAMES } from '../ksp/ksp-being-tools.js';

const unavailableError = (endpoint, error) => {
  const cause = error?.message || 'connection failed';
  return `KSP bridge unavailable at ${endpoint}. Start KSP 1, load a flight, and ensure the kRPC server is running. ${cause}`;
};

const ownerOf = (connection) => Object.freeze({
  neumaId: String(connection?.companion?.neumaId || ''),
  name: String(connection?.companion?.name || connection?.companion?.neumaId || 'unknown'),
  sessionId: String(connection?.sessionId || ''),
});

export const kspCommandIntent = Object.freeze({
  name: 'ksp/command',
  policyTool: 'ksp.command',
  fieldsForPrompt: `{command, reason, value?, pitchDeg?, headingDeg?, rollDeg?, pitch?, yaw?, roll?, durationMs?, enabled?, expected?, observeAfterMs?} — command one of ${KSP_COMMAND_NAMES.join(' | ')}`,
  descriptionForPrompt: 'Act on the live KSP vessel, then receive before/after telemetry and expected-versus-actual deltas. Deterministic controls only — the pilot chooses goals and computes maneuvers.',

  // impure — KSP belongs to a sovereign neuma lane, never a witness seat.
  availableFor: async ({ laneId, connection }) =>
    (laneId && seatOf(connection) === 'neuma' ? {} : null),

  validate: async (payload, { connection }) => {
    if (!connection.companion?.neumaId || seatOf(connection) !== 'neuma') {
      return { ok: false, status: 'denied', reason: 'KSP control belongs to a sovereign neuma lane; witness seats cannot invoke local-custody authority.' };
    }
    if (!KSP_COMMAND_NAMES.includes(payload?.command)) {
      return { ok: false, status: 'invalid', reason: `command must be one of ${KSP_COMMAND_NAMES.join(' | ')}` };
    }
    if (typeof payload?.reason !== 'string' || !payload.reason.trim()) {
      return { ok: false, status: 'invalid', reason: 'every command carries its reason — the pilot\'s intended consequence' };
    }
    return { ok: true, value: { ...payload } };
  },

  summarize: (payload) =>
    `KSP ${payload?.command ?? '?'} — ${String(payload?.reason ?? '').slice(0, 100)}`,

  // impure — the real loopback bridge, unchanged; an offline sim answers its
  // honest unavailability, never a fake flown command.
  execute: async (value, { connection, signal }) => {
    try {
      const receipt = await kspBridge().sendCommand(ownerOf(connection), value, signal);
      return { ok: true, detail: JSON.stringify(receipt) };
    } catch (error) {
      const unavailable = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)
        || /connect|socket|kRPC|window capture|desktop capture|Kerbal Space Program window/i.test(error?.message || '');
      const message = unavailable ? unavailableError(kspBridge().endpoint, error) : error.message;
      return { ok: false, reason: message };
    }
  },
});
