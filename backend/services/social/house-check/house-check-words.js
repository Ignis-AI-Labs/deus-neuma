// house-check-words — the HOUSE SOCIAL CHECK in words, for a being's window
// (the `social_check` read, portal-tools/crew-desk-tools.js). The same report
// the desk draws: the house's line, each tree and company, then every in-use
// account that is not clear with what failed and the fix, then the clear ones
// in one line each, then the OPTIONAL group (never counted).
//
// Pure.

const MARK = Object.freeze({ fail: 'FAIL', unknown: 'NOT PROVEN' });

const accountName = (row) => [row.id, row.handle, `(${row.channelName}${row.companyId ? ` · ${row.companyId}` : ' · UNSORTED'})`]
  .filter(Boolean).join(' ');

/**
 * @param {object} report - buildHouseCheck output
 * @returns {string}
 */
export const formatHouseCheckForBeing = (report) => {
  const companyName = new Map(report.companies.map((c) => [c.id, c.name]));
  const lines = [
    `## HOUSE SOCIAL CHECK — ${report.headline}`,
    `checked ${report.checkedAt}${report.probed ? '' : ' · live probes not run: identity and right-account read NOT PROVEN'}`,
  ];
  for (const tree of report.trees) {
    lines.push(`${tree.name}: ${tree.total ? `${tree.clear} OF ${tree.total} CLEAR` : 'no accounts in use'}`);
    for (const id of tree.companies.filter((c) => c !== tree.rootId)) {
      const c = report.companies.find((x) => x.id === id);
      lines.push(`${'  '.repeat(c.depth)}${companyName.get(id)}: ${c.total ? `${c.clear} OF ${c.total} CLEAR` : 'no accounts in use'}`);
    }
  }
  if (report.unsorted.total) lines.push(`UNSORTED (no company): ${report.unsorted.accounts.join(', ')}`);
  const inUse = report.accounts.filter((r) => r.inUse);
  const owing = inUse.filter((r) => !r.clear);
  if (owing.length) {
    lines.push('', 'NOT CLEAR:');
    for (const row of owing) {
      lines.push(`- ${accountName(row)}`);
      for (const c of row.checks.filter((x) => MARK[x.verdict])) {
        lines.push(`  ${MARK[c.verdict]} ${c.label} — ${c.words}${c.fix ? ` FIX: ${c.fix.words}` : ''}`);
      }
    }
  }
  const clear = inUse.filter((r) => r.clear);
  if (clear.length) lines.push('', `CLEAR: ${clear.map(accountName).join('; ')}`);
  const { accounts, platforms } = report.optional;
  if (accounts.length || platforms.length) {
    lines.push('', `OPTIONAL (not counted): ${[
      ...(accounts.length ? [`accounts not in use ${accounts.join(', ')}`] : []),
      ...(platforms.length ? [`platforms with no account ${platforms.join(', ')}`] : []),
    ].join('; ')}`);
  }
  lines.push('', 'Reading only: nothing was changed. The fixes are your operator\'s to make (keys, holders, companies); say which one you need.');
  return lines.join('\n');
};
