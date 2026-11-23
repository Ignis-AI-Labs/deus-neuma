// Clipboard check — did the address the desk just copied survive on the
// clipboard? A clipboard hijacker watches for a copied wallet address and
// swaps in its own; the paste then pays the thief.
//
// The desk asks with the address it copied. The answer never hands the
// clipboard to the page: it says "same", or — only when a DIFFERENT address
// of the same chain now sits in its place — that address. Anything else a
// person may have copied in the meantime stays unread by the page.
//
// The handler in ipc-handlers.cjs passes the clipboard text in. The address
// law is the platform's one module (plain ESM), loaded once on first use.

let family = null;
const loadFamily = () => {
  family = family || import('../core/wallet/address-family.js');
  return family;
};

/**
 * @param {unknown} expected the address the desk copied
 * @param {unknown} current the clipboard's text now
 * @returns {Promise<{same: boolean, found: ?string}>}
 */
const clipboardVerdict = async (expected, current) => {
  const { isSwappedAddress } = await loadFamily();
  const now = typeof current === 'string' ? current.trim() : '';
  return isSwappedAddress(expected, now) ? { same: false, found: now } : { same: true, found: null };
};

module.exports = { clipboardVerdict };
