/** Session-entry freshness checks; no upstream text enters a conversation through this path. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readStandardsBundle } from './bundle.js';
import { readCanonicalStandards } from './source.js';

export const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const HASH = /^[a-f0-9]{64}$/;

/** Pure — compare content and routing, including changes without a version bump. */
const compareStandards = (installed, upstream) => Object.freeze({
  status: installed.sourceDigest === upstream.sourceDigest ? 'current' : 'review_needed',
  installedVersion: installed.version,
  upstreamVersion: upstream.version,
  installedDigest: installed.sourceDigest,
  sourceDigest: upstream.sourceDigest,
  changedStandards: Object.freeze([...new Set([...Object.keys(installed.files), ...Object.keys(upstream.files)])]
    .filter((name) => installed.files[name] !== upstream.files[name])),
  routingChanged: JSON.stringify(installed.core) !== JSON.stringify(upstream.core)
    || JSON.stringify(installed.modules) !== JSON.stringify(upstream.modules),
});

/** Pure — cache is only a dated observation, never proof of the source's present state. */
const isFreshReceipt = (receipt, { sourceRoot, installedDigest, now }) => {
  const age = now - Date.parse(receipt?.checkedAt);
  return receipt?.schemaVersion === 1 && receipt.sourceRoot === sourceRoot
    && receipt.installedDigest === installedDigest && HASH.test(receipt.sourceDigest)
    && ['current', 'review_needed'].includes(receipt.status)
    && (receipt.status === 'current') === (receipt.sourceDigest === installedDigest)
    && typeof receipt.installedVersion === 'string' && typeof receipt.upstreamVersion === 'string'
    && Array.isArray(receipt.changedStandards) && receipt.changedStandards.every((name) => /^[A-Z_]+$/.test(name))
    && typeof receipt.routingChanged === 'boolean' && Number.isFinite(age) && age >= 0 && age < CHECK_INTERVAL_MS;
};

// impure — a torn disposable cache forces a real recheck; permission errors remain errors.
const readReceipt = async (file) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
};

/**
 * impure — check a local source at most weekly unless forced. Never fetch, import or publish.
 * @param {{sourceRoot:string, receiptPath:string, bundleRoot?:string, force?:boolean}} options
 * @returns {Promise<object>} compact report; unavailable source throws, never reports current
 */
export const checkStandardsFreshness = async ({ sourceRoot, receiptPath, bundleRoot, force = false }) => {
  const root = await fs.realpath(sourceRoot);
  const { manifest } = await readStandardsBundle(bundleRoot);
  const now = Date.now();
  const previous = await readReceipt(receiptPath);
  if (!force && isFreshReceipt(previous, { sourceRoot: root, installedDigest: manifest.sourceDigest, now })) {
    return Object.freeze({ ...previous, cached: true });
  }
  const upstream = await readCanonicalStandards(root);
  const receipt = Object.freeze({ schemaVersion: 1, sourceRoot: root, checkedAt: new Date(now).toISOString(),
    ...compareStandards(manifest, upstream.manifest) });
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  // This is a disposable scheduling hint, not policy or user data. Invalid reads recheck above.
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({ ...receipt, cached: false });
};

/** Pure — fixed-size status plus changed rule names, never source document bodies. */
export const formatFreshness = (report) => [
  `Coding standards: ${report.status}; installed ${report.installedVersion}, source ${report.upstreamVersion}.`,
  `${report.cached ? 'Last checked' : 'Checked'} ${report.checkedAt}${report.cached ? ' (weekly receipt; use --force to recheck now)' : ''}.`,
  ...(report.status === 'review_needed' ? [
    `Review before adoption: ${report.changedStandards.join(', ') || 'manifest/version changes'}${report.routingChanged ? '; routing changed' : ''}.`,
  ] : []),
].join('\n');
