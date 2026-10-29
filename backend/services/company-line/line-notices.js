// THE LINE SPEAKS — after a move lands, whoever is up next hears it: a being
// by house post on the house ground (the post wakes it, inside the charter,
// house-clock.js), the operator by a notification when the move is theirs to
// make, or when the company stands. Nobody else is told: the record and the
// desk carry the rest, so a SILENT operator is never flooded (the dial).
// A notice that cannot land is logged, never thrown — the move already
// stands on the record, and the next turn's briefing shows it all the same.
// impure (house post append, notification bus).

import { loadHouseWorkspace } from '../house-workspace.js';
import { makePost, appendPost } from '../house-post.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { createLogger } from '../logger.js';
import { whoIsUp } from './line-acts.js';

const log = createLogger('Company.Notices');

// pure — what the one who is up next is told, given the move that just landed.
const noticeText = (company, event, line, up) => {
  const tag = `${company.name} [${company.id}]`;
  const verb = up.kind === 'inspector'
    ? `Your inspection (as ${up.as}): answer with company/inspect {company: "${company.id}", stage: "${line.stage.id}", verdict, flaw?}.`
    : line.stage?.sheet
      ? `Yours to master: ${line.stage.handsOn}. Hand it on with company/hand-on {company: "${company.id}", stage: "${line.stage.id}", worksheet, note?} — worksheet: ${line.stage.sheet}. A source is an https link, a repos/ path on the house ground, or "interview: who, when".`
      : `Yours to master: ${line.stage?.handsOn}. Hand it on with company/hand-on {company: "${company.id}", stage: "${line.stage?.id}", artifact, note?}.`;
  if (up.kind === 'standing') return `${tag} stands: its founding line is complete.`;
  if (event.type === 'opened') return `${tag} is open (${company.mode === 'field' ? 'in the operator\'s own field' : 'house-led'}). ${verb}`;
  if (event.type === 'handed') return `${tag} — ${line.stage.name} handed on: ${event.artifact}${event.note ? ` — "${event.note}"` : ''}. ${verb}`;
  if (event.verdict === 'return') return `${tag} — ${line.stage.name} came back: "${event.flaw}". Mend it. ${verb}`;
  if (event.verdict === 'stop') return `${tag} — the gap ended at ${event.stage.toUpperCase()}: "${event.flaw}". Round ${line.round} opens at ${line.stage.name}, with the next candidate. ${verb}`;
  return `${tag} — ${line.stage.name} moves on. ${verb}`;
};

/**
 * Tell whoever is up after this move. impure.
 * @param {{wallet: string, company: object, event: object, line: object, holders: Record<string, string>}} args
 */
export const announceMove = async ({ wallet, company, event, line, holders }) => {
  const up = whoIsUp(line, holders);
  const body = noticeText(company, event, line, up);
  if (up.holder === 'operator' || up.kind === 'standing') {
    try {
      await notifyOperator({
        wallet,
        kind: KIND.companyLine,
        // The line itself reports what is owed — system standing, with the
        // being who moved it named when one did (notification-record.js law).
        standing: STANDING.system,
        title: up.kind === 'standing' ? `${company.name} stands` : `${company.name}: ${line.stage.name} waits on you`,
        detail: body,
        actor: event.by === 'operator' ? null : { id: event.by, name: event.by },
        ref: { companyId: company.id, stage: line.stage?.id ?? null },
      });
    } catch (err) {
      log.warn('A line notice to the operator did not land — the record stands', { company: company.id, err: err.message });
    }
    return;
  }
  if (up.kind === 'unheld' || !up.holder || up.holder === event.by) return;
  try {
    const { root } = await loadHouseWorkspace(wallet);
    if (!root) return;
    await appendPost(root, makePost({ from: event.by, to: up.holder, body, re: `${company.name} — ${line.stage.name}`, now: event.at }));
  } catch (err) {
    log.warn('A line notice by house post did not land — the record stands', { company: company.id, to: up.holder, err: err.message });
  }
};

/**
 * Tell the operator a being asked for their hands. HANDS is the floor: it
 * reaches them at every dial stop. impure.
 * @param {{wallet: string, company: object, item: object}} args
 */
export const announceHands = async ({ wallet, company, item }) => {
  try {
    await notifyOperator({
      wallet,
      kind: KIND.companyLine,
      standing: STANDING.system,
      title: `${company.name} needs your hands: ${item.what}`,
      detail: `${item.why}${item.by ? ` — by ${item.by}` : ''}`,
      actor: { id: item.raisedBy, name: item.raisedBy },
      ref: { companyId: company.id, handsId: item.id },
    });
  } catch (err) {
    log.warn('A HANDS notice did not land — the item stands in WAITING ON YOU', { company: company.id, err: err.message });
  }
};
