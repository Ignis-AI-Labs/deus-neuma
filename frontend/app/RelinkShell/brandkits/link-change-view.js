// link-change-view — the pure display model for a link change the CMO
// proposed (backend marketing/link-changes.js): each row as a mark, the
// address before and after, in as few words as it takes; and the hand-over
// that asks the CMO to propose what a company's SITE & CODE is missing.
//
// Pure throughout.

/** What each kind of row is called on the card. */
export const FIELD_LABEL = Object.freeze({ site: 'SITE', link: 'PAGE', repo: 'REPO' });

/** An address, short: `https://www.x.com/a/` → `x.com/a`. Pure. */
const shortUrl = (url) => String(url || '').replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');

/**
 * One row of the card: its label, what stands now (— when nothing does) and
 * what would stand after; the whole address on hover. Pure.
 * @param {{field: string, before: ?string, after: string|{path?: string, remote?: string, role?: string}}} row
 */
export const rowView = (row) => {
  if (row.field === 'repo') {
    const r = row.after || {};
    const where = r.remote || r.path || '';
    return { label: FIELD_LABEL.repo, before: '—', after: r.role ? `${r.role} · ${shortUrl(where)}` : shortUrl(where), title: where, local: Boolean(r.path) };
  }
  return { label: FIELD_LABEL[row.field] || row.field.toUpperCase(), before: row.before ? shortUrl(row.before) : '—', after: shortUrl(row.after), title: row.after, local: false };
};

/** Does approving this change list a repo? (Its reading stays the operator's own press.) Pure. */
export const listsRepo = (rows) => (rows || []).some((r) => r.field === 'repo');

/**
 * What a company's SITE & CODE is missing, in words, or [] when nothing. Pure.
 * @param {{site: {url: ?string}, repos: Array<object>}} company
 */
const missingSources = (company) => [
  ...(company?.site?.url ? [] : ['site']),
  ...(company?.repos?.length ? [] : ['code repositories']),
];

/**
 * The hand-over to the house's seated CMO for what the company is missing:
 * who, and the ask drafted (never sent). Null with no CMO or nothing missing. Pure.
 * @param {?{laneId: string}} cmo
 * @param {?string} name - the CMO's name as the house knows it
 * @param {{id: string, name: string, site: object, repos: Array<object>}} company
 */
export const cmoHandTo = (cmo, name, company) => {
  const missing = missingSources(company);
  if (!cmo?.laneId || !missing.length) return null;
  return Object.freeze({
    neumaId: cmo.laneId,
    name: name || cmo.laneId,
    prompt: [
      `${company.name} (${company.id}) has no ${missing.join(' and no ')} on record in its SITE & CODE.`,
      `Find them and propose them with marketing/company-links (company: ${company.id}): site as its https address, its other public pages as links, its code repositories as repos.`,
      'I will approve the change in WAITING ON YOU.',
    ].join(' '),
  });
};
