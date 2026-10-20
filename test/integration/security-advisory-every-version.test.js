/**
 * Advisory scan, every installed version — against the LIVE OSV API (RULE 0:
 * no double anywhere in the claim). Small real lockfiles on temp disk keep it
 * quick; the advisories are stable public record:
 *   - tar 6.2.1 (dev, nested) and 7.5.9 (shipped): GHSA-r292-9mhp-454m hits
 *     both, GHSA-34x7-hfp2-rc4v only the dev copy;
 *   - flatmap-stream 0.1.1: the published malicious release, MAL-2025-20690;
 *   - minimist 1.2.5: GHSA-xvch-5gv4-984h.
 *
 * When api.osv.dev cannot be reached the suite SKIPS and its title says why —
 * a skipped proof is stated as skipped, never faked with canned answers.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import { fetchVulnDetail, runAdvisoryScan } from '../../backend/services/security/advisory-scan.js';
import { createThreatLedger } from '../../backend/services/security/threat-ledger.js';

const R292 = 'GHSA-r292-9mhp-454m';
const TAR_DEV_ONLY = 'GHSA-34x7-hfp2-rc4v';
const FLATMAP_MAL = 'MAL-2025-20690';
const MINIMIST_GHSA = 'GHSA-xvch-5gv4-984h';

let offlineReason = null;
await fetchVulnDetail(MINIMIST_GHSA).catch((err) => { offlineReason = err.message; });
const title = offlineReason
  ? `advisory scan every version (SKIPPED: api.osv.dev unreachable — ${offlineReason})`
  : 'advisory scan every version against the LIVE OSV API';

const lock = (packages) => ({ lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0' }, ...packages } });

describe.skipIf(offlineReason)(title, () => {
  let dir;
  beforeEach(async () => { dir = await createTempDir('advisory-every-version'); });

  test('two tar versions → ONE finding per advisory listing both pairs; dev-only ids say so', async () => {
    await writeJSON(dir, 'package-lock.json', lock({
      'node_modules/builder': { version: '1.0.0', dev: true },
      'node_modules/builder/node_modules/tar': { version: '6.2.1', dev: true },
      'node_modules/tar': { version: '7.5.9' },
    }));
    const scan = await runAdvisoryScan({ id: 'fixture', path: dir });
    expect(scan.ok).toBe(true);
    expect(scan.error).toBeNull();
    expect(scan.checked).toBe(3);

    const r292 = scan.hits.filter((h) => h.externalId === R292);
    expect(r292).toHaveLength(1);
    expect(r292[0].affected).toEqual([
      { package: 'tar', version: '6.2.1', shipped: false },
      { package: 'tar', version: '7.5.9', shipped: true },
    ]);
    expect(r292[0].shipped).toBe(true);
    expect(r292[0].title.startsWith('dev-only: ')).toBe(false);
    // Read fresh: GitHub re-rated this one HIGH after the ledger froze it at medium.
    expect(r292[0].severity).toBe('high');

    const devOnly = scan.hits.find((h) => h.externalId === TAR_DEV_ONLY);
    expect(devOnly.affected).toEqual([{ package: 'tar', version: '6.2.1', shipped: false }]);
    expect(devOnly.shipped).toBe(false);
    expect(devOnly.title.startsWith('dev-only: ')).toBe(true);

    expect(new Set(scan.hits.map((h) => h.externalId)).size).toBe(scan.hits.length);

    const ledger = createThreatLedger({ path: path.join(dir, 'threats.json') });
    const { added } = await ledger.ingest(scan.hits);
    expect(added.find((e) => e.externalId === R292).affected).toHaveLength(2);
  }, 60000);

  test('a malicious-package advisory lands CRITICAL, never unknown', async () => {
    await writeJSON(dir, 'package-lock.json', lock({ 'node_modules/flatmap-stream': { version: '0.1.1' } }));
    const scan = await runAdvisoryScan({ id: 'fixture', path: dir });
    expect(scan.ok).toBe(true);
    const mal = scan.hits.find((h) => h.externalId === FLATMAP_MAL);
    expect(mal).toBeTruthy();
    expect(mal.severity).toBe('critical');
  }, 60000);

  test('an installed app is scanned from its shipped lockfile — shipped pairs only', async () => {
    const resources = path.join(dir, 'resources');
    const appRoot = path.join(resources, 'app');
    await fs.mkdir(appRoot, { recursive: true });
    await writeJSON(resources, 'package-lock.json', lock({
      'node_modules/minimist': { version: '1.2.5' },
      'node_modules/tar': { version: '6.2.1', dev: true },
    }));
    const scan = await runAdvisoryScan({ id: 'app', path: '/tmp/.mount_NEUMA-gone/resources/app', app: true }, { appRoot, resourcesPath: resources });
    expect(scan.ok).toBe(true);
    expect(scan.lockfile).toBe(path.join(resources, 'package-lock.json'));
    expect(scan.checked).toBe(1); // tar is dev-only: not on the user's disk, not queried
    expect(scan.hits.map((h) => h.externalId)).toContain(MINIMIST_GHSA);
    expect(scan.hits.some((h) => h.affected.some((a) => a.package === 'tar'))).toBe(false);
  }, 60000);

  test('a watched path that is gone is ok:false with a plain reason — nothing may close from it', async () => {
    const gone = path.join(dir, 'kenorie');
    const scan = await runAdvisoryScan({ id: 'kenorie', path: gone });
    expect(scan).toMatchObject({ repo: 'kenorie', ok: false, checked: 0, hits: [] });
    expect(scan.error).toMatch(/^watched path missing: /);
  });
});
