/**
 * marketing/company-links — the seated CMO proposes a company's site, more of
 * its public pages, or code repos to list (ruling, 2026-10-24: […]).
 *
 * The filing never writes the company. It records ONE proposal for the
 * operator (marketing/link-changes.js): a card in WAITING ON YOU showing the
 * change before → after, APPROVE / DECLINE, and only APPROVE — the operator's
 * own signed session — writes it, through the company block's own door. That
 * card is the decision, so the filing itself carries no chat card (one
 * decision, never two), and no mandate ever answers it: the mandate covers
 * posts, replies and renders, and this filing has no road to the company.
 *
 * Offered to, and re-verified for, the house's seated CMO; the company must be
 * one of the filer's OWN house (the connection's wallet). Listing a repo lends
 * no one its reading — that stays the operator's press.
 */
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { linkChangeRefusals } from '../marketing/link-change-shape.js';
import { proposalRefusal } from '../marketing/link-changes.js';
import { addLinkChange } from '../marketing/link-change-store.js';
import { realOrNull, repoWallRefusal } from '../marketing/company-sources.js';

const laneOf = (connection) => connection?.companion?.neumaId || null;
const invalid = (reasons) => ({ ok: false, status: 'invalid', reason: reasons.map((r) => `- ${r}`).join('\n') });

// impure — a repo folder behind one of the platform's walls is no repo to list.
const wallReasons = (repos = []) => repos.filter((r) => r.path)
  .map((r) => [r.path, repoWallRefusal(realOrNull(r.path) || r.path)])
  .filter(([, why]) => why).map(([p, why]) => `${p}: ${why}`);

const countOf = (change) => [
  ...(change.site ? ['the site'] : []),
  ...(change.links?.length ? [`${change.links.length} page(s)`] : []),
  ...(change.repos?.length ? [`${change.repos.length} repo(s)`] : []),
].join(', ');

export const marketingCompanyLinksIntent = Object.freeze({
  name: 'marketing/company-links',
  policyTool: 'marketing.company-links',
  fieldsForPrompt: '{company, site?, links?: [url], repos?: [{remote?, path?, role?}]}',
  descriptionForPrompt: 'Propose a company\'s links for your operator to approve: site (its web address), links (more of its public pages, added), repos (its code repositories to list, added). Web addresses are https and public. Nothing changes until your operator approves it in WAITING ON YOU; a newer proposal for the same company replaces the waiting one. Listing a repo does not let you read it — that is your operator\'s separate yes.',
  // Offered to the house's seated CMO alone.
  availableFor: async ({ laneId, connection }) => (laneId && await cmoDesignation.holds(connection?.walletAddress, laneId) ? {} : null),
  validate: async (payload, { connection } = {}) => {
    const wallet = connection?.walletAddress;
    if (!wallet || !(await cmoDesignation.holds(wallet, laneOf(connection)))) {
      return { ok: false, status: 'denied', reason: 'only the house\'s seated CMO proposes a company\'s links — ask your operator who holds the office' };
    }
    const shape = linkChangeRefusals(payload);
    if (!shape.ok) return invalid(shape.reasons);
    const walls = wallReasons(shape.change.repos);
    if (walls.length) return invalid(walls);
    const refused = await proposalRefusal(wallet, shape.companyId, shape.change);
    return refused ? invalid([refused]) : { ok: true, value: { companyId: shape.companyId, change: shape.change } };
  },
  summarize: (payload) => `propose links for ${String(payload?.company ?? '?').slice(0, 40)}`,
  execute: async ({ companyId, change }, { connection } = {}) => {
    const filed = await addLinkChange(connection?.walletAddress, { laneId: laneOf(connection), companyId, change });
    if (!filed.ok) return { ok: false, reason: filed.error };
    return {
      ok: true,
      detail: `Proposed ${countOf(change)} for ${companyId} — it waits on your operator in WAITING ON YOU; nothing changes until they approve.${filed.superseded ? ' It replaces your earlier proposal for this company.' : ''}`,
    };
  },
});
