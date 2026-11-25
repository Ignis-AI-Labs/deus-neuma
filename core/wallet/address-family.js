// Address family — which chain's address a piece of text is, by shape alone.
// The one place that decides it, for the two sides that must agree: the
// desktop shell (which reads the clipboard) and the backend (which writes the
// ledger). The shell is CommonJS and loads this with import().
//
// Why a FAMILY and not […]: a clipboard hijacker swaps a
// copied address for its own of the same chain, or the payment would fail.
// Requiring the same family is also what keeps anything else a person copied
// — a password, an API key — from ever being read out or written down.
//
// Pure.

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';

// Order matters: the narrow shapes are tried before the wide one (Solana).
const FAMILIES = Object.freeze([
  ['evm', /^0x[0-9a-fA-F]{40}$/],
  ['bitcoin', new RegExp(`^(?:[13]${BASE58}{25,34}|(?:bc1|tb1)[02-9ac-hj-np-z]{11,71})$`)],
  ['litecoin', new RegExp(`^(?:[LM]${BASE58}{26,33}|ltc1[02-9ac-hj-np-z]{11,71})$`)],
  ['tron', new RegExp(`^T${BASE58}{33}$`)],
  ['solana', new RegExp(`^${BASE58}{32,44}$`)],
]);

/**
 * @param {unknown} text
 * @returns {?string} the family, or null when the text is not one address
 */
export const addressFamily = (text) => {
  if (typeof text !== 'string') return null;
  const hit = FAMILIES.find(([, shape]) => shape.test(text));
  return hit ? hit[0] : null;
};

/**
 * Is `found` a DIFFERENT address of the same family as `copied`? An EVM
 * address written in another letter case is the same address.
 */
export const isSwappedAddress = (copied, found) => {
  const family = addressFamily(copied);
  if (!family || addressFamily(found) !== family) return false;
  return family === 'evm' ? copied.toLowerCase() !== found.toLowerCase() : copied !== found;
};
