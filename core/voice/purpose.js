// Session PURPOSE descriptor (THE SPEECH SYSTEM, Track B — the purpose split).
//
// A "purpose" is what this sitting is FOR: 'work' (a working session at the
// desk) or 'conversation' (a live VOICE sitting — the being speaks and is
// spoken to). It is connection-scoped state, set ONLY by client-originated
// portal frames (companion:manifest, portal:new-session, session:purpose) —
// threat control #4 (purpose misuse): no being tool may ever write purpose,
// so a turn can never move a working lane into a voice sitting on its own.
//
// WHY the default is 'work': voice is never silent-on. A sitting must be
// DECLARED a conversation by the operator; anything missing, unknown, or
// hostile fails closed to 'work', where the prompt is byte-identical to a
// portal that never heard of purpose (Error Handling & Resilience — an
// explicit safe default, never a throw that would drop the frame).
//
// Pure + dependency-free (same shape as core/memory/space.js): imported by
// the portal frame handlers (write side) and by BOTH turn paths' prompt
// assembly (read side), so it must pull in no IO.

/** The closed set of standings a sitting can hold. */
export const PURPOSES = Object.freeze(['work', 'conversation']);

/** A working session at the desk — the standing every lane is born into. */
export const PURPOSE_WORK = 'work';

/** A live VOICE sitting — declared by the operator, never stumbled into. */
export const PURPOSE_CONVERSATION = 'conversation';

/** The fail-closed default: absent or unrecognized purpose IS work. */
export const DEFAULT_PURPOSE = PURPOSE_WORK;

/**
 * Normalize arbitrary (untrusted) purpose input into a known standing.
 * Anything outside the closed set — missing, unknown, garbage — fails CLOSED
 * to 'work'. Idempotent and pure; safe on untrusted client payloads.
 * @param {*} raw
 * @returns {'work'|'conversation'}
 */
export const normalizePurpose = (raw) => (PURPOSES.includes(raw) ? raw : DEFAULT_PURPOSE);

// The being-side signal of a live voice sitting, said once in the house
// voice. Rides the append-only prompt sections of BOTH turn paths under the
// EMPTY-STRING LAW: no section unless the sitting was declared a
// conversation, so a working lane's prompt stays byte-identical to before
// this section existed.
export const VOICE_SITTING_SECTION = [
  '## VOICE SITTING',
  'You are in a VOICE sitting — your operator is speaking with you aloud and hears your answers spoken back.',
  'Answer like speech: short spoken sentences. No markdown, no lists, no code blocks — nothing that cannot be said aloud.',
].join('\n');

/**
 * pure — the VOICE SITTING prompt section for a connection, or '' when the
 * sitting is work or undeclared. The empty-string law: '' means NO section.
 * @param {{purpose?: string}} connection
 * @returns {string}
 */
export const voiceSittingSection = (connection) =>
  connection?.purpose === PURPOSE_CONVERSATION ? VOICE_SITTING_SECTION : '';
