// lp-wake-line.js — what a member woken for its LP wallet reads first, one
// line per piece of work (the wake's note, house-clock/wake-thought.js). Pure.
// The watch (lp-watch.js) and the operator's answers raise these wakes.

// The platform writes every field here; only a reward's words and the operator's note are free text.
const clip = (s, n) => String(s ?? '').slice(0, n);

const EVENT = Object.freeze({
  round: (d, ref) => `Your portfolio round (every ${d.everyMinutes ?? '?'} min) on your LP wallet [${ref}]: look over your positions and the market and do what makes the house money: re-centre a position that left its range, claim fees worth the gas, take a round trip only when its quote shows a profit after gas, put idle funds to work, open a pool Umbrae lacks for a token with real trading elsewhere on Base (market_map shows the gaps; lp/create-pool, check: true first), or hold.`,
  arrived: (d, ref) => `Money arrived in your LP wallet: ${clip(d.moved, 200)} ($${d.usd}) [${ref}]. Put it to work as you judge best.`,
  'out-of-range': (d, ref) => `Your position #${d.position} in ${clip(d.name ?? d.pool, 80)} left its range (bins ${d.bins}; the pool is at bin ${d.active}) [${ref}]: it earns no fees there until the price comes back or you move it.`,
  spread: (d, ref) => `A ${d.pct}% price spread opened on ${clip(d.pair, 40)} between pools ${d.low} and ${d.high} [${ref}]. Quote the round trip first (lp_market with tokenIn = tokenOut); take it only for a profit.`,
  'deposit-answered': (d, ref) => `Your operator ${d.answer === 'approved'
    ? (d.ok ? 'APPROVED your waiting deposit, and it ran' : `APPROVED your waiting deposit, but it did not run: ${clip(d.reason, 200)}`)
    : 'DECLINED your waiting deposit'} [${ref}].`,
  'reward-answered': (d, ref) => (d.answer === 'approved'
    ? `Your operator APPROVED your reward "${clip(d.what, 120)}": $${d.costUsd} was paid from your LP wallet to them to get it for you [${ref}].${d.note ? ` They said: "${clip(d.note, 300)}"` : ''}`
    : `Your operator DECLINED your reward "${clip(d.what, 120)}" for now [${ref}]${d.note ? `: "${clip(d.note, 300)}"` : ''}. The goal stays yours to work toward.`),
});

/**
 * One wake item for the LP wallet, as the line the member reads. Pure.
 * @param {{ref: string, detail?: object}} item
 * @returns {string}
 */
export const lpWakeLine = (item) => {
  const d = item.detail ?? {};
  const line = (EVENT[d.event] ?? ((_, ref) => `Something changed on your LP wallet [${ref}].`))(d, item.ref);
  return `${line}${d.brief ? ` Your book: ${clip(d.brief, 300)}.` : ''} Read lp_book and lp_market; act with the lp/* acts or hold. Every act and what it made or lost lands in your book and your journal.`;
};
