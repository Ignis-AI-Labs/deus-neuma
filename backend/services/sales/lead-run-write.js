// lead-run-write — the run's last two steps: 6 RESEARCH and 7 EMAIL, for a lead the moment it is filed, and for every
// lead of the audience that was filed earlier and still waits (lead-run-write-shape.js says why, and holds the words).
//
// One question to the house's model, from the company's own page; the answer is filed through the seat's OWN acts:
// sales/research (the card, kept for good, and whether they fit the campaign) and sales/draft-email (the formula's
// parts — every gate and every check a first email passes when the seat writes it). A refusal is handed back to the
// model with its reason, twice at most; what still does not stand is left for the seat, said by name.
// NOTHING IS SENT: an email this writes waits in the operator's outbox like any other.
// impure (the model, the network, the house's records).

import { readCompanySite } from './company-reader.js';
import { readCampaigns, readProspects, readAddressChecks, readSalesFacts } from './sales-store.js';
import { readResearch } from './research-store.js';
import { readOutbox } from './email-outbox.js';
import { researchFresh, checkFormula } from './email-formula.js';
import { isFundingCampaign } from './company-entity.js';
import { factsFor } from './sales-facts.js';
import { normalizeEmail } from './suppress-shape.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { listCompanies } from '../marketing/companies.js';
import { pageWords } from './lead-run-shape.js';
import { writeMessages, readWriting, cardName, personOfLead, strayFigures, allowedFigures, mendMessages, readMended, apartMessages, partMessages, partOf } from './lead-run-write-shape.js';

// How many answers one email may take. Measured on the sales bench (2026-11-22): about half of first answers are
// refused by one check or another, each for a different reason, so with four answers one lead in ten ended with no
// email and WHICH one changed from run to run. An answer costs seconds; a lead left unwritten costs the lead.
export const WRITE_TRIES = 7;
const OTHERS_SHOWN = 12;
// A refused answer asked again the same way comes back the same: each further answer is given more room to differ.
const TEMPERATURES = Object.freeze([0, 0.4, 0.7, 0.9, 0.6, 0.8, 1]);
const LIVE = ['waiting', 'returned', 'sent', 'uncertain'];
const titled = (id) => String(id ?? '').split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * The run's writer for one audience, or null with why when it cannot write for it (no campaign, no locked plan).
 * @param {{wallet, run, segment, connection, act: (name: string) => ?object, file: Function, ask: Function, fetchPage: Function, say: Function, signal: AbortSignal}} deps
 * @returns {Promise<{ok: true, write: Function, waiting: Function} | {ok: false, why: string}>}
 */
