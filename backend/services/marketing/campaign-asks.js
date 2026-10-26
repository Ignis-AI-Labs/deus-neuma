// campaign-asks — the campaign record as the shared page between the
// operator and the CMO (campaign plan §3.2): asks run BOTH ways, and every
// change leaves a line in the campaign's change log saying who changed what.
//
// Pure: a record in, the next record (or a refusal in words) out. The store
// applies them under its lock.

export const ASK_SIDES = Object.freeze(['operator', 'cmo']);
export const LOG_MAX = 200;
const ASKS_KEPT_DONE = 50;
const ASK_TEXT_MAX = 2000;

/** The change log with one more line, oldest dropped past the cap. Pure. */
export const withLogLine = (log, { at, by, what }) =>
  [...(Array.isArray(log) ? log : []), { at, by: String(by || ''), what: String(what) }].slice(-LOG_MAX);

// Open asks are never dropped; settled ones keep the newest ASKS_KEPT_DONE.
const trimAsks = (asks) => {
  const done = asks.filter((a) => a.state === 'done');
  const drop = new Set(done.slice(0, Math.max(0, done.length - ASKS_KEPT_DONE)).map((a) => a.id));
  return asks.filter((a) => !drop.has(a.id));
};

/**
 * Open an ask on a campaign. `from` is the side asking; the other side owes
 * the answer. Pure.
 * @param {object} campaign
 * @param {{id: string, from: 'operator'|'cmo', text: string, by: string, at: string}} ask
 * @returns {{campaign?: object, error?: string}}
 */
export const openAsk = (campaign, { id, from, text, by, at }) => {
  if (!ASK_SIDES.includes(from)) return { error: `an ask comes from ${ASK_SIDES.join(' or ')}` };
  const words = typeof text === 'string' ? text.trim() : '';
  if (!words) return { error: 'an ask needs its words' };
  if (words.length > ASK_TEXT_MAX) return { error: `an ask is at most ${ASK_TEXT_MAX} chars` };
  const ask = { id, from, by: String(by || ''), text: words, state: 'open', at };
  return {
    campaign: {
      ...campaign,
      asks: trimAsks([...(campaign.asks || []), ask]),
      log: withLogLine(campaign.log, { at, by, what: `${from === 'operator' ? 'the operator' : 'the CMO'} asked: ${words.slice(0, 120)}` }),
    },
  };
};

/**
 * Settle an ask — answered, or set aside — by the side it was asked OF (or
 * withdrawn by the side that asked). Pure.
 * @param {object} campaign
 * @param {string} askId - the full id or its first 6+ characters
 * @param {{side: 'operator'|'cmo', by: string, answer?: string, at: string}} settle
 */
export const settleAsk = (campaign, askId, { side, by, answer, at }) => {
  const given = String(askId || '').trim();
  const matches = (campaign.asks || []).filter((a) => a.id === given || (given.length >= 6 && a.id.startsWith(given)));
  if (matches.length !== 1) return { error: matches.length ? 'that id matches several asks — use more of it' : 'no such ask on this campaign' };
  const ask = matches[0];
  if (ask.state === 'done') return { error: 'that ask is already settled' };
  if (!ASK_SIDES.includes(side)) return { error: `an ask is settled by ${ASK_SIDES.join(' or ')}` };
  const words = typeof answer === 'string' ? answer.trim().slice(0, ASK_TEXT_MAX) : '';
  const settled = { ...ask, state: 'done', doneAt: at, doneBy: String(by || ''), ...(words ? { answer: words } : {}) };
  const how = side === ask.from ? 'withdrew their ask' : 'answered the ask';
  return {
    campaign: {
      ...campaign,
      asks: trimAsks((campaign.asks || []).map((a) => (a.id === ask.id ? settled : a))),
      log: withLogLine(campaign.log, { at, by, what: `${side === 'operator' ? 'the operator' : 'the CMO'} ${how}: ${ask.text.slice(0, 80)}` }),
    },
  };
};

/** The asks still open that one side owes. Pure. */
export const asksOwedBy = (campaign, side) => (campaign?.asks || []).filter((a) => a.state === 'open' && a.from !== side);
