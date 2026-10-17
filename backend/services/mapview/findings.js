/**
 * mapview/findings — the plan-ready findings report. Split out of graph.js
 * under the size law (the buildUsage→reach.js and extractChannels→channels.js
 * moves' sibling); graph.js assembles anomalies, this compiles them for an AI
 * or an operator to act on. Confirmation-aware (MAPVIEW-013, #393): a finding
 * carrying a verdict says so out loud, so the reader always knows whether
 * they hold a hypothesis or a receipt. Pure.
 */

const REMEDY = Object.freeze({
  'duplicate-route': 'Two handlers answer the same method+path — the second usually shadows the first. Consolidate to one, or differentiate the paths.',
  'router-unmounted': 'A router defines routes but no app.use mounts it — unreachable unless mounted dynamically. Mount it, or delete if obsolete.',
  'channel-no-consumer': 'A message is emitted but nothing static listens for it. Verify a client/dynamic listener exists, or remove the dead emit.',
  'channel-no-producer': 'Something listens for a message that is never statically emitted. Verify the client emits it, or remove the dead handler.',
  'module-unreachable': 'Nothing that runs can reach this file. Either it is dead surface to delete, or mapview is missing an entry point — add it to `entryPoints` in mapview.config.json.',
  'import-cycle': 'These modules import each other in a loop. Break it by extracting the shared piece both sides need into its own module.',
  'dead-export': 'Exported and never referenced anywhere — not by an importer, not by its own file. Delete the symbol (and any private helpers only it used).',
  'over-export': 'The function is live inside its own file; only the export keyword is dead. Drop the keyword to make it private — do not delete the code.',
  'root-contamination': 'Something is sitting at the top of the repository that was never agreed to. Move it out of the tree, or add it to the allowlist if it genuinely belongs.',
  'layer-violation': 'This import crosses a boundary the operator signed into mapview.config.json. Invert the dependency, or move the shared piece into a layer both sides may reach.',
  'protocol': 'This file breaks a protocol rule the operator signed into mapview.config.json (protocol.rules). Fix the file to obey the rule; the rule itself changes only with a new signature.',
  'hoist-candidate': 'The same body exists in several modules. Extract it once into the suggested home and import it everywhere — this is how a repeated helper becomes a primitive the rest of the system builds on.',
  'retired-tool-ref': 'Reference to a tool name retired in the surface primitives cleanup (S3b4/S3b5). The model should use fs/* + intents + status/ files only. Delete the dead definition/handler or update callers.',
  'size-law-growth': 'File size exceeds the frozen ratchet in scripts/file-size-baseline.json. Must shrink or decompose — 500-line cap is law.',
  'bloat-monolith': 'File exceeds 5000 lines. Architectural bloat. Split into focused modules immediately.',
});

/** What a verdict means for the reader about to act on the finding. Pure. */
const confirmationAdvice = (c) => ({
  'confirmed-live': `CONFIRMED LIVE — do not act on this finding; the scanner cannot see the usage. Receipt: ${c.receipt}`,
  'confirmed-dead': `CONFIRMED DEAD — verified true; acting on it is cut-ready. Receipt: ${c.receipt}`,
  held: `HELD — verified, but the decision belongs to the operator. Receipt: ${c.receipt}`,
}[c.verdict] || null);

/** Compile the graph's anomalies into a plan-ready findings report. Pure. */
export const buildFindings = (graph) => {
  const byName = Object.fromEntries(graph.channels.map((c) => [c.name, c]));
  const findings = graph.anomalies.map((a, i) => {
    const ch = byName[a.label];
    return {
      id: `MV-${String(i + 1).padStart(3, '0')}`,
      severity: a.severity, kind: a.kind, title: a.label, why: a.detail,
      suggestedFix: (a.confirmation && confirmationAdvice(a.confirmation)) || REMEDY[a.kind] || 'Review and resolve.',
      ...(a.confirmation ? { confirmation: a.confirmation } : {}),
      locations: ch ? ch.sites.map((s) => `${s.file}:${s.line} (${s.role})`) : [],
    };
  });
  return {
    repo: graph.meta.root,
    summary: {
      total: findings.length,
      warn: findings.filter((x) => x.severity === 'warn').length,
      info: findings.filter((x) => x.severity === 'info').length,
      confirmed: findings.filter((x) => x.confirmation).length,
    },
    instructions: 'Each finding is a STATIC signal, not a confirmed bug. A `confirmation` field is a verified verdict with its receipt — trust its tier. Everything else: verify against the real code before acting.',
    findings,
  };
};
