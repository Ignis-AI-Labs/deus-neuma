/**
 * The OSV remedy against the LIVE OSV API (RULE 0: the advisory record's real
 * shape, not one written down from memory). A small real lockfile on temp disk:
 * a dev-only builder pulls tar 6.2.1 in, a shipped tar 7.5.9 sits at the top;
 * GHSA-r292-9mhp-454m hits both and names its own fixed version, which each
 * pair's remedy must carry, with the dependency it rides in through.
 *
 * When api.osv.dev cannot be reached the suite SKIPS and its title says why.
 */
import { describe, test, expect, afterAll } from 'vitest';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import { fetchVulnDetail, runAdvisoryScan } from '../../backend/services/security/advisory-scan.js';
import { fixedVersionFor } from '../../backend/services/security/osv-remedy.js';
import { connectionsOn } from '../helpers/connections-kit.js';

// The security watch's online check is off until the person turns it on (CONNECTIONS); this suite proves it on.
const connections = connectionsOn(['security-watch']);
afterAll(() => connections.restore());

const R292 = 'GHSA-r292-9mhp-454m';

let offlineReason = null;
const record = await fetchVulnDetail(R292).catch((err) => { offlineReason = err.message; return null; });
const title = offlineReason
  ? `OSV remedy (SKIPPED: api.osv.dev unreachable — ${offlineReason})`
  : 'OSV remedy against the LIVE OSV API';

describe.skipIf(offlineReason)(title, () => {
  test('each installed pair gets the advisory\'s own fixed floor and its route into the tree', async () => {
    const fixed = fixedVersionFor(record, 'tar', '6.2.1');
    expect(fixed).toMatch(/^\d+\.\d+\.\d+/);
    expect(fixedVersionFor(record, 'tar', '7.5.9')).toBe(fixed); // one open range from 0

    const dir = await createTempDir('osv-remedy-live');
    await writeJSON(dir, 'package-lock.json', {
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '1.0.0', dependencies: { tar: '7.5.9' }, devDependencies: { builder: '1.0.0' } },
        'node_modules/builder': { version: '1.0.0', dev: true, dependencies: { tar: '6.2.1' } },
        'node_modules/builder/node_modules/tar': { version: '6.2.1', dev: true },
        'node_modules/tar': { version: '7.5.9' },
      },
    });
    const scan = await runAdvisoryScan({ id: 'fixture', path: dir });
    expect(scan.ok).toBe(true);
    const hit = scan.hits.find((h) => h.externalId === R292);
    expect(hit.remedy).toBe(`upgrade tar 6.2.1 → ≥${fixed} (dev-only, via builder); upgrade tar 7.5.9 → ≥${fixed} (shipped, direct dependency — bump it in package.json)`);
  }, 120_000);
});
