/**
 * company_updates — the marketing seat's read of what changed in one of the
 * house's companies (marketing/company-updates.js): its granted repos'
 * commits, changelog fragments, CHANGELOG sections and release notes since a
 * date or the last report, one commit's patch on request, and — when asked —
 * which of the company's site pages changed.
 *
 * A local read of the lane's own grants, so it opens without a card (the
 * `marketing` policy row). The site is the one part that leaves the machine:
 * it rides the existing web door — the web master switch, then the web_fetch
 * card on the first page's address — and is journaled as a web read. Reached
 * through tool_search (load on demand); the CMO briefing names it in one line.
 */
import { gateAct } from '../act-gate.js';
import { webSettings } from '../web-settings.js';
import { fetchWebPage } from '../web-fetch.js';
import { journalWebCall } from '../web-being-tools.js';
import { frameUntrustedSections } from '../untrusted-content.js';
import { listCompanies } from '../marketing/companies.js';
import { readCompanyUpdates, readCommitDiff } from '../marketing/company-updates.js';
import { renderUpdates } from '../marketing/company-updates-text.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

const MAX_PAGES = 8;

export const COMPANY_UPDATES_TOOL = Object.freeze({
  name: 'company_updates',
  server: 'marketing',
  description: 'Read what changed in one of the house\'s companies, from its own sources — args {company, since?, markReported?, site?, commit?, repo?}. For each code repository the company lists that your operator let you read: the commit subjects, the changelog fragments added (changelog.d/), what CHANGELOG.md gained, and the release notes added or changed — since `since` (a date), else since your last report. A repo you may not read is named with why. commit: one commit\'s patch instead (repo: which repo, when several could hold it). site: true also reads the company\'s site pages and says which changed since your last report (that leaves the machine, so it asks). markReported: true records this read as your report point, so the next call starts here. Everything is cited (repo + commit, fragment or page) — report only what it shows. Reading only; nothing is changed.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      company: Object.freeze({ type: 'string', description: 'The company — its id or its name' }),
      since: Object.freeze({ type: 'string', description: 'A date (2026-10-20) to read from; omit to read since your last report' }),
      markReported: Object.freeze({ type: 'boolean', description: 'true when this is the read you report from — the next call starts here' }),
      site: Object.freeze({ type: 'boolean', description: 'true to also read the company\'s site pages (asks first)' }),
      commit: Object.freeze({ type: 'string', description: 'A commit sha to read whole (its patch, walled files left out)' }),
      repo: Object.freeze({ type: 'string', description: 'Which repo holds the commit — its folder name, path or role' }),
    }),
    required: Object.freeze(['company']),
  }),
});

// impure — the company's site pages through the web door, or why not.
const readSite = async (connection, company, { lanePolicy, mode, emit }) => {
  const urls = [company.site.url, ...company.site.links].filter(Boolean).slice(0, MAX_PAGES);
  if (!urls.length) return { unread: 'no site is recorded for this company' };
  if (!(await webSettings.isEnabled())) return { unread: 'web access is off — your operator can enable it in SETTINGS (WEB ACCESS)' };
  const secret = checkOutboundSecrets('the site read', urls, 'nothing was read');
  if (!secret.ok) return { unread: secret.reason };
  const gate = await gateAct(connection, { server: 'web', tool: 'web_fetch', args: { url: urls[0] }, lanePolicy, mode, emit });
  if (!gate.ok) return { unread: `the site read was not allowed this time (${gate.result.error || gate.result.status})` };
  const pages = [];
  const failed = [];
  for (const url of urls) {
    const out = await fetchWebPage(url);
    await journalWebCall(connection, 'marketing/company_updates', url.slice(0, 200), out.ok ? 'ok' : 'error');
    if (out.ok) pages.push({ url, text: `${out.title ? `${out.title}\n\n` : ''}${out.text}` });
    else failed.push({ url, error: out.error });
  }
  return { pages, failed };
};

// pure — one commit's patch, in words, the patch framed.
const renderDiff = (out, commit) => [
  `## COMMIT ${commit} — ${out.repo.role ? `${out.repo.role} — ` : ''}${out.repo.path}`,
  ...(out.withheld ? [`${out.withheld} file(s) in it are behind a wall (.env, keys, credential stores, git internals) and are left out.`] : []),
  ...(out.held ? [`${out.held} line(s) shaped like a secret were held back.`] : []),
  frameUntrustedSections(`the repository at ${out.repo.path}`, [{ lead: `${out.repo.path} @ ${commit}`, text: out.text }]),
].join('\n\n');

/**
 * Run company_updates for a lane, after its own gate has passed. impure.
 * @param {object} connection - the portal connection (its wallet is the house)
 * @param {object} args
 * @param {{lanePolicy: ?object, mode: string, emit: Function}} ctx
 * @returns {Promise<{ok: true, content: string, summary: string}|{ok: false, error: string}>}
 */
export const runCompanyUpdates = async (connection, args, ctx) => {
  const wallet = connection.walletAddress;
  const laneId = connection.companion?.neumaId || null;
  if (!args?.company) return { ok: false, error: 'company_updates needs {company} — the id or name of one of your house\'s companies' };
  if (args.commit) {
    const out = await readCommitDiff({ wallet, laneId, company: args.company, commit: String(args.commit), repo: args.repo || null });
    return out.ok ? { ok: true, content: renderDiff(out, String(args.commit)), summary: `commit ${String(args.commit).slice(0, 9)}` } : out;
  }
  let site = null;
  if (args.site === true) {
    const company = (await listCompanies(wallet)).find((c) => c.id === String(args.company).toLowerCase()
      || c.name.toLowerCase() === String(args.company).toLowerCase());
    site = company ? await readSite(connection, company, ctx) : null;
  }
  const out = await readCompanyUpdates({ wallet, laneId, company: args.company, since: args.since || null, markReported: args.markReported === true, site });
  if (!out.ok) return out;
  const read = out.report.repos.filter((r) => !r.unread);
  return {
    ok: true,
    content: renderUpdates(out.report),
    summary: `${out.report.company.name}: ${read.reduce((n, r) => n + r.total, 0)} commit(s) across ${read.length} repo(s)${out.report.marked ? ' · report point recorded' : ''}`,
  };
};
