/**
 * sales/prove — a company already in the pool proved, either way, against what its audience REQUIRES
 * (sales/required-signs.js; Design note, 2026-11-20: 13 of 16 staged emails of an audience named […] went
 * to companies that are not on either — […]).
 *
 * A company scored before its audience gained a required sign has no proof for it, and nothing may be done with it
 * until it has one. MET: its own words, from its own site, holding one of the sign's evidence words; the page is read
 * again and the quote must stand on it. NOT MET: said plainly — and then the company leaves the audience by itself:
 * it is dropped from the pool (or, already a lead, closed with the reason and kept as a contact), every email waiting
 * for it is withdrawn, and the seat is told which audience it belongs to instead.
 *
 * THE OFFICE LAW holds as for every sales act: only the seated Mercator files. Tier `allowed`: records in the house's
 * own office; the one outward step is reading the company's own page (the guarded reader every sales read uses).
 */
import { officeContext } from './revenue-acts.js';
import { readSegments, readProspects, proveProspect, settleProspect } from '../sales/sales-store.js';
import { proofsFor, requiredState } from '../sales/required-signs.js';
import { verifyQuote } from '../sales/company-entity.js';
import { readOutbox, withdrawDrafts } from '../sales/email-outbox.js';
import { normalizeEmail } from '../sales/suppress-shape.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';

const BATCH_MAX = 25;
const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

/**
 * impure — a company that does not meet what its audience requires leaves it: out of the pool, its lead closed with
 * why (kept as a contact), its waiting emails withdrawn. Shared by sales/prove and sales/prospect.
 * @returns {Promise<{dropped: boolean, closed: boolean, withdrawn: string[]}>}
 */
export const leaveAudience = async (wallet, prospect, why, by) => {
  const dropped = prospect.stage === 'found' ? (await settleProspect(wallet, prospect.id, { type: 'dropped', reason: why, by })).ok : false;
  let closed = false;
  let withdrawn = [];
  if (prospect.leadId) {
    const ledger = await leadLedgerFor(wallet);
    const lead = (await ledger.load()).find((l) => l.id === prospect.leadId);
    if (lead && !['won', 'lost'].includes(lead.status)) closed = (await ledger.touch(lead.id, { status: 'lost', note: why, by })).ok;
    const address = normalizeEmail(lead?.contact);
    if (address) {
      const at = (a) => normalizeEmail(a) === address;
      const waiting = (await readOutbox(wallet)).drafts.filter((d) => d.state === 'waiting' && d.to.some(at));
      if (waiting.length) withdrawn = (await withdrawDrafts(wallet, { to: at, why, by })).ids ?? [];
    }
  }
  return { dropped, closed, withdrawn };
};

const salesProveIntent = Object.freeze({
  name: 'sales/prove',
  policyTool: 'sales.prove',
  fieldsForPrompt: '{segment, companies: [{id, proofs: [{sign, met: true, quote, source} | {sign, met: false, reasoning}]}]}',
  descriptionForPrompt: `THE LEAD ENGINE. Prove a company ALREADY in the pool against what its audience REQUIRES (your briefing lists each audience's MUST lines, and the companies still unproved) — up to ${BATCH_MAX} at a time, id is the prospect's [p-…]. For each required sign say whether it is MET, from the company's OWN site, never from its name or from what you assume: met true with quote (its own words, copied exactly) and source (the https page on its own domain) — the quote must hold one of the sign's evidence words and is checked against the page; met false with reasoning (what you read instead, e.g. the chain it is actually on). A company that does not meet a required sign leaves the audience by itself: dropped, or its lead closed and kept as a contact, its waiting emails withdrawn — and you are told the audience it belongs to instead, to score it there. Nothing is written to a company for an audience until every required sign is proved met.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const segments = await readSegments(context.wallet);
    const segment = segments.find((s) => s.id === String(payload?.segment ?? '').trim());
    if (!segment) return invalid(`"${payload?.segment ?? ''}" is not a segment of this house — your LEAD ENGINE briefing names each by its [id]`);
    if (!segment.required?.length) return invalid(`"${segment.name}" requires nothing of a company beyond its scored signs — there is nothing to prove. To make a sign a hard condition, file the audience again with required: [{sign, evidence, otherwise?}] (your operator approves it)`);
    const companies = Array.isArray(payload?.companies) ? payload.companies : [];
    if (!companies.length || companies.length > BATCH_MAX) return invalid(`companies: 1 to ${BATCH_MAX} per filing`);
    const pool = await readProspects(context.wallet);
    const problems = [];
    const proved = [];
    for (const [i, c] of companies.entries()) {
      const prospect = pool.find((p) => p.id === String(c?.id ?? '').trim() && p.segmentId === segment.id);
      if (!prospect) { problems.push(`companies[${i}]: "${c?.id ?? ''}" is not a prospect of "${segment.name}"`); continue; }
      const made = proofsFor(segment, { domain: prospect.domain, name: prospect.name }, c?.proofs);
      if (made.problems.length) { problems.push(`companies[${i}] (${prospect.name}): ${made.problems.join('; ')}`); continue; }
      // The quote must stand on the page: read again here, exactly as an investor's is.
      const unread = [];
      for (const proof of made.proofs.filter((p) => p.met)) {
        const checked = await verifyQuote(proof);
        if (!checked.ok) unread.push(`"${proof.sign}": ${checked.why}`);
      }
      if (unread.length) { problems.push(`companies[${i}] (${prospect.name}): ${unread.join('; ')}`); continue; }
      proved.push({ prospect, proofs: made.proofs });
    }
    if (problems.length) return invalid(problems.join(' | '));
    return { ok: true, value: { context, segment, segments, proved } };
  },
  summarize: (payload) => `prove ${Array.isArray(payload?.companies) ? payload.companies.length : 0} compan${Array.isArray(payload?.companies) && payload.companies.length === 1 ? 'y' : 'ies'} against what ${payload?.segment ?? '?'} requires`,
  execute: async ({ context, segment, segments, proved }) => {
    const lines = [];
    for (const { prospect, proofs } of proved) {
      await proveProspect(context.wallet, prospect.id, proofs, context.laneId);
      const stand = requiredState(segment, { proofs });
      if (stand.state !== 'failed') { lines.push(`[${prospect.id}] ${prospect.name}: MEETS what "${segment.name}" requires.`); continue; }
      const why = `does not meet what "${segment.name}" requires (${stand.failed.map((r) => r.sign).join('; ')}): ${proofs.find((p) => !p.met)?.reasoning ?? ''}`.slice(0, 300);
      const left = await leaveAudience(context.wallet, prospect, why, context.laneId);
      const to = stand.route ? segments.find((s) => s.id === stand.route) : null;
      lines.push(`[${prospect.id}] ${prospect.name}: DOES NOT — no fit for "${segment.name}"${left.dropped ? '; dropped from its pool' : ''}${left.closed ? '; its lead is closed and kept as a contact' : ''}${left.withdrawn.length ? `; ${left.withdrawn.length} waiting email${left.withdrawn.length === 1 ? '' : 's'} withdrawn [${left.withdrawn.join(', ')}]` : ''}${to ? `. It belongs to [${to.id}] "${to.name}": score it there with sales/prospect` : ''}.`);
    }
    return { ok: true, detail: lines.join(' ') };
  },
});

export const salesProveIntents = Object.freeze([salesProveIntent]);
