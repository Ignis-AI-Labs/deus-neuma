/**
 * THE SELECTION LAW (HARNESS-POE phase 2, #533) — which scored candidate
 * becomes the answer. Pure: candidates in, decision out; no IO anywhere.
 *
 * Two selectors, chosen by the evidence the candidates carry:
 * - `logprob` — every candidate rode the scoring pass with a finite summed
 *   log-likelihood: argmax wins (the PoE ranking, arXiv:2505.07859).
 * - `majority` — likelihoods absent (a route that cannot serve them):
 *   most-common normalized answer wins, first-seen tie-break (Wang et al.,
 *   arXiv:2112.00114, the self-consistency vote).
 *
 * Candidates are DEDUPED by normalized-answer hash before anything ranks:
 * K samples agreeing on one answer are ONE answer with K votes, and the
 * deduped entry keeps the strongest evidence (best logprob when scored).
 */
import { createHash } from 'crypto';

/** The comparison space for answers: case and whitespace out. Pure. */
export const normalizeAnswerText = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Stable short fingerprint of an answer's normalized text. Pure. */
export const answerHash = (text) => createHash('sha256').update(normalizeAnswerText(text)).digest('hex').slice(0, 16);

const isFiniteScore = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Select the winning candidate.
 * @param {Array<{text: string, totalLogprob?: number|null, tokens?: number}>} candidates
 * @returns {{winner: Object|null, selector: 'logprob'|'majority'|'none', ranked: Array}}
 *   ranked carries {hash, occurrences, totalLogprob, tokens, chars, selected}.
 */
export const selectCandidate = (candidates) => {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && typeof c.text === 'string') : [];
  if (list.length === 0) return { winner: null, selector: 'none', ranked: [] };

  const hashes = list.map((c) => answerHash(c.text));
  const allScored = list.every((c) => isFiniteScore(c.totalLogprob));
  const dedup = [];
  const byHash = new Map();
  list.forEach((c, i) => {
    const held = byHash.get(hashes[i]);
    if (held === undefined) {
      const entry = {
        text: c.text, hash: hashes[i], position: i,
        occurrences: hashes.filter((h) => h === hashes[i]).length,
        totalLogprob: isFiniteScore(c.totalLogprob) ? c.totalLogprob : null,
        tokens: c.tokens ?? null,
      };
      byHash.set(hashes[i], entry);
      dedup.push(entry);
      return;
    }
    // Same answer twice: the entry keeps the strongest evidence, never the loudest.
    if (allScored && isFiniteScore(c.totalLogprob) && c.totalLogprob > held.totalLogprob) {
      held.totalLogprob = c.totalLogprob;
    }
  });

  const ranked = allScored
    ? dedup.slice().sort((a, b) => b.totalLogprob - a.totalLogprob || a.position - b.position)
    : dedup.slice().sort((a, b) => b.occurrences - a.occurrences || a.position - b.position);
  ranked[0].selected = true;
  return {
    winner: ranked[0],
    selector: allScored ? 'logprob' : 'majority',
    ranked: ranked.map((r) => ({ ...r, chars: r.text.length })),
  };
};
