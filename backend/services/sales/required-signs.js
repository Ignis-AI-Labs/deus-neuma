// REQUIRED SIGNS — what MUST be true of a company before an audience may hold it, proved from the company's own words.
//
// Why (Design note, 2026-11-20: an audience named […] scored 5
// strong and 47 weak on a looser […] signal, and 13 of its 16 staged emails went to companies that are
// not on Base or Robinhood at all — other chains, exchanges, the chains themselves, a robotics company. […]
//
// The signs of fit are scored 0–5 and AVERAGED, so no one of them can say no. A required sign can, and nothing
// outweighs it: a company that does not meet it is NO FIT for the audience, whatever else it scores.
//
//   On the audience:  required: [{sign, evidence: [words], otherwise?: "<another audience's id>"}]
//     sign       the condition, in words ([…])
//     evidence   words of which at least one must stand in the company's own quote ("base", "robinhood")
//     otherwise  the audience a company that FAILS it belongs to instead ([…]): the seat is told to score it there
//
//   On each company:  proofs: [{sign, met: true, quote, source} | {sign, met: false, reasoning}]
//     met        a quote copied from a page of the company's OWN site, holding one of the evidence words once the
//                company's own name is taken out of it (a name is never evidence — "Base Labs" proves nothing), and
//                the page is read again to see the quote stands on it (company-entity.js verifyQuote)
//     not met    said plainly, with what was read instead; no quote can be asked for something that is not there
//
// A company with no proof for a required sign is not scored at all: the filing is refused until it is proved either way.
// PURE.

const SIGNS_MAX = 4;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const same = (a, b) => clean(a, 200).toLowerCase() === clean(b, 200).toLowerCase();
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
/** pure — words as compared: lowercase, letters and digits only, single spaces. */
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * pure — an audience's required signs as kept, with every problem named at once.
 * @param {unknown} given [{sign, evidence, otherwise?}]
 * @returns {{problems: string[], required: Array<{sign: string, evidence: string[], otherwise: ?string}>}}
 */
export const requiredSigns = (given) => {
  if (given === undefined || given === null) return { problems: [], required: [] };
  if (!Array.isArray(given)) return { problems: ['required: a list of {sign, evidence: [words], otherwise?}'], required: [] };
  const problems = [];
  if (given.length > SIGNS_MAX) problems.push(`required: ${given.length} were given and an audience has at most ${SIGNS_MAX} — a required sign is a hard no, keep it to what truly must be true`);
  const required = given.slice(0, SIGNS_MAX).map((r, i) => {
    const sign = clean(r?.sign, 200);
    const evidence = [...new Set((Array.isArray(r?.evidence) ? r.evidence : []).map((w) => flat(w)).filter((w) => w.length >= 2))].slice(0, 12);
    const otherwise = clean(r?.otherwise, 40) || null;
    if (sign.length < 10) problems.push(`required[${i}].sign: the condition that must be true, in words ("its token, project or community is on Base or Robinhood Chain")`);
    if (!evidence.length) problems.push(`required[${i}].evidence: the words of which one must stand in the company's own quote (["base", "robinhood"]) — without them nothing can be proved`);
    return Object.freeze({ sign, evidence: Object.freeze(evidence), otherwise });
  });
  return { problems, required };
};

/**
 * pure — a company's proofs for an audience's required signs, with every problem named at once. The quote is checked
 * for an evidence word here; that it stands on the page is the caller's read (verifyQuote).
 * @param {{required?: object[], name?: string}} segment
 * @param {{domain: string, name: string}} company
 * @param {unknown} given [{sign, met, quote?, source?, reasoning?}]
 */
