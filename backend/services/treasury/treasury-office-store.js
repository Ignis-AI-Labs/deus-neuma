// treasury-office-store — what the Quaestor's office writes, per HOUSE:
// its REVIEWS of pending spends (a recommendation the operator reads on the
// spend card) and its FLAGS (an anomaly it raised: a pattern of requests, a
// changed recipient, a falling balance). `<realm>/<wallet>/offices/treasury/`
// — a house reads only its own; two houses are never confused.
//
// Neither record moves money or changes a policy: a review is advice beside
// the operator's decision, a flag is a word to the operator and the security
// watch. Both are append-only; the latest review of a spend is the one shown,
// and a flag the operator has read is marked seen, never deleted.
//
// impure — whole-file JSON under the house's office dir, one write chain per file.
import crypto from 'crypto';
import { officeFile } from '../house-office.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { createWriteChain } from '../write-chain.js';

export const RECOMMENDATIONS = Object.freeze(['approve', 'deny']);
export const FLAG_KINDS = Object.freeze(['pattern', 'recipient', 'balance', 'other']);
const TEXT_MAX = 1000;
const TITLE_MAX = 200;

const chains = new Map();
const chainFor = (file) => {
  if (!chains.has(file)) chains.set(file, createWriteChain());
  return chains.get(file);
};

// impure — the list a file holds; a corrupt file throws (never read as empty).
const readList = async (file, key) => {
  const doc = await readJson(file);
  if (doc === ABSENT || doc === null) return [];
  if (!Array.isArray(doc?.[key])) throw new Error(`treasury office: ${key} store is not a list`);
  return doc[key];
};

const append = (file, key, row) => chainFor(file)(async () => {
  await writePrivate(file, { [key]: [...await readList(file, key), row] });
  return row;
});

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The house's reviews, oldest first. impure. */
export const readReviews = (wallet) => readList(officeFile(wallet, 'treasury', 'reviews.json'), 'reviews');

/**
 * Pure — the latest review of each spend, keyed `<neumaId>:<spendId>`.
 * @param {ReadonlyArray<object>} reviews
 * @returns {Map<string, object>}
 */
export const latestReviews = (reviews) => new Map(reviews.map((r) => [`${r.neumaId}:${r.spendId}`, r]));

/**
 * impure — record the office's review of one pending spend.
 * @param {string} wallet - the house
 * @param {{neumaId: string, spendId: string, recommend: string, reasons: string, by: string}} review
 */
export const addReview = (wallet, { neumaId, spendId, recommend, reasons, by }) => {
  if (!RECOMMENDATIONS.includes(recommend)) return Promise.reject(new Error(`recommend is ${RECOMMENDATIONS.join(' | ')}`));
  return append(officeFile(wallet, 'treasury', 'reviews.json'), 'reviews', Object.freeze({
    neumaId, spendId, recommend, reasons: clip(reasons, TEXT_MAX), by, at: new Date().toISOString(),
  }));
};

/** The house's flags, oldest first. impure. */
export const readFlags = (wallet) => readList(officeFile(wallet, 'treasury', 'flags.json'), 'flags');

/**
 * impure — raise one flag. Returns the row written.
 * @param {string} wallet
 * @param {{kind: string, title: string, detail?: string, neumaId?: ?string, by: string}} flag
 */
export const addFlag = (wallet, { kind, title, detail = '', neumaId = null, by }) => {
  if (!FLAG_KINDS.includes(kind)) return Promise.reject(new Error(`kind is ${FLAG_KINDS.join(' | ')}`));
  if (!clip(title, TITLE_MAX)) return Promise.reject(new Error('a flag needs a title'));
  return append(officeFile(wallet, 'treasury', 'flags.json'), 'flags', Object.freeze({
    id: `tf_${crypto.randomBytes(6).toString('hex')}`,
    kind, title: clip(title, TITLE_MAX), detail: clip(detail, TEXT_MAX), neumaId, by,
    at: new Date().toISOString(), status: 'open',
  }));
};

/**
 * impure — the operator has read a flag: it waits no longer. Throws when the
 * house holds no such flag.
 * @param {string} wallet
 * @param {string} id
 */
export const markFlagSeen = (wallet, id) => {
  const file = officeFile(wallet, 'treasury', 'flags.json');
  return chainFor(file)(async () => {
    const flags = await readList(file, 'flags');
    if (!flags.some((f) => f.id === id)) throw new Error('no such treasury flag in this house');
    const next = flags.map((f) => (f.id === id && f.status === 'open' ? { ...f, status: 'seen', seenAt: new Date().toISOString() } : f));
    await writePrivate(file, { flags: next });
    return next.find((f) => f.id === id);
  });
};
