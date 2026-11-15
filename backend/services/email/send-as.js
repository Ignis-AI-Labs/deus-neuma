// SEND AS — one mailbox, several addresses (Design note, 2026-11-15: […]).
// A mail account can send as other addresses it owns (in Google: an alias
// domain or an address alias, added under […]); everything still
// arrives in the one inbox. The account's `sendAs` field lists them, each
// optionally for one company of the house:
//     umbrae = sales@umbrae.io, deus-neuma = hello@deusneuma.ai, press@ignislabs.ai
// An email for a company's lead leaves from that company's address by itself.
// The mail server decides whether the account may really use an address; an
// address not listed here is never tried.
// PURE.

const ADDRESS = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const clean = (v) => String(v ?? '').trim().toLowerCase();

/**
 * The account's other addresses. Anything unreadable is dropped.
 * @param {unknown} text - the sendAs field
 * @returns {Array<{address: string, company: ?string}>}
 */
export const parseSendAs = (text) => {
  const seen = new Set();
  return String(text ?? '').split(/[,\n;]+/).map((part) => {
    const [left, right] = part.split('=').map(clean);
    const address = right === undefined ? left : right;
    return ADDRESS.test(address) ? { address, company: right === undefined ? null : (left || null) } : null;
  }).filter((a) => a && !seen.has(a.address) && seen.add(a.address));
};

/**
 * The address one email leaves from: the one asked for when the account holds
 * it, else the company's own, else the account's.
 * @param {{address: string, sendAs?: string}} credentials
 * @param {{from?: ?string, company?: ?string}} [want]
 * @returns {{ok: true, from: string} | {ok: false, detail: string}}
 */
export const fromFor = (credentials, { from = null, company = null } = {}) => {
  const account = clean(credentials?.address);
  const others = parseSendAs(credentials?.sendAs);
  const asked = clean(from);
  if (asked) {
    return asked === account || others.some((a) => a.address === asked) ? { ok: true, from: asked }
      : { ok: false, detail: `${asked} is not an address this mailbox sends as — it sends as ${[account, ...others.map((a) => a.address)].join(', ')}` };
  }
  return { ok: true, from: others.find((a) => company && a.company === clean(company))?.address ?? account };
};