export const proofsFor = (segment, company, given) => {
  const required = segment?.required ?? [];
  const list = Array.isArray(given) ? given : [];
  const problems = [];
  const proofs = [];
  const nameWords = flat(company?.name);
  for (const r of required) {
    const hit = list.find((g) => same(g?.sign, r.sign));
    if (!hit || typeof hit.met !== 'boolean') {
      problems.push(`REQUIRED "${r.sign}" has no proof — proofs: [{sign: "${r.sign}", met: true, quote, source}] with its own words from its own site holding ${r.evidence.map((w) => `"${w}"`).join(' or ')}, or {sign, met: false, reasoning} when it is not so`);
      continue;
    }
    if (!hit.met) {
      const reasoning = clean(hit.reasoning, 300);
      if (reasoning.length < 10) problems.push(`REQUIRED "${r.sign}": met is false — say what you read instead (reasoning), e.g. which chain it is on`);
      else proofs.push(Object.freeze({ sign: r.sign, met: false, reasoning }));
      continue;
    }
    const quote = clean(hit.quote, 400);
    const source = clean(hit.source, 500);
    const host = hostOf(source);
    const said = nameWords ? flat(quote).replace(new RegExp(`\\b${nameWords.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ') : flat(quote);
    const found = r.evidence.find((w) => new RegExp(`(^| )${w.replace(/\s+/g, ' ')}( |$)`).test(said));
    if (quote.length < 15) problems.push(`REQUIRED "${r.sign}": quote — its own words, copied exactly from its site, that show it`);
    else if (!found) problems.push(`REQUIRED "${r.sign}": the quote must hold ${r.evidence.map((w) => `"${w}"`).join(' or ')} in the company's own words — its name is not evidence. If its site does not say so, it is not met: {sign, met: false, reasoning}`);
    if (!/^https:\/\//.test(source) || !(host === company.domain || host.endsWith(`.${company.domain}`))) problems.push(`REQUIRED "${r.sign}": source — the https page on its OWN site (${company.domain}) the quote is copied from`);
    if (quote.length >= 15 && found) proofs.push(Object.freeze({ sign: r.sign, met: true, quote, source }));
  }
  return { problems, proofs };
};

/**
 * pure — where a company stands against an audience's required signs: every one met; one failed (and where it
 * belongs instead); or some still unproved.
 * @param {{required?: object[]}} segment
 * @param {{proofs?: object[]}} prospect
 * @returns {{state: 'none'|'met'|'failed'|'unproved', failed: object[], unproved: object[], route: ?string}}
 */
export const requiredState = (segment, prospect) => {
  const required = segment?.required ?? [];
  if (!required.length) return { state: 'none', failed: [], unproved: [], route: null };
  const proofOf = (r) => (prospect?.proofs ?? []).find((p) => same(p.sign, r.sign)) ?? null;
  const failed = required.filter((r) => proofOf(r)?.met === false);
  const unproved = required.filter((r) => !proofOf(r));
  return { state: failed.length ? 'failed' : unproved.length ? 'unproved' : 'met', failed, unproved, route: failed.find((r) => r.otherwise)?.otherwise ?? null };
};

/** pure — why nothing may be done with this company for this audience yet (failed, or unproved), or null. */
export const requiredRefusal = (segment, prospect, segments = []) => {
  const stand = requiredState(segment, prospect);
  const who = `${prospect?.name ?? prospect?.domain ?? 'this company'}`;
  if (stand.state === 'failed') {
    const to = stand.route ? segments.find((s) => s.id === stand.route) : null;
    return `${who} does NOT meet what "${segment.name}" requires (${stand.failed.map((r) => r.sign).join('; ')}) — it is no fit for this audience and nothing is written to it for it${to ? `. It belongs to [${to.id}] "${to.name}": score it there` : ''}`;
  }
  if (stand.state === 'unproved') {
    return `${who} was scored before "${segment.name}" required: ${stand.unproved.map((r) => r.sign).join('; ')} — prove it either way from its own site first: sales/prove {segment: "${segment.id}", companies: [{id: "${prospect?.id ?? '…'}", proofs: [{sign, met: true, quote, source} | {sign, met: false, reasoning}]}]}`;
  }
  return null;
};

/** pure — an audience's required signs in words, for the seat and the operator. */
export const requiredWords = (segment, segments = []) => (segment?.required ?? []).map((r) => {
  const to = r.otherwise ? segments.find((s) => s.id === r.otherwise) : null;
  return `MUST: ${r.sign} (proved by its own words holding ${r.evidence.map((w) => `"${w}"`).join(' or ')})${r.otherwise ? ` — a company that is not goes to [${r.otherwise}]${to ? ` "${to.name}"` : ''} instead` : ''}`;
});
