/**
 * The security intents — the CSO office's ACTS as filed intents (Stage 3 of
 * docs/planning/proposals/being-tool-surface-primitives.md). These were the
 * act half of security-being-tools.js (security_scan_now, security_threat_assess,
 * security_threat_escalate, security_circuit_breaker) until the acts became
 * files; the reads (posture, threats_list, threat_get, attack_surface,
 * telemetry) stay tools. The logic is relocated unchanged in substance; the
 * card, the journal, and the result file are the sweep's (intent-sweep.js).
 *
 * THE SEAT LAW, at validate time: security acts belong to the seated CSO
 * of the filer's OWN house alone (the connection's wallet — another house's
 * CSO with the same lane id holds nothing here), re-read per act (a
 * designation change holds on the very next filing) — refused BEFORE any
 * card, so the operator is never asked for an act this lane may not hold at
 * all. Every act reads and writes that house's ledger and watch list. The
 * READS stay house-visible.
 */
import { csoDesignation } from '../security/cso-designation.js';
import { threatLedgerFor } from '../security/threat-ledger.js';
import { runSecurityScan } from '../security/security-scheduler.js';
import { fileSecurityIssue } from '../security/escalation.js';
import { assessThreats } from '../security/assess-service.js';
import { selectWatchedRepo } from '../security/attack-surface.js';
import { watchStoreFor } from '../security/watch-store.js';
import { circuitBreaker } from '../security/circuit-breaker.js';
import { notAffectedEvidence } from '../security/verdict-evidence.js';
import { securityFileFixIntent } from './security-fix.js';

const ASSESS_STATUSES = Object.freeze(['not_affected', 'confirmed', 'mitigated', 'needs_operator']);
const BREAKER_ACTIONS = Object.freeze(['block_source', 'unblock_source', 'lock_remote', 'release_remote', 'set_auto_containment']);

// impure — the seat, re-read per act: null when this lane holds the office,
// the standing-rule refusal otherwise.
const seatRefusal = async (connection) => {
  return (await csoDesignation.holds(connection.walletAddress, connection.companion?.neumaId))
    ? null
    : { ok: false, status: 'denied', reason: 'security acts belong to the seated CSO alone' };
};

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

export const securityScanIntent = Object.freeze({
  name: 'security/scan',
  policyTool: 'security.scan',
  fieldsForPrompt: '{}',
  descriptionForPrompt: 'CSO ONLY. Run the full dependency, secret, host, and house watch now. The scheduler already runs at least every 24 hours.',
  availableFor: async ({ laneId, connection }) =>
    ((await csoDesignation.holds(connection?.walletAddress, laneId)) ? {} : null),
  validate: async (_payload, { connection }) => (await seatRefusal(connection)) || { ok: true, value: {} },
  summarize: () => 'run a full security scan now',
  execute: async (_value, { connection }) => {
    const summary = await runSecurityScan({ wallet: connection.walletAddress, trigger: 'cso' });
    const detail = [
      `Scan complete (${summary.startedAt}).`,
      ...summary.repos.map((repo) => `- ${repo.repo}: ${repo.checked} deps, ${repo.hits} advisory hit(s), ${repo.swept} files swept, ${repo.sweepFindings} finding(s)${repo.error ? ` — ERROR: ${repo.error}` : ''}`),
      summary.host ? `- host: ${summary.host.findings.length} finding(s)${summary.host.errors.length ? ` — errors: ${summary.host.errors.join('; ')}` : ''}` : null,
      summary.house ? `- house: ${summary.house.findings.length} finding(s)${summary.house.errors.length ? ` — errors: ${summary.house.errors.join('; ')}` : ''}` : null,
      `Ledger: ${summary.added} new, ${summary.seen} known.`,
    ].filter(Boolean).join('\n');
    return { ok: true, detail };
  },
});

