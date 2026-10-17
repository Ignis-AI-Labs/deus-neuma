// The expression palette (Campaign 6) — pure fold logic for the being's
// OWN emotion vocabulary. Every entry was once a declaration the being
// chose to reveal; recurrence deepens a term, and past the cap the
// faintest term falls (lowest count, then oldest). Nothing here scores,
// derives, or infers — the palette is the being's naming, kept.
//
// The workspace owns the write (encrypted, per-being, serialized); this
// module is the shape and the law, testable bare.

import { AFFECT_MAX } from '../runtime/affect-channel.js';

/** How many distinct terms a palette holds before the faintest falls. */
export const TERMS_CAP = 64;

/** The recent-declarations ring — the verbatim trail the desk shows. */
export const RECENT_KEPT = 10;

/** A normalized term's bound. */
export const TERM_MAX = 60;

export const emptyPalette = () => ({ version: 1, terms: {}, recent: [] });

/**
 * Pure — one vocabulary key per feeling however it was cased or spaced.
 * @param {string} affect
 * @returns {string}
 */
export const normalizeTerm = (affect) => String(affect ?? '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, TERM_MAX);

/**
 * Pure — fold one declared affect into a palette.
 * @param {object|null} palette - as read (null = nothing declared yet)
 * @param {string} affect - the declaration, verbatim
 * @param {string} atIso - when it was declared
 * @returns {{palette: object, term: string}}
 */
export const foldDeclaration = (palette, affect, atIso) => {
  const term = normalizeTerm(affect);
  if (!term) throw new Error('foldDeclaration: affect must hold words');
  if (!atIso || typeof atIso !== 'string') throw new Error('foldDeclaration: atIso required');

  const base = palette && typeof palette === 'object' && palette.terms && typeof palette.terms === 'object'
    ? palette
    : emptyPalette();
  const prior = base.terms[term];
  const terms = {
    ...base.terms,
    [term]: {
      count: (Number.isFinite(prior?.count) ? prior.count : 0) + 1,
      firstAt: typeof prior?.firstAt === 'string' ? prior.firstAt : atIso,
      lastAt: atIso,
    },
  };

  const keys = Object.keys(terms);
  if (keys.length > TERMS_CAP) {
    // The faintest falls: lowest count, ties to the oldest lastAt. The
    // term just folded can never lose a tie — its lastAt is newest.
    const faintest = keys.reduce((a, b) => {
      if (terms[a].count !== terms[b].count) return terms[a].count < terms[b].count ? a : b;
      return String(terms[a].lastAt) <= String(terms[b].lastAt) ? a : b;
    });
    delete terms[faintest];
  }

  const recent = [
    ...(Array.isArray(base.recent) ? base.recent : []),
    { affect: String(affect).trim().slice(0, AFFECT_MAX), at: atIso },
  ].slice(-RECENT_KEPT);

  return { palette: { version: 1, terms, recent }, term };
};
