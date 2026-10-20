// given-view.js — the GIVEN space's presentation decisions: its four pages,
// the page remembered, the soul's scale as a circle of the octave, the
// genesis hash as the grid of its digits, the seal's road from birth to
// chain. Pure.

export const GIVEN_TABS = Object.freeze([
  { key: 'soul', code: 'A', title: 'SOUL' },
  { key: 'body', code: 'B', title: 'BODY' },
  { key: 'sky', code: 'C', title: 'SKY' },
  { key: 'seal', code: 'D', title: 'SEAL' },
].map(Object.freeze));

export const GIVEN_TAB_KEY = 'sheet:given';
export const SKY_SYSTEM_KEY = 'sheet:sky';

/** The page to open: the one last read, if it still exists, else SOUL. Pure. */
export const givenTabOf = (stored) => (GIVEN_TABS.some((t) => t.key === stored) ? stored : 'soul');

/** The sky to open: the one last read, if this record carries it, else the first it does. Pure. */
export const skySystemOf = (stored, available) => (available.includes(stored) ? stored : available[0] ?? null);

/**
 * The scale as a circle of one octave: the tonic at the top, each note at its
 * exact place in cents (1200 to the octave), clockwise. Pure.
 * @param {Array<{name: string, cents: number}>} notes
 * @returns {Array<{name: string, cents: number, angle: number}>}
 */
export const octavePlaces = (notes) => notes.map((n) => Object.freeze({ ...n, angle: ((((n.cents % 1200) + 1200) % 1200) / 1200) * 360 }));

/** The genesis hash as the grid of its digits — each cell one hex digit, 0–15. Pure. */
export const hashDigits = (hash) => (typeof hash === 'string' && /^[0-9a-f]+$/i.test(hash)
  ? Object.freeze([...hash.toLowerCase()].map((c) => parseInt(c, 16)))
  : Object.freeze([]));

const spanWords = (ms) => {
  const days = Math.floor(ms / 86400000);
  if (days >= 2) return `${days} DAYS`;
  const hours = Math.floor(ms / 3600000);
  if (hours >= 1) return `${hours} ${hours === 1 ? 'HOUR' : 'HOURS'}`;
  const minutes = Math.max(0, Math.round(ms / 60000));
  return `${minutes} ${minutes === 1 ? 'MINUTE' : 'MINUTES'}`;
};

/** The seal's road: its birth instant, and when (and how long after) its anchor reached the chain. Pure. */
export const sealRoadOf = (file) => {
  const born = file?.seal?.birthMoment?.utc ? Date.parse(file.seal.birthMoment.utc) : NaN;
  if (!Number.isFinite(born)) return null;
  const anchored = file?.onchain?.sealedAt ? Date.parse(file.onchain.sealedAt) : NaN;
  return Object.freeze({
    born: file.seal.birthMoment.utc,
    anchored: Number.isFinite(anchored) ? file.onchain.sealedAt : null,
    after: Number.isFinite(anchored) && anchored >= born ? spanWords(anchored - born) : null,
  });
};
