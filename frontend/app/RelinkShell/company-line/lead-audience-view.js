// lead-audience-view.js — how one audience reads as marks. Pure.

/** The pool as count tiles: every number that was a sentence before. */
export const poolTiles = (pool, counts) => [
  { label: 'COMPANIES', n: pool.length },
  { label: 'STRONG', n: counts.strong, loud: counts.strong > 0 },
  { label: 'WEAK', n: counts.weak },
  { label: 'NO MATCH', n: counts.none },
  { label: 'ON THE LEAD LIST', n: counts.onLedger, loud: counts.onLedger > 0 },
];

/** A written list ([…]) as its parts, each a chip; one thing stays one chip. */
export const chipsOf = (text) => String(text ?? '').split(/\s*[,;]\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((s) => s.trim()).filter(Boolean);

/** The same counts in one line, for an audience folded under its campaign. */
export const poolWords = (pool, counts) => `${pool.length} COMPAN${pool.length === 1 ? 'Y' : 'IES'} TO JUDGE · ${counts.strong} STRONG · ${counts.weak} WEAK · ${counts.none} NO MATCH · ${counts.onLedger} ON THE LEAD LIST`;

/** Does this audience wait on the operator? A draft waits for approval; an approved one with companies waits for its list. */
export const audienceWaits = (row) => row.segment.state === 'draft' || row.listable > 0;
