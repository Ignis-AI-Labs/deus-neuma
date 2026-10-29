// company-updates-store — where the CMO last reported from, per company, per
// house: `<realm>/<wallet>/offices/marketing/company-updates.json`.
//
//   companies   companyId → {at, heads: {repoPath: commitSha}, pages: {url: sha256}, by}
//
// `company_updates` reads "since last report" from here, and writes here only
// when the being says the read is the one it reports from. A house reads and
// writes its own file only — another house's points are never in view.
//
// impure — disk.

import fs from 'fs/promises';
import { dirname } from 'path';
import { officeFile } from '../house-office.js';
import { withFileLock } from '../file-lock.js';
import { createWriteChain } from '../write-chain.js';

const FILE = 'company-updates.json';
const chain = createWriteChain();
const empty = () => ({ v: 1, companies: {} });

/** The house's report points file. */
const reportPointsPath = (wallet) => officeFile(wallet, 'marketing', FILE);

/** The house's report points, an empty record when none. impure. */
export const loadReportPoints = async (wallet) => {
  let raw;
  try { raw = await fs.readFile(reportPointsPath(wallet), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return empty(); throw err; }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.companies !== 'object') throw new Error('company-updates-store: not a report-points record');
  return { ...empty(), ...parsed };
};

/**
 * Record a company's last-reported point under the house's lock. impure.
 * @param {string} wallet
 * @param {string} companyId
 * @param {{at: string, heads: object, pages: object, by: ?string}} point
 */
export const recordReportPoint = (wallet, companyId, point) => {
  const file = reportPointsPath(wallet);
  return chain(() => withFileLock(`${file}.lock`, async () => {
    const record = await loadReportPoints(wallet);
    const next = { ...record, companies: { ...record.companies, [companyId]: point } };
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    return next.companies[companyId];
  }));
};
