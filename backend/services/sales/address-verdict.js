// address-verdict — what an address's checks add up to, when more than one database checked it (Design note, 2026-11-19:
// […]). Each checker's latest answer stands
// (Hunter, Tomba, Apollo — address-check.js CHECKERS); together: any that says the address will bounce wins, so a
// disagreement never sends to a dead address; else valid when any confirmed it; else what the first said. Which
// databases confirmed it, and which were asked, travel with it. Pure.

const WILL_BOUNCE = new Set(['invalid', 'disposable']);

/**
 * A LIVE ANSWER OUTRANKS A STORED FLAG (2026-11-19: mika.ohiorhenuan@flowtrackfund.com, handed over by Apollo as
 * "verified" from its own records, then answered "could not confirm" by Apollo's live checker, went out on the stored
 * flag and hard-bounced, 550 5.1.1). A provider's "verified when found" (found: true) counts only while no live check
 * has answered for the address; once one has, the live answers decide alone.
 * @param {Array<{checker: string, status: string, found?: boolean, at?: string}>} checks each answer, oldest first
 * @returns {{status: string, checker: string, confirmedBy: string[], checkedBy: string[], foundBy: string[], live: boolean}}
 *   checkedBy: the databases that answered LIVE; foundBy: those whose stored flag stands; live: a live answer decides
 */
export const verdictOf = (checks) => {
  const live = checks.filter((c) => !c.found);
  const counted = live.length ? live : checks;
  const bounce = counted.find((c) => WILL_BOUNCE.has(c.status));
  const valid = counted.filter((c) => c.status === 'valid');
  const lead = bounce ?? valid[0] ?? counted[0];
  // A database counts once, however many times it answered.
  const names = (list) => [...new Set(list.map((c) => c.checker))];
  return { status: lead.status, checker: lead.checker, confirmedBy: names(valid), checkedBy: names(live), foundBy: names(checks.filter((c) => c.found)), live: live.length > 0 };
};
