// link-change-shape — the pure law of a LINK CHANGE: the seated CMO proposes
// a company's site, more of its public pages, or code repos to list, and the
// operator approves each change (ruling, 2026-10-24: […]).
//
// Only the fields the company block already models (kit-shape.js):
// `site` → company.site.url, `links` → company.site.links, `repos` →
// company.repos. A proposal REPLACES the site address and only ADDS pages and
// repos: nothing is ever removed by one. A link is a public web address —
// https, no name or password inside it, a real host name (never this
// machine, never a private network, never a bare IP).
//
// Pure throughout.

import { isForbiddenWebHost } from '../web-guard.js';
import { isIpLiteral, stripBrackets } from '../host-guard-common.js';
import { MAX_REPOS, repoRefusals } from '../branding/company-repos.js';

export const MAX_URL = 300;
/** At most this many pages proposed at once, and kept on a company in all. */
export const MAX_PROPOSED_LINKS = 8;
export const MAX_LINKS = 20;

const KIT_ID = /^[a-z][a-z0-9-]{0,39}$/;
const FIELDS = Object.freeze(['company', 'site', 'links', 'repos']);
// Names that only ever mean a local network, whatever DNS says.
const LOCAL_SUFFIX = /(^|\.)(localhost|local|internal|lan|home\.arpa|intranet|corp)$/i;

/**
 * Why a web address cannot stand as a company link, or null. Pure.
 * @param {unknown} url
 * @returns {?string}
 */
export const linkRefusal = (url) => {
  if (typeof url !== 'string' || !url) return 'a link is a web address (https://…)';
  if (url.length > MAX_URL) return `a link is at most ${MAX_URL} characters`;
  if (/\s/.test(url)) return 'a link has no spaces in it';
  let parsed;
  try { parsed = new URL(url); } catch { return `"${url.slice(0, 80)}" is not a web address`; }
  if (parsed.protocol !== 'https:') return `${url.slice(0, 80)} must start with https://`;
  if (parsed.username || parsed.password) return 'a link never carries a name or password inside it';
  const host = parsed.hostname.toLowerCase();
  if (isIpLiteral(stripBrackets(host))) return `${host} is a bare address — a company link names its site`;
  if (isForbiddenWebHost(host) || LOCAL_SUFFIX.test(host) || !host.includes('.')) return `${host} is this machine or a private network, not a public site`;
  return null;
};

// pure — a repo as the company block stores it.
const repoOf = (r) => ({
  ...(r.path ? { path: r.path } : {}),
  ...(r.remote ? { remote: r.remote } : {}),
  role: typeof r.role === 'string' ? r.role.trim() : '',
});

/**
 * A filed proposal judged on its own: every reason it cannot stand, or the
 * change it asks for. Whether the company is this house's, and whether the
 * change still changes anything, is the house's question (link-changes.js). Pure.
 * @param {object} payload - {company, site?, links?, repos?}
 * @returns {{ok: true, companyId: string, change: {site?: string, links?: string[], repos?: object[]}}|{ok: false, reasons: string[]}}
 */
export const linkChangeRefusals = (payload) => {
  const reasons = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reasons: ['the act is {company, site?, links?, repos?}'] };
  for (const key of Object.keys(payload)) if (!FIELDS.includes(key)) reasons.push(`${key} is not part of this act (${FIELDS.join(', ')})`);
  const companyId = typeof payload.company === 'string' ? payload.company.trim() : '';
  if (!KIT_ID.test(companyId)) reasons.push('company is the id of one of the house\'s companies');
  const change = {};
  if (payload.site !== undefined) {
    const why = linkRefusal(payload.site);
    if (why) reasons.push(`site: ${why}`);
    else change.site = payload.site;
  }
  if (payload.links !== undefined) {
    if (!Array.isArray(payload.links) || !payload.links.length) reasons.push('links is a list of web addresses');
    else if (payload.links.length > MAX_PROPOSED_LINKS) reasons.push(`links holds at most ${MAX_PROPOSED_LINKS} addresses at once`);
    else {
      payload.links.forEach((l, i) => { const why = linkRefusal(l); if (why) reasons.push(`links[${i}]: ${why}`); });
      change.links = [...new Set(payload.links)];
    }
  }
  if (payload.repos !== undefined) {
    if (!Array.isArray(payload.repos) || !payload.repos.length) reasons.push('repos is a list of {remote?, path?, role?}');
    else if (payload.repos.length > MAX_REPOS) reasons.push(`repos holds at most ${MAX_REPOS} repos`);
    else {
      reasons.push(...repoRefusals(payload.repos).map((r) => r.replace(/^company\./, '')));
      payload.repos.forEach((r, i) => {
        const remote = r && typeof r === 'object' ? r.remote : null;
        if (remote) { const why = linkRefusal(remote); if (why) reasons.push(`repos[${i}].remote: ${why}`); }
      });
      change.repos = payload.repos.filter((r) => r && typeof r === 'object').map(repoOf);
    }
  }
  if (payload.site === undefined && payload.links === undefined && payload.repos === undefined) {
    reasons.push('propose at least one of: site, links, repos');
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, companyId, change };
};

