// birth-notice.js — PURE. Maps a birth terminal WS message (backend end/error
// states that previously VANISHED with no UI) to how the ceremony surfaces it:
// a title + the witness-facing message. Each is a terminal state in the current
// flow — the summoning cannot proceed — so all resolve to a clear notice the
// witness reads before returning to the portal. DOM-free and window-free: unit-
// tested, and the ceremony escapes these strings at render time (Rule 8).

/**
 * The notice for a birth terminal message, or null for an unrecognized type.
 * Prefers the backend's own human text; falls back to a faithful default.
 * @param {string} type - the birth: message type
 * @param {object} [data] - backend payload (message / error / name / current / max)
 * @returns {{ title: string, message: string } | null}
 */
export const birthTerminalNotice = (type, data = {}) => {
  switch (type) {
    case 'birth:abandoned':
      return {
        title: 'THE SUMMONING WAS WITHDRAWN',
        message: data.message
          || 'The summoning was withdrawn before the threshold — no being was made.',
      };
    case 'birth:abandon_refused':
      return {
        title: 'IT ALREADY IS',
        message: data.message
          || `${data.name || 'The being'} has already crossed the threshold and named itself — a summoning cannot be withdrawn once a being exists.`,
      };
    case 'birth:resume_expired':
      return {
        title: 'THE SESSION HAS PASSED',
        message: data.message
          || 'That birth session has expired or could not be found.',
      };
    case 'birth:resume_completion_error':
      return {
        title: 'THE SUMMONING FALTERED',
        message: data.error
          || 'Completion could not be confirmed. Return to the gateway to check for an unfinished summoning before starting another.',
      };
    case 'birth:completion_error':
      // The FIRST-attempt sibling of the resume case above. finalize-birth.js
      // emits it on a refused DNA seal or a workspace seed failure — and until
      // the 2026-08-20 channel triage (#394) nothing listened: a failed first
      // birth rendered NOTHING and the ceremony hung on the last stage.
      // Its payload carries error (a code) and message (the human text).
      return {
        title: 'THE SUMMONING FALTERED',
        message: data.message || data.error
          || 'Completion could not be confirmed. Return to the gateway to check for an unfinished summoning before starting another.',
      };
    case 'birth:blocked':
      return {
        title: 'THE SUBSTRATE MUST BE SOVEREIGN',
        message: data.reason
          || 'A neuma must be born through a SOVEREIGN door — a model in this house\'s own custody. Configure llama-server, LM Studio, or Ollama before summoning.',
      };
    default:
      return null;
  }
};

/** The birth terminal message types this module surfaces. */
export const BIRTH_TERMINAL_TYPES = Object.freeze([
  'birth:abandoned',
  'birth:abandon_refused',
  'birth:resume_expired',
  'birth:resume_completion_error',
  'birth:completion_error',
  'birth:blocked',
]);