export const makeWriter = async ({ wallet, run, segment, connection, act, file, ask, fetchPage, say, signal }) => {
  if (!act('sales/research') || !act('sales/draft-email')) return { ok: false, why: 'the run was not handed the seat\'s research and email acts' };
  const campaign = (await readCampaigns(wallet)).find((c) => c.id === segment.campaign) ?? null;
  if (!campaign) return { ok: false, why: `"${segment.name}" serves no campaign` };
  const plan = campaign.emailPlan?.approved ?? null;
  if (!plan) return { ok: false, why: `the email plan of "${campaign.name}" is not locked in` };
  const by = connection.companion.neumaId;
  const funding = isFundingCampaign(campaign);
  const ours = (await listCompanies(wallet).catch(() => [])).find((c) => c.id === campaign.company)?.name?.trim() || titled(campaign.company) || 'our company';
  const facts = factsFor((await readSalesFacts(wallet).catch(() => null))?.approved ?? null, segment.company ?? null)?.facts ?? [];
  const count = (key) => { run.counts[key] = (run.counts[key] ?? 0) + 1; };

  /**
   * Research one lead and stage its first email.
   * @param {{prospect: object, email: string, person: {name: string, role: string}, page?: ?{text: string, url: string}}} lead
   */
  const write = async ({ prospect, email, person, page = null }) => {
    if (signal.aborted) return;
    const began = Date.now();
    const address = normalizeEmail(email);
    const research = await readResearch(wallet);
    const known = research.cards.get(address) ?? null;
    const stands = known && researchFresh(known) ? known : null;
    const fitted = research.fits.get(`${address}|${campaign.id}`) ?? null;
    if (fitted?.verdict === 'no') return;
    if ((await readOutbox(wallet)).drafts.some((d) => LIVE.includes(d.state) && d.to.some((a) => normalizeEmail(a) === address))) return;
    let text = page?.text ?? '';
    let url = page?.url ?? `https://${prospect.domain}/`;
    if (text.length < 80) {
      const pages = [];
      await readCompanySite(prospect.domain, { signal, fetchPage: async (target, o) => { const got = await fetchPage(target, o); if (got?.ok) pages.push(got); return got; } }).catch(() => null);
      text = pages.map((p) => pageWords(p.html)).join('\n\n');
      if (pages.length && /^https:/.test(pages[0].url)) url = pages[0].url;
    }
    if (text.length < 80) { count('unwritten'); say(`${prospect.name}: its page could not be read again — the research and email for <${address}> are the sales member's`); return; }
    const name = cardName(person, prospect.name);
    // What the campaign's other emails already opened and offered with: the formula refuses a twin of one.
    const others = (await readOutbox(wallet)).drafts.filter((d) => d.formula?.campaignId === campaign.id && LIVE.includes(d.state)).slice(-OTHERS_SHOWN).map((d) => ({ hook: d.formula.hook, offer: d.formula.offer }));
    let card = stands;
    let fit = fitted;
    let refusal = null;
    for (let attempt = 1; attempt <= WRITE_TRIES && !signal.aborted; attempt += 1) {
      const raw = await ask(by, writeMessages({ campaign, plan, ours, facts, funding, person: { name, role: person.role }, email: address, company: prospect, text, url, card, refusal, others }), signal, { temperature: TEMPERATURES[attempt - 1] ?? 0.9, seed: attempt }).catch((err) => { refusal = `the model did not answer (${err.message})`; return null; });
      if (signal.aborted) return;
      const got = raw ? readWriting(raw) : null;
      if (!got) { refusal ??= 'the answer was not the one JSON object asked for'; continue; }
      // 6 RESEARCH: the card (unless a fresh one stands: the seat's own is never overwritten) and the fit.
      if (!card || !fit) {
        const put = await file(act('sales/research'), { email: address, ...(card ? {} : { name, role: person.role || 'general address', company: prospect.name, ...got.card, sources: [url] }), fit: got.fit }, connection, signal);
        if (!put.ok) { refusal = `the research was refused: ${put.reason}`; continue; }
        if (!card) count('researched');
        card = (await readResearch(wallet)).cards.get(address) ?? card;
        fit = got.fit;
      }
      if (fit.verdict === 'no') { count('notMatch'); say(`NOT A MATCH ${prospect.name} <${address}> — ${fit.why.slice(0, 160)}: researched, no email`); return; }
      // A number the facts do not state never reaches the checks: it goes straight back, named.
      // First the part itself is mended (one narrow question a part); only what still holds one goes back whole.
      for (const part of ['hook', 'why', 'offer']) {
        if (!strayFigures({ [part]: got.email[part] }, facts).length || signal.aborted) continue;
        const mended = readMended(await ask(by, mendMessages(got.email[part]), signal, { temperature: 0, seed: attempt }).catch(() => ''));
        if (mended && !strayFigures({ [part]: mended }, facts).length) { got.email[part] = mended; count('mended'); }
      }
      const stray = strayFigures(got.email, facts);
      if (stray.length) { refusal = `your email holds ${stray.join(', ')}, and no approved fact states ${stray.length === 1 ? 'it' : 'them'}. The only numbers an email may hold are: ${allowedFigures(facts).join(', ') || 'none at all'}. Say the same thing about them WITHOUT the number ("your portfolio", not "your ${stray[0]} companies"), and change nothing else.`; continue; }
      // The formula's own checks, run here first: what they refuse goes straight back, without staging anything.
      const formed = () => checkFormula(got.email, { card, plan, company: ours, others: others.map((o) => ({ ...o, to: ['another lead'] })) });
      // First a fault the formula names by its part: that part alone is rewritten, one narrow question a fault, three at most.
      for (let fixes = 0; fixes < 3 && !signal.aborted; fixes += 1) {
        const fault = formed().find((p) => partOf(p));
        if (!fault) break;
        const part = partOf(fault);
        const fixed = readMended(await ask(by, partMessages({ part, value: got.email[part], wrong: fault, card, facts, ask: plan.asks[got.email.askIndex]?.ask ?? null }), signal, { temperature: 0.2 * fixes, seed: attempt + fixes }).catch(() => '')).replace(/^(subject|hook|why|offer|ask):\s*/i, '');
        if (!fixed || strayFigures({ [part]: fixed }, facts).length) break;
        got.email[part] = fixed; count('mended');
      }
      // Then what is said twice, once nothing else is wrong: the later line is rewritten apart from the others, one narrow question a line.
      for (const part of ['offer', 'why']) {
        const now = formed();
        if (!now.length || !now.every((p) => /stated twice|make the same point/.test(p)) || signal.aborted) break;
        const apart = readMended(await ask(by, apartMessages(got.email[part], ['hook', 'why', 'offer'].filter((k) => k !== part).map((k) => got.email[k])), signal, { temperature: 0, seed: attempt }).catch(() => ''));
        if (apart && !strayFigures({ [part]: apart }, facts).length && !apart.includes('?')) { got.email[part] = apart; count('mended'); }
      }
      const unformed = formed();
      if (unformed.length) { refusal = `it does not follow the formula yet: ${unformed.join('; ')}${unformed.some((p) => /opens or offers the same way/.test(p)) ? ` Your hook was "${got.email.hook}" and your offer was "${got.email.offer}": neither may be used again. Begin the offer with what THEY do or need, and build a different sentence.` : ''}`; continue; }
      // 7 EMAIL: the formula's parts, through every gate and check.
      const staged = await file(act('sales/draft-email'), { to: address, ...got.email }, connection, signal);
      if (staged.ok) { count('written'); say(`EMAIL ${prospect.name} — ${name} <${address}>: researched and staged for your review in ${Math.round((Date.now() - began) / 1000)} s${attempt > 1 ? ` (answer ${attempt})` : ''}`); return; }
      // A twin of another email: the sentences that collided are handed back, so the next answer builds new ones.
      refusal = `the email was refused: ${staged.reason}${/opens or offers the same way/.test(staged.reason) ? ` Your hook was "${got.email.hook}" and your offer was "${got.email.offer}": neither may be used again. Begin the offer with what THEY do or need, and build a different sentence.` : ''}`;
      // What no rewording answers (the address, the audience, the list): left at once.
      if (!/formula|facts check|first email to a lead:|claims/i.test(staged.reason)) break;
    }
    count('unwritten');
    say(`${prospect.name} <${address}>: ${card ? 'researched; ' : ''}its email is the sales member's to write — ${String(refusal ?? 'stopped').slice(0, 200)}`);
  };

  /** Every lead of the audience filed before now that still waits for its research or its first email. */
  const waiting = async () => {
    const [prospects, leads, checks, research, outbox] = await Promise.all([readProspects(wallet), leadLedgerFor(wallet).then((l) => l.load()), readAddressChecks(wallet), readResearch(wallet), readOutbox(wallet)]);
    const byId = new Map(leads.map((l) => [l.id, l]));
    const valid = new Set(checks.filter((c) => c.status === 'valid').map((c) => c.email));
    const drafted = new Set(outbox.drafts.filter((d) => LIVE.includes(d.state)).flatMap((d) => d.to.map(normalizeEmail)));
    return prospects.filter((p) => p.segmentId === segment.id && p.stage === 'promoted' && byId.get(p.leadId)?.status === 'cold').map((prospect) => {
      const lead = byId.get(prospect.leadId);
      return { prospect, email: normalizeEmail(lead.contact), person: personOfLead(lead) };
    }).filter((w) => w.email && valid.has(w.email) && !drafted.has(w.email) && research.fits.get(`${w.email}|${campaign.id}`)?.verdict !== 'no');
  };
  return { ok: true, write, waiting };
};
