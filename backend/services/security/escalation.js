// Escalation — a CONFIRMED threat becomes a real GitHub Issue on the repo it
// concerns, filed through the operator's own gh CLI in the audit protocol's
// executable format (Rule 7). Moved verbatim out of portal-stream.js
// (2026-08-10) — this is security-office logic, and the stream file is a
// baselined monolith that must shrink, never grow.
//
// The secret law holds here exactly as in the ledger: no secret material can
// ride — the ledger never holds any (sweep findings carry file+line only),
// and the body builder adds nothing beyond the entry itself.

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

// pure — the Rule 7 escalation body, assembled from the ledger entry alone.
export const escalationBody = (threat) => [
  `## Metadata`,
  ``,
  `| Field | Value |`,
  `| ----- | ----- |`,
  `| Date Filed | ${new Date().toISOString().slice(0, 10)} |`,
  `| Filed By | the house CSO (watchtower) |`,
  `| Source | standing security watch — ${threat.source} |`,
  `| Ledger Entry | ${threat.id} |`,
  ``,
  `## Threat`,
  ``,
  `- **${threat.externalId}** — severity ${threat.severity}, layer ${threat.layer}${threat.repo ? `, repo ${threat.repo}` : ''}`,
  threat.publishedAt ? `- Published: ${threat.publishedAt}` : null,
  threat.affected?.length ? `- Affected: ${threat.affected.map((a) => `${a.package}@${a.version}`).join(', ')}` : null,
  threat.surfaces?.length ? `- Surfaces: ${threat.surfaces.join(', ')}` : null,
  ``,
  `## Summary`,
  ``,
  threat.summary || threat.title,
  ``,
  `## Assessment`,
  ``,
  threat.assessment || 'Confirmed by the CSO office; assessment text rides the ledger entry.',
  ``,
  `## Verification`,
  ``,
  `- [ ] Reproduce or refute against the named surfaces`,
  `- [ ] Fix through the Rule 9 pipeline; assess the ledger entry \`mitigated\` when it lands`,
].filter((line) => line !== null).join('\n');

// impure — file the issue through the operator's own gh CLI, in the watched
// repo's checkout so gh's default remote names the project. Labels ride when
// they exist; a missing label retries bare rather than losing the issue.
export const fileSecurityIssue = async (threat, repoPath) => {
  const title = `[WATCHTOWER] ${threat.title}`.slice(0, 240);
  const body = escalationBody(threat);
  const labels = ['domain: security', 'audit: watchtower',
    ...(threat.severity !== 'unknown' ? [`severity: ${threat.severity}`] : [])];
  const baseArgs = ['issue', 'create', '--title', title, '--body', body];
  try {
    const { stdout } = await execFileP('gh', [...baseArgs, ...labels.flatMap((l) => ['--label', l])], { cwd: repoPath, timeout: 30_000 });
    return { ok: true, url: stdout.trim(), labels: true };
  } catch (err) {
    if (!/label/i.test(err.message || '')) return { ok: false, error: err.message };
    const { stdout } = await execFileP('gh', baseArgs, { cwd: repoPath, timeout: 30_000 });
    return { ok: true, url: stdout.trim(), labels: false };
  }
};
