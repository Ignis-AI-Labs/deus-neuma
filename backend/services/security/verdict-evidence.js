// Verdict evidence — what the office MEASURED when it judged a threat, kept
// beside the judgement so the verdict shows why.
//
// `not_affected` is the one verdict the watch never re-checks (a judgement,
// not a claim about the scan), so it must carry its grounds. For an OSV
// finding those grounds are the attack-surface map (attack-surface.js): which
// direct dependency pulls each affected package in, whether any source
// imports it, and which routes reach it. It is attached automatically at
// assess time — the CSO never has to remember to cite it, and a map that
// could not be read is attached as THAT, never silently dropped.

import { threatLedgerFor } from './threat-ledger.js';
import { watchStoreFor } from './watch-store.js';
import { mapThreatAttackSurface, selectWatchedRepo } from './attack-surface.js';

/**
 * pure — the stored evidence from one attack-surface map: the classification
 * per affected pair, small enough to sit in every history row.
 * @param {Object} map mapThreatAttackSurface's result
 */
const surfaceEvidence = (map) => (map.error
  ? { kind: 'attack-surface', measuredAt: map.measuredAt, error: map.error }
  : {
    kind: 'attack-surface',
    measuredAt: map.measuredAt,
    contexts: map.contexts.map((c) => ({
      package: c.affected.package,
      version: c.affected.version,
      exposure: c.exposure,
      roots: c.dependency.roots.map((r) => `${r.name} [${r.kind}]`),
      importers: c.importedBy.length,
      routes: c.routes.length,
    })),
  });

/**
 * impure — evidence for each OSV threat a not_affected verdict settles, keyed
 * by full threat id (the ledger's `verdict.evidenceById`). Other statuses and
 * sources carry none — their reasoning is the assessment itself.
 * @param {{wallet: string, ids: string[], status: string}} args
 * @returns {Promise<Object<string, Object>>}
 */
export const notAffectedEvidence = async ({ wallet, ids, status }) => {
  if (status !== 'not_affected') return {};
  const ledger = await threatLedgerFor(wallet);
  const threats = (await Promise.all(ids.map((id) => ledger.get(id)))).filter((t) => t?.source === 'osv');
  if (!threats.length) return {};
  const watch = await (await watchStoreFor(wallet)).load().catch(() => null);
  const evidence = {};
  for (const threat of threats) {
    try {
      if (!watch) throw new Error('the watch list could not be read');
      const repo = selectWatchedRepo(watch, threat.repo);
      evidence[threat.id] = surfaceEvidence(await mapThreatAttackSurface(threat, repo.path));
    } catch (err) {
      evidence[threat.id] = { kind: 'attack-surface', measuredAt: new Date().toISOString(), error: `the attack surface could not be mapped: ${err.message}` };
    }
  }
  return evidence;
};