// pure — is this repo already on the list? By its folder, else by its address.
const listedAlready = (repos, r) => repos.some((x) => (r.path ? x.path === r.path : !x.path && x.remote === r.remote));

/**
 * What the change would do to a company as it stands NOW, one row each:
 * the site replaced, each page added, each repo listed. Empty when it is all
 * on record already. Pure.
 * @param {{site: {url: ?string, links: string[]}, repos: Array<object>}} company - companyOf()
 * @param {object} change
 * @returns {Array<{field: 'site'|'link'|'repo', before: ?string, after: string|object}>}
 */
export const linkDiff = (company, change) => {
  const rows = [];
  const url = change.site && change.site !== company.site.url ? change.site : company.site.url;
  if (url !== company.site.url) rows.push({ field: 'site', before: company.site.url, after: url });
  for (const link of change.links || []) {
    if (link !== url && !company.site.links.includes(link)) rows.push({ field: 'link', before: null, after: link });
  }
  for (const repo of change.repos || []) {
    if (!listedAlready(company.repos, repo)) rows.push({ field: 'repo', before: null, after: repo });
  }
  return rows;
};

/**
 * Why the change cannot land on the company as it stands now, or null —
 * nothing left to change, or more pages or repos than a company keeps. Pure.
 * @param {object} company - companyOf()
 * @param {object} change
 */
export const landingRefusal = (company, change) => {
  const rows = linkDiff(company, change);
  if (!rows.length) return `${company.name} already has all of that on record`;
  if (company.site.links.length + rows.filter((r) => r.field === 'link').length > MAX_LINKS) return `${company.name} keeps at most ${MAX_LINKS} pages`;
  if (company.repos.length + rows.filter((r) => r.field === 'repo').length > MAX_REPOS) return `${company.name} lists at most ${MAX_REPOS} repos`;
  return null;
};

/**
 * The company block with the change applied — the block as stored, so every
 * field this act does not name stands exactly as it was. Pure.
 * @param {object} block - the kit's raw `company` block (may be undefined)
 * @param {object} change
 * @returns {object}
 */
export const appliedBlock = (block, change) => {
  const base = block && typeof block === 'object' && !Array.isArray(block) ? block : {};
  const next = { ...base };
  if (change.site || change.links?.length) {
    const site = base.site && typeof base.site === 'object' ? base.site : {};
    const url = change.site || site.url || null;
    const had = Array.isArray(site.links) ? site.links : [];
    next.site = { ...site, url, links: [...new Set([...had, ...(change.links || [])])].filter((l) => l !== url) };
  }
  if (change.repos?.length) {
    const had = Array.isArray(base.repos) ? base.repos : [];
    next.repos = [...had, ...change.repos.filter((r) => !listedAlready(had, r))];
  }
  return next;
};

/** A host, for a few words: `https://www.x.com/a` → `x.com/a`. Pure. */
export const shortUrl = (url) => String(url || '').replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');

/**
 * The change in a few words — the WAITING ON YOU row's title. Pure.
 * @param {string} companyName
 * @param {Array<{field: string, after: string|object}>} rows
 */
export const diffWords = (companyName, rows) => {
  const site = rows.find((r) => r.field === 'site');
  const links = rows.filter((r) => r.field === 'link').length;
  const repos = rows.filter((r) => r.field === 'repo').length;
  const parts = [
    ...(site ? [`site → ${shortUrl(site.after)}`] : []),
    ...(links ? [`+${links} page${links === 1 ? '' : 's'}`] : []),
    ...(repos ? [`+${repos} repo${repos === 1 ? '' : 's'}`] : []),
  ];
  return `${companyName} links: ${parts.length ? parts.join(', ') : 'already on record'}`;
};