export const securityAssessIntent = Object.freeze({
  name: 'security/assess',
  policyTool: 'security.assess',
  fieldsForPrompt: '{id | ids, status, assessment, surfaces?, githubIssue?}',
  descriptionForPrompt: 'CSO ONLY. Record a reasoned verdict on one threat or a batch. status: not_affected | confirmed | mitigated | needs_operator. Map software exposure first (security_attack_surface) — a not_affected on an advisory carries that map automatically. mitigated is a CLAIM: the next whole scan verifies it, or reopens the threat if it still sees it.',
  availableFor: securityScanIntent.availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    if (!ASSESS_STATUSES.includes(payload?.status)) {
      return invalid(`status must be one of ${ASSESS_STATUSES.join(' | ')}`);
    }
    if (typeof payload?.assessment !== 'string' || !payload.assessment.trim()) {
      return invalid('the assessment is your reasoning — it cannot be empty');
    }
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String) : (payload?.id ? [String(payload.id)] : []);
    if (ids.length === 0) return invalid('name the threat(s): {id} or {ids}');
    return { ok: true, value: { ids, verdict: payload } };
  },
  summarize: (payload) => {
    const count = Array.isArray(payload?.ids) ? payload.ids.length : 1;
    return `assess ${count} threat(s) → ${payload?.status ?? '?'}: "${String(payload?.assessment ?? '').slice(0, 100)}"`;
  },
  execute: async ({ ids, verdict: payload }, { connection }) => {
    const verdict = {
      status: payload.status, assessment: String(payload.assessment || ''),
      ...(Array.isArray(payload.surfaces) ? { surfaces: payload.surfaces.map(String) } : {}),
      assessedBy: connection.companion?.neumaId || 'cso',
      ...(payload.githubIssue ? { githubIssue: String(payload.githubIssue) } : {}),
      evidenceById: await notAffectedEvidence({ wallet: connection.walletAddress, ids, status: payload.status }),
    };
    const result = await assessThreats({ wallet: connection.walletAddress, ids, verdict });
    if (!result.ok && !result.settled.length) {
      return { ok: false, reason: result.error || result.failed.map((f) => `${f.id}: ${f.error}`).join('; ') };
    }
    const failures = result.failed.length ? `\nFailed (${result.failed.length}): ${result.failed.map((f) => `${f.id}: ${f.error}`).join('; ')}` : '';
    const evidenced = result.settled.filter((entry) => entry.evidence).length;
    const evidenceNote = evidenced ? `\nAttack-surface evidence attached to ${evidenced} verdict(s).` : '';
    const claimNote = verdict.status === 'mitigated' ? '\nThe next whole scan verifies each mitigation, or reopens it if it still sees the threat.' : '';
    return {
      ok: true,
      detail: `Assessed ${result.settled.length} threat(s) → ${verdict.status}:\n${result.settled.map((entry) => `[${entry.id.slice(0, 10)}] ${entry.title}`).join('\n')}${failures}${evidenceNote}${claimNote}`,
    };
  },
});

export const securityEscalateIntent = Object.freeze({
  name: 'security/escalate',
  policyTool: 'security.escalate',
  fieldsForPrompt: '{id}',
  descriptionForPrompt: 'CSO ONLY. File a confirmed threat as a real executable GitHub security issue and stamp the ledger with its URL.',
  availableFor: securityScanIntent.availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    if (typeof payload?.id !== 'string' || !payload.id.trim()) return invalid('escalate needs {id} — the threat id from security_threats_list');
    return { ok: true, value: { id: payload.id.trim() } };
  },
  summarize: (payload) => `escalate threat ${String(payload?.id ?? '?')} to a GitHub issue`,
  execute: async ({ id }, { connection }) => {
    const threatLedger = await threatLedgerFor(connection.walletAddress);
    const threat = await threatLedger.get(id);
    if (!threat) return { ok: false, reason: 'no such threat (or the id is ambiguous)' };
    if (threat.status !== 'confirmed') {
      return { ok: false, reason: `only a CONFIRMED threat escalates — this one is ${threat.status}` };
    }
    const watch = await (await watchStoreFor(connection.walletAddress)).load();
    const repo = selectWatchedRepo(watch, threat.repo);
    const filed = await fileSecurityIssue(threat, repo.path);
    if (!filed.ok) return { ok: false, reason: `escalation failed: ${filed.error}` };
    await threatLedger.assess(threat.id, {
      status: 'confirmed', assessment: threat.assessment || 'confirmed',
      assessedBy: connection.companion?.neumaId || 'cso', githubIssue: filed.url,
    });
    return { ok: true, detail: `Escalated ${threat.id.slice(0, 10)} → ${filed.url}` };
  },
});

export const securityCircuitBreakerIntent = Object.freeze({
  name: 'security/circuit-breaker',
  policyTool: 'security.circuit-breaker',
  fieldsForPrompt: '{action, source?, durationSeconds?, reason, enabled?}',
  descriptionForPrompt: 'CSO ONLY. Govern the application firewall. action: block_source | unblock_source | lock_remote | release_remote | set_auto_containment. Loopback can never be blocked; every rule is bounded and audited.',
  availableFor: securityScanIntent.availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    if (!BREAKER_ACTIONS.includes(payload?.action)) {
      return invalid(`action must be one of ${BREAKER_ACTIONS.join(' | ')}`);
    }
    if (typeof payload?.reason !== 'string' || !payload.reason.trim()) {
      return invalid('every firewall act carries its reason — the audit trail is the point');
    }
    return { ok: true, value: { ...payload } };
  },
  summarize: (payload) => {
    const target = payload?.source ? ` ${payload.source}` : '';
    const span = payload?.durationSeconds ? ` for ${payload.durationSeconds}s` : '';
    return `firewall: ${payload?.action ?? '?'}${target}${span} — ${String(payload?.reason ?? '').slice(0, 100)}`;
  },
  execute: async (value, { connection }) => {
    const outcome = await circuitBreaker.apply({ ...value, actor: connection.companion?.neumaId || 'cso' });
    return { ok: true, detail: JSON.stringify(outcome, null, 2) };
  },
});

export const securityIntents = Object.freeze([
  securityScanIntent, securityAssessIntent, securityEscalateIntent, securityCircuitBreakerIntent, securityFileFixIntent,
]);
