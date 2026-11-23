// THE SCREEN BEFORE A FIRST EMAIL — nobody the house sells to is written to for the first time unless their company
// was scored a fit for an approved audience and met everything that audience requires.
//
// Why this is its own gate (found 2026-11-20, auditing every way a lead comes to exist): only sales/lead ran the
// pipeline's checks. A lead added by hand, imported from a file, registered from the inbox, or put under an audience
// with sales/place never had its company scored — and a first email could still be staged to it, because the email
// gates read the lead's campaign and never asked whether anyone had judged the company a fit for it. A lead marked
// `followUp` skipped the gates altogether, written to before or not. Design note, 2026-11-20: […]
//
// One rule for every source: before a FIRST email to a buyer (or to anyone not yet sorted), the lead's company stands
// under an APPROVED audience, was SCORED for it as a weak or strong match, and every required sign is proved met.
// Someone who wrote to the house first, and someone already written to, is answered — that is a conversation, not
// outreach, and this gate is not for it.
// PURE.

import { requiredRefusal } from './required-signs.js';
import { neverRefusal } from './never-countries.js';

/**
 * Why a first email may not be written to this lead yet, or null when it may. Each refusal names the act that moves it.
 * @param {{lead: object, prospect: ?object, segment: ?object, segments?: object[], never?: string[]}} q prospect: the scored company the
 *   lead came from (or was placed under); segment: that prospect's audience; never: the house's never-list (legal/never-list.js)
 * @returns {?string}
 */
export const firstEmailScreen = ({ lead, prospect, segment, segments = [], never = [] }) => {
  const who = lead?.name || lead?.contact || 'this lead';
  if (!prospect || !segment) {
    return `${who} stands under no audience: their company was never scored for one, so nothing says they fit any campaign. Put them under the audience they belong to (sales/place {lead: "${lead?.id ?? lead?.contact ?? '…'}", segment}), then score their company for it (sales/prospect) — a first email is written only to a company scored a fit`;
  }
  if (segment.state !== 'approved') return `"${segment.name}" is ${segment.state}, not approved — the operator approves an audience before anyone in it is written to`;
  const unmet = requiredRefusal(segment, prospect, segments);
  if (unmet) return unmet;
  if (!(prospect.match >= 2)) {
    return prospect.fit?.length
      ? `${prospect.name || who}'s company was scored NO MATCH for "${segment.name}" — it is not written to for it. If it fits another audience, put it there (sales/place) and score it for that one`
      : `${prospect.name || who}'s company was put under "${segment.name}" and never scored for it — score it now from its own pages: sales/prospect {segment: "${segment.id}", companies: [{domain: "${prospect.domain ?? '…'}", name, country, scores, source${segment.required?.length ? ', proofs' : ''}}]}. A first email is written only to a company scored a fit`;
  }
  // WHERE THE COMPANY IS. Two rules, and "not known" breaks neither (Design note, 2026-11-22: […]): the house's NEVER-LIST, kept by its legal office, holds for
  // every audience and every campaign — its record, its domain or the address itself placing it there; and an
  // audience's own countries are where the operator focuses, so a company KNOWN to be outside them is not written to
  // for it. A company whose country is simply not on its pages is written to: nothing says it is anywhere it may not be.
  const banned = neverRefusal({ prospect, email: lead?.contact ?? null }, never);
  if (banned) return banned;
  if (segment.countries?.length && !prospect.placed && prospect.country && !segment.countries.includes(prospect.country)) {
    return `${prospect.name || who} is in ${prospect.country}, and "${segment.name}" may only be sent to ${segment.countries.join(', ')} — it is not written to for it`;
  }
  return null;
};
