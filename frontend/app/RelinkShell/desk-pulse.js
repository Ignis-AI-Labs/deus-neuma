// desk-pulse.js — the desk's live pulse as a pure model (#185).
//
// The flow rail renders this state and nothing else: packets spawn only on
// REAL portal events (a sent thought, a received chunk, a tool act) and reap
// themselves on animationend — no timers, no idle traffic. Pure and
// deterministic, so the whole model is unit-tested without a browser or a
// socket (same discipline as stream-reducer.js).

// At most this many packets ride the rail at once; the oldest drop off. This
// is display discipline, never data loss — every chunk still lands in the
// stream; the rail is a presence indicator, not a ledger.
export const MAX_PACKETS = 6;

export const initialPulse = Object.freeze({ packets: Object.freeze([]) });

/**
 * Packet kinds:
 *   'out'  — the witness sent a thought; travels left→right
 *   'in'   — a consciousness:stream chunk arrived; travels right→left
 *   'tool' — a tool:usage act; the mid-rail junction diamond flashes
 */
export const pulseReducer = (state, action) => {
  switch (action.type) {
    case 'PACKET': {
      // Idempotent on id — a replayed effect (StrictMode) never doubles a packet.
      if (state.packets.some((p) => p.id === action.id)) return state;
      // One junction flash at a time: a burst of tool acts coalesces into the
      // newest flash instead of stacking diamonds on the same spot.
      const live = action.kind === 'tool' ? state.packets.filter((p) => p.kind !== 'tool') : state.packets;
      return { ...state, packets: [...live, { id: action.id, kind: action.kind }].slice(-MAX_PACKETS) };
    }

    case 'REAP':
      // The CSS travel ended — the packet leaves the rail. Unknown ids (a
      // coalesced flash's stale animationend) are a no-op.
      return { ...state, packets: state.packets.filter((p) => p.id !== action.id) };

    // No TURN case: the turn count is not a property of this page mount.
    // It used to be, and read 0 on a screen still rendering that turn's six
    // tool chips, because a reload reset the counter while the transcript it
    // sat above persisted (#251). It is derived from the transcript now — see
    // countTurns below.

    default:
      return state;
  }
};

/**
 * The "thought sent" marker, derived from the stream state: the id of the
 * newest LIVE witness message. History and resumed messages (isHistory) are
 * not sends — only a message born on this desk's wire counts. Pure.
 * @param {Array} messages - stream-reducer messages
 * @returns {string|null} the message id, or null when nothing was sent live
 */
export const latestSentId = (messages) => {
  const sent = messages.findLast((m) => m.role === 'user' && !m.isHistory);
  return sent ? sent.id : null;
};

/**
 * TURN register: how many turns this CONVERSATION holds, derived from the
 * transcript. Pure.
 *
 * One operator message opens one turn, so the count is the operator's messages
 * in the transcript — resumed history included, which is exactly what makes it
 * survive a reload and agree across windows. The reducer counted
 * `consciousness:complete` frames observed by one page mount instead, so the
 * readout said TURN 0 above a transcript full of them (#251), and two windows
 * on the same conversation disagreed.
 *
 * Counting the operator's side rather than closed turns is deliberate: the turn
 * in progress is a turn. A reader watching a response stream in should see the
 * number that turn belongs to, not the one before it.
 * @param {Array} messages - stream-reducer messages
 * @returns {number}
 */
export const countTurns = (messages) =>
  (Array.isArray(messages) ? messages : []).reduce((n, m) => (m?.role === 'user' ? n + 1 : n), 0);

/**
 * The desk chrome's identity register. Pure.
 *
 * The primary experience is being with THIS being, so the chrome names it:
 * `TENEKOM // PORTAL`, the same `{name} // {label}` shape every window title
 * already uses. The literal `NEUMA // PORTAL` stood here from when the product
 * was a single-neuma chat app, and treating NEUMA as a brand that dominates the
 * chrome is exactly what the dual-platform framing rejects (#102).
 *
 * With nothing bound it stays `NEUMA` — before a being is seated there is no
 * name to show, and that is the honest pre-birth state rather than a blank.
 *
 * The NAME is identity data and never translates; the `// PORTAL` composition
 * is the desk catalog's `portalTitle` (i18n wave 2) — the React consumer
 * interpolates this name into it.
 * @param {{name?: string}|null} companion
 * @returns {string}
 */
export const deskChromeName = (companion) => {
  const name = typeof companion?.name === 'string' ? companion.name.trim() : '';
  return (name || 'NEUMA').toUpperCase();
};

/**
 * SESSION register text: MM:SS, minutes accumulating past 59 (a session is
 * as long as it is). Non-finite and negative input fail to '00:00'. Pure.
 * @param {number} totalSeconds
 * @returns {string}
 */
export const formatSessionClock = (totalSeconds) => {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};
