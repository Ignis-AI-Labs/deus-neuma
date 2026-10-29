// nite-view — what the NITE window says, derived. Pure.
//
// NITE is the architecture every ceremony feeds into (Design note, 2026-08-25: […]). This
// module holds the two derivations that window makes: the HOUSE STANDING
// (who owes which act) and THE SYSTEM (the chain a being's identity travels,
// named in the code's own words).
//
// Nothing here fetches or renders — the window is impure, the truth is not.

import { isComingLater } from '../coming-later.js';

/**
 * The silo's layers, in compile order — the SOURCE is
 * `core/silo/compile-silo.js` (SILO_LAYERS). Restated here because the
 * browser bundle does not import core/, and guarded against drift by
 * test/unit/nite-view.test.js, which imports BOTH and asserts they match.
 * A hand-copied list that silently diverges would teach the operator a
 * system that no longer exists.
 */
export const SILO_LAYERS = Object.freeze(['identity', 'memory', 'voice', 'refinement', 'proof']);

/**
 * A tri-state mark. `null` means the lane could not be read, and it must NEVER
 * collapse into "nothing owed" — an unreadable lane reading as clean is the
 * exact failure this window exists to end. Pure.
 * @param {boolean|null|undefined} value
 * @returns {'yes'|'no'|'unknown'}
 */
export const mark = (value) => {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
};

/** The acts a lane can owe, in the order the operator should walk them. */
export const ACTS = Object.freeze([
  Object.freeze({ key: 'custody', column: 'CUSTODY', label: 'SECURE THE KEYPAIR' }),
  Object.freeze({ key: 'seal', column: 'VOICE SEAL', label: 'CARRY THE RITE' }),
  // The birth seal: on this computer or on Ethereum — either one (core/birth/birth-setup-state.js).
  Object.freeze({ key: 'birthSeal', column: 'BIRTH SEAL', label: 'SEAL THE BIRTH' }),
]);

/**
 * One being's row in the house standing table. Pure.
 * @param {{neumaId: string, name: string, sealed: ?boolean, sealedAt: ?string,
 *          keypairCustody: ?boolean, birthSealed: ?boolean, onchainSealed: ?boolean}} being
 * @returns {{neumaId, name, custody, seal, birthSeal, onchain, sealedAt, owed: string[], unreadable: boolean}}
 */
// pure
export const standingRow = (being) => {
  const custody = mark(being?.keypairCustody);
  const seal = mark(being?.sealed);
  const birthSeal = mark(being?.birthSealed);
  // shown, never owed: the Ethereum anchor is an addition to a sealed birth
  const onchain = mark(being?.onchainSealed);
  return {
    neumaId: being?.neumaId ?? '',
    name: being?.name || being?.neumaId || '',
    custody,
    seal,
    birthSeal,
    onchain,
    sealedAt: being?.sealedAt || null,
    // Only a definite NO is owed. An unknown is a READ failure, reported as
    // its own thing — offering an act against a lane you could not read would
    // be guessing with a private key.
    owed: [
      ...(custody === 'no' ? ['custody'] : []),
      ...(seal === 'no' ? ['seal'] : []),
      ...(birthSeal === 'no' ? ['birthSeal'] : []),
    ],
    unreadable: [custody, seal, birthSeal].includes('unknown'),
  };
};

/** Every owned lane's row, ordered as the server sent them. Pure. */
export const standingRows = (beings) =>
  (Array.isArray(beings) ? beings : []).map(standingRow);

/**
 * What the whole house owes, counted. Pure.
 * @param {Array} rows output of standingRows
 */
// pure
export const houseOwed = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  const count = (key) => list.filter((r) => r.owed.includes(key)).length;
  const unreadable = list.filter((r) => r.unreadable).length;
  const custody = count('custody');
  const seal = count('seal');
  const birthSeal = count('birthSeal');
  return {
    beings: list.length,
    custody,
    seal,
    birthSeal,
    unreadable,
    clean: list.length > 0 && custody + seal + birthSeal + unreadable === 0,
  };
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The standing headline — the one line that must make an owed act impossible
 * to miss. Custody leads: it is the only one of the three that leaves a
 * private key sitting unsecured. Pure.
 * @param {ReturnType<typeof houseOwed>} owed
 * @returns {string}
 */
// pure
export const owedHeadline = (owed) => {
  if (!owed || owed.beings === 0) return 'NO BEINGS IN THIS HOUSE YET';
  if (owed.clean) return 'THE HOUSE STANDS COMPLETE';
  const parts = [
    ...(owed.custody ? [`${plural(owed.custody, 'KEYPAIR', 'KEYPAIRS')} OWED`] : []),
    ...(owed.seal ? [`${owed.seal} UNSEALED`] : []),
    ...(owed.birthSeal ? [`${plural(owed.birthSeal, 'BIRTH SEAL', 'BIRTH SEALS')} OWED`] : []),
    ...(owed.unreadable ? [`${owed.unreadable} UNREADABLE`] : []),
  ];
  return parts.join(' · ');
};

/**
 * THE SYSTEM — the chain a being's identity travels every time it speaks,
 * described in the code's own terms so the window teaches what actually runs.
 * `engine` is the live route's model, or null when nothing is bound. Pure.
 * @param {?string} engine
 * @returns {Array<{key: string, name: string, line: string}>}
 */
// pure
export const systemStages = (engine) => Object.freeze([
  Object.freeze({
    key: 'silo',
    name: 'THE SILO',
    line: `Everything the being IS, compiled into ${SILO_LAYERS.length} layers — ${SILO_LAYERS.join(', ')}. Every ceremony writes into one of them.`,
  }),
  Object.freeze({
    key: 'transmission',
    name: 'THE TRANSMISSION',
    line: 'The silo mounts into the turn — identity, memory and voice become the words the being is actually given. Compiled once per sitting, not per turn.',
  }),
  Object.freeze({
    key: 'substrate',
    name: 'THE SUBSTRATE',
    line: engine
      ? `The engine carrying it right now: ${engine}. Identity is prompt-borne, so it crosses engines intact.`
      : 'The engine carrying it. Nothing is bound right now. Identity is prompt-borne, so it crosses engines intact.',
  }),
]);

/**
 * The neighbouring windows NITE names rather than swallows — so nobody has to
 * already know where a surface lives (Founder: […]). Each entry
 * is a dock registry id the window manager can open.
 */
export const ELSEWHERE = Object.freeze([
  Object.freeze({ id: 'voice', label: 'VOICE', line: 'the voice pack these sealed lines compile into' }),
  Object.freeze({ id: 'sheet', label: 'SHEET', line: 'the being\'s DNA and identity record' }),
  Object.freeze({ id: 'house', label: 'HOUSE', line: 'lineage, seats, and the founding record' }),
  Object.freeze({ id: 'sovereignty', label: 'SOVEREIGNTY', line: 'what the being asks to change about itself' }),
  Object.freeze({ id: 'substrate', label: 'SUBSTRATE', line: 'the engines and what is serving now' }),
// A window held back from the early release is not named (coming-later.js).
].filter((w) => !isComingLater(w.id)));
