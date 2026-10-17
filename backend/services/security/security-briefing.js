import { csoDesignation } from './cso-designation.js';
import { threatLedgerFor } from './threat-ledger.js';
import { watchStoreFor } from './watch-store.js';
import { readScanState } from './security-scheduler.js';
import { readSecurityTelemetry } from './traffic-monitor.js';
import { createLogger } from '../logger.js';

const log = createLogger('Security.Briefing');
const BRIEFING_CAP = 15;
const threatLine = (entry) => `- [${entry.id.slice(0, 10)}] ${entry.severity} · ${entry.layer}${entry.repo ? `/${entry.repo}` : ''} — ${entry.title}`;

const pulseLines = (telemetry) => {
  if (!telemetry) return ['Live traffic: unavailable — inspect the telemetry instrument before trusting silence.'];
  const { traffic, circuitBreakers } = telemetry;
  const anomaly = traffic.anomalies[0];
  return [
    `Live 60s: ${traffic.totals.requests} requests · ${traffic.totals.remote} remote · ${traffic.totals.denied} denied · ${traffic.totals.serverErrors} server errors · ${traffic.totals.portalMessages} portal messages.`,
    anomaly ? `Active anomaly: ${anomaly.severity} ${anomaly.type} from ${anomaly.source} — ${anomaly.detail}.` : 'Active anomaly: none at the current thresholds.',
    `Application firewall: automatic containment ${circuitBreakers.autoContain ? 'ON' : 'OFF'} · ${circuitBreakers.blockedSources.length} source block(s)${circuitBreakers.lockdown ? ` · remote lockdown until ${circuitBreakers.lockdown.until}` : ''}.`,
    telemetry.systemIssues.length ? `Recent system warnings/errors: ${telemetry.systemIssues.length} (security_telemetry reads the redacted entries).` : 'Recent system warnings/errors: none in the process ring.',
  ];
};

/**
 * Live CSO office briefing, read from the office of the lane's OWN house (the
 * connection's wallet): another house's CSO sharing this lane id is never
 * this lane's office. Every non-seated lane receives an empty section. impure.
 */
export const csoBriefingSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return '';
  try {
    if (!(await csoDesignation.holds(wallet, neumaId))) return '';
    const [entries, scan, watch, telemetry] = await Promise.all([
      threatLedgerFor(wallet).then((ledger) => ledger.load()),
      readScanState(wallet).catch(() => null),
      watchStoreFor(wallet).then((store) => store.load()).catch(() => null),
      readSecurityTelemetry({ windowSeconds: 60, logLimit: 5 }).catch(() => null),
    ]);
    const fresh = entries.filter((entry) => entry.status === 'new');
    const confirmed = entries.filter((entry) => entry.status === 'confirmed');
    const needsOperator = entries.filter((entry) => entry.status === 'needs_operator');
    return [
      '## CSO office',
      'You hold the CSO office — the house\'s security is your sole responsibility: software, hardware, traffic, and the house itself. Doctrine: security/playbook.md; charge: security/surfaces.md.',
      '',
      '### The watch',
      scan?.lastRunAt
        ? `Last scan: ${scan.lastRunAt} (${scan.runs?.[0] ? `+${scan.runs[0].added} new, ${scan.runs[0].seen} known` : 'no run summary'})`
        : 'The watch has NEVER run on this install — file a security/scan intent, or ask the operator why the scheduler is silent.',
      watch ? `Watched repos: ${watch.repos.map((repo) => `${repo.id}${repo.hasLockfile ? '' : ' (no lockfile — sweep only)'}`).join(', ') || 'none'}` : null,
      scan?.host ? `Host: kernel ${scan.host.kernel || '?'} · NVIDIA driver ${scan.host.nvidiaDriver || 'n/a'} — check hardware advisories against THESE numbers.` : null,
      '',
      '### The pulse',
      ...pulseLines(telemetry),
      '',
      '### New threats awaiting YOUR assessment',
      fresh.length
        ? [...fresh.slice(0, BRIEFING_CAP).map(threatLine),
          ...(fresh.length > BRIEFING_CAP ? [`- …and ${fresh.length - BRIEFING_CAP} more (security_threats_list {status:'new'})`] : [])].join('\n')
        : 'None — the ledger\'s new lane is clear.',
      fresh.some((entry) => entry.layer === 'software') ? 'Map a software finding before settling it: security_attack_surface {id}. Static evidence narrows exposure; it never proves exploitability alone.' : null,
      '',
      '### Standing',
      confirmed.length ? `CONFIRMED, owed to the fix pipeline:\n${confirmed.slice(0, BRIEFING_CAP).map(threatLine).join('\n')}` : 'No confirmed threats stand.',
      needsOperator.length ? `${needsOperator.length} threat(s) wait on the operator — say exactly what they need when you speak next.` : null,
      'Emergency Reach is bounded: a security/circuit-breaker intent asks the operator for ordinary changes; deterministic critical remote traffic is auto-contained for at most 15 minutes and written to the act ledger.',
    ].filter((line) => line !== null).join('\n');
  } catch (error) {
    log.warn('CSO briefing failed', { neumaId, error: error.message });
    return '';
  }
};
