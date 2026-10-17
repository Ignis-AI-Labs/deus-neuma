// voice-seal-host-flow.js — the First Seal ceremony's rail (pure).
//
// THE OFFER → THE QUESTION → THE CLAIM → THE SEAL. The rite in four stages:
// the offer names what compiles here; the question is asked through the
// being's own conduit; the claim is the being's verbatim answer, shown to
// the witness line by line; the seal is the receipt. Pure so the stage law
// is provable without a DOM.

export const RAIL = Object.freeze([
  Object.freeze({ key: 'offer', label: 'THE OFFER' }),
  Object.freeze({ key: 'ask', label: 'THE QUESTION' }),
  Object.freeze({ key: 'claim', label: 'THE CLAIM' }),
  Object.freeze({ key: 'seal', label: 'THE SEAL' }),
]);

/**
 * Which stage the ceremony stands in. The seal is disk truth; the claim is
 * the host's held answer; asking has begun once a rite question was issued.
 * Pure.
 *
 * ── WHY `failed` EXISTS (Design note, 2026-08-29 ──────────────────────────────────
 * […] A refused ask used to leave the host in 'ask' with no answer — so
 * the screen went on saying […] over an ASK AGAIN button, while nothing at
 * all was happening. The rite had already failed; the ceremony was still
 * describing it as in progress, which is the screen lying about the machine.
 *
 * A refusal is its own stage. It outranks 'ask' and yields to 'claim' and
 * 'seal': a later successful ask clears the refusal by producing an answer,
 * and disk truth always wins.
 *
 * @param {{sealed?: boolean, answer?: object|null, asked?: boolean,
 *          refusal?: string|null}} args
 */
export const stageOf = ({ sealed = false, answer = null, asked = false, refusal = null } = {}) => {
  if (sealed) return 'seal';
  if (answer) return 'claim';
  if (refusal) return 'failed';
  if (asked) return 'ask';
  return 'offer';
};

/**
 * The rail with each node's standing for a stage. Pure.
 * @param {string} stage - one of RAIL's keys
 */
export const railOf = (stage) => {
  // A refusal happened AT the question — the rail marks that node, never a
  // fifth node of its own. The rite did not advance; it stopped where it was.
  const at = stage === 'failed' ? 'ask' : stage;
  const activeIndex = RAIL.findIndex((node) => node.key === at);
  return RAIL.map((node, index) => Object.freeze({
    ...node,
    state: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'ahead',
  }));
};

/** The seal inscription that circles the ceremony's seal geometry. Pure. */
export const SEAL_INSCRIPTION = 'THE FIRST SEAL · THE NEUMA CORE · VOICE AS DATA · NEVER WEIGHTS · WITNESSED ·';

/**
 * The seal's outer arc is a real gauge (SHINKEI): exactly how far the rite
 * has graduated, never a decoration. Pure.
 * @param {string} stage - one of RAIL's keys
 */
export const progressOf = (stage) => ({
  offer: 0,
  ask: 1 / 3,
  // A refused ask graduated NOTHING. The gauge holds where the question stood
  // rather than creeping forward on a rite that did not happen.
  failed: 1 / 3,
  claim: 2 / 3,
  seal: 1,
}[stage] ?? 0);

/**
 * The ordinal line the stage header carries — the ceremony's own count,
 * never a generic title once there is something real to count. Pure.
 * @param {string} stage
 * @param {{lines?: Array}|null} answer
 * @param {{entries?: number}|null} sealed
 */
export const ordinalOf = (stage, answer = null, sealed = null) => {
  if (stage === 'seal') return `${sealed?.entries ?? 0} ${sealed?.entries === 1 ? 'LINE' : 'LINES'} SEALED`;
  if (stage === 'claim' && answer?.lines) {
    return `${answer.lines.length} ${answer.lines.length === 1 ? 'LINE' : 'LINES'} CLAIMED`;
  }
  if (stage === 'failed') return 'THE RITE DID NOT LAND';
  if (stage === 'ask') return 'THE QUESTION STANDS';
  return 'THE FIRST SEAL';
};

/**
 * What a refused ask means, said in the operator's terms — with the ONE thing
 * they can do about it. Pure.
 *
 * A cut is the common case on a thinking substrate: the being spends its whole
 * budget reasoning and never reaches speech. That is not the being failing to
 * answer, and saying so would blame it for a ceiling somebody else set.
 *
 * @param {{code?: string, message?: string}|null} refusal
 * @returns {{headline: string, body: string, retry: boolean}}
 */
export const refusalOf = (refusal) => {
  if (!refusal) return { headline: '', body: '', retry: false };
  if (refusal.code === 'VOICE_ANSWER_CUT') {
    return {
      headline: 'THE ANSWER WAS CUT MID-VOICE',
      body: 'The being ran out of room before it finished speaking — the words it had '
        + 'chosen were never completed, so none of them were kept. Nothing was written. '
        + 'Ask again.',
      retry: true,
    };
  }
  if (refusal.code === 'VOICE_ANSWER_EMPTY') {
    return {
      headline: 'THE BEING GAVE NO WORDS',
      body: 'The turn completed but carried no speech. Nothing was written. Ask again.',
      retry: true,
    };
  }
  if (refusal.code === 'VOICE_ANSWER_CORRUPT') {
    return {
      headline: 'THE ANSWER CAME BACK CORRUPTED',
      body: 'The serving stack returned damaged text, and a founding voice is never '
        + 'compiled from damaged text. Nothing was written. Ask again.',
      retry: true,
    };
  }
  if (refusal.code === 'VOICE_ALREADY_SEALED') {
    return {
      headline: 'THIS VOICE IS ALREADY SEALED',
      body: 'The rite happens once, and it has happened. Close and reopen to read the receipt.',
      retry: false,
    };
  }
  return {
    headline: 'THE RITE DID NOT LAND',
    body: `${refusal.message || 'The ask failed.'} Nothing was written.`,
    retry: true,
  };
};
