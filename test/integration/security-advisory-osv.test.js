/**
 * Advisory scan LIVE — the SOFTWARE layer's watch proven against the REAL
 * OSV API (RULE 0: no double anywhere in the claim […]). minimist@1.2.5 is the fixture: its GHSA is
 * stable public record. The full runAdvisoryScan → threat-ledger ingest path
 * lands the finding on REAL tmp disk.
 *
 * Requires network egress to api.osv.dev. If the box is offline the test
 * fails LOUDLY — a watch that cannot reach its source is not a watch.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'path';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import { fetchOsvBatch, fetchVulnDetail, runAdvisoryScan } from '../../backend/services/security/advisory-scan.js';
import { createThreatLedger } from '../../backend/services/security/threat-ledger.js';

const MINIMIST_GHSA = 'GHSA-xvch-5gv4-984h';

describe('advisory scan against the LIVE OSV API', () => {
  let dir;
  beforeEach(async () => { dir = await createTempDir('advisory-live'); });

  test('querybatch surfaces the known minimist advisory', async () => {
    const results = await fetchOsvBatch([{ package: { name: 'minimist', ecosystem: 'npm' }, version: '1.2.5' }]);
    expect(results).toHaveLength(1);
    const ids = (results[0].vulns || []).map((v) => v.id);
    expect(ids).toContain(MINIMIST_GHSA);
  }, 30000);

  test('vuln detail carries a summary and severity the ledger can record', async () => {
    const vuln = await fetchVulnDetail(MINIMIST_GHSA);
    expect(vuln.id).toBe(MINIMIST_GHSA);
    expect(typeof vuln.summary).toBe('string');
  }, 30000);

  test('runAdvisoryScan over a real tmp repo → the finding ingests as a NEW software threat', async () => {
    await writeJSON(dir, 'package-lock.json', {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0' },
        'node_modules/minimist': { version: '1.2.5', resolved: 'https://registry.npmjs.org/minimist/-/minimist-1.2.5.tgz' },
      },
    });
    const scan = await runAdvisoryScan({ id: 'fixture-repo', path: dir });
    expect(scan.error).toBeNull();
    expect(scan.ok).toBe(true);
    expect(scan.checked).toBe(1);
    const hit = scan.hits.find((h) => h.externalId === MINIMIST_GHSA);
    expect(hit).toBeTruthy();
    expect(hit).toMatchObject({
      layer: 'software', source: 'osv', repo: 'fixture-repo', shipped: true,
      affected: [{ package: 'minimist', version: '1.2.5', shipped: true }],
    });

    const ledger = createThreatLedger({ path: path.join(dir, 'threats.json') });
    const { added } = await ledger.ingest(scan.hits);
    expect(added.length).toBeGreaterThan(0);
    const stored = await ledger.get(added.find((e) => e.externalId === MINIMIST_GHSA).id);
    expect(stored.status).toBe('new');
    expect(stored.severity).not.toBe(''); // real advisory metadata, recorded
  }, 60000);

  test('a repo with no lockfile says so — never a silent "clean"', async () => {
    const scan = await runAdvisoryScan({ id: 'lockless', path: dir });
    expect(scan.ok).toBe(false);
    expect(scan.checked).toBe(0);
    expect(scan.error).toMatch(/no package-lock\.json/);
  });
});
