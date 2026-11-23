// pipeline-review-read — the house's records, read once, for a pipeline review (pipeline-review.js grades them).
// Reads only: a review writes nothing, asks no model and spends nothing. impure (the house's files).
import { readSegments, readCampaigns, readCandidates, readProspects, readAddressChecks, readSalesFacts } from './sales-store.js';
import { readResearch } from './research-store.js';
import { readOutbox } from './email-outbox.js';
import { readRunHistory } from './lead-run-record.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { listCompanies } from '../marketing/companies.js';
import { reviewBatch } from './pipeline-review.js';
import { readNeverList } from '../legal/never-list.js';

/** Everything a review grades from. */
export const readForReview = async (wallet) => {
  const [segments, campaigns, candidates, prospects, checks, facts, research, outbox, runs, leads, companies] = await Promise.all([
    readSegments(wallet), readCampaigns(wallet), readCandidates(wallet), readProspects(wallet), readAddressChecks(wallet), readSalesFacts(wallet),
    readResearch(wallet), readOutbox(wallet), readRunHistory(wallet).catch(() => []), leadLedgerFor(wallet).then((l) => l.load()), listCompanies(wallet).catch(() => []),
  ]);
  return { segments, campaigns, candidates, prospects, checks, facts, research, drafts: outbox.drafts, runs, leads, never: (await readNeverList(wallet)).codes, companyNames: new Map(companies.map((c) => [c.id, c.name?.trim() || c.id])) };
};

/**
 * The review of one audience's newest leads (or one run's), or of every approved audience when none is named.
 * @param {string} wallet
 * @param {{segmentId?: ?string, run?: ?string, size?: number}} ask
 * @returns {Promise<object[]>} one review an audience, the named one alone when it is named
 */
export const readPipelineReview = async (wallet, { segmentId = null, run = null, size } = {}) => {
  const read = await readForReview(wallet);
  const which = segmentId ? read.segments.filter((s) => s.id === segmentId) : read.segments.filter((s) => s.state === 'approved');
  return which.map((s) => reviewBatch(read, { segmentId: s.id, run, size })).filter(Boolean);
};
