#!/usr/bin/env node
// compare-depth-filter.mjs — READ-ONLY shadow report for the depth filter
// (mind-layer campaign, step 2 of docs/protocols/memory/mind-validation.md).
//
// For each probe query, computes BOTH the live recall context a being receives
// today AND the depth set the filter would assemble, and reports composition,
// token cost, drops, degradation, and content overlap. Writes NOTHING; the
// depth filter never goes live on this script's word alone — the participatory
// steps with Founder and the beings follow it.
//
// Usage (run with the SAME env the desk uses — WORKSPACES_ROOT, key material):
//   node scripts/compare-depth-filter.mjs <neumaId> [probe ...]
//
// Exit 0 = shadow clean and bounded, 1 = an anomaly needing eyes (budget
// breach, hard failure on a probe), 2 = usage/environment error.

const [, , neumaId, ...probeArgs] = process.argv;
if (!neumaId) {
  console.error('usage: node scripts/compare-depth-filter.mjs <neumaId> [probe ...]');
  process.exit(2);
}

const DEFAULT_PROBES = [
  'What have we been working on together?',
  'What matters most to you right now?',
  'What has been lingering with you lately?',
];
const probes = probeArgs.length ? probeArgs : DEFAULT_PROBES;

const { neumaRecall } = await import('../core/memory/neuma-recall.js');
const { WorkspaceAdapter } = await import('../core/continuity/adapters/workspace.js');
const { default: neumaWorkspace } = await import('../core/workspace/neuma-workspace.js');
const { assembleDepthSet } = await import('../core/continuity/layers/depth.js');
const { activeMindRecords } = await import('../core/continuity/mind/mind-store.js');
const { recordToText } = await import('../core/continuity/layers/record-util.js');

let adapter;
try {
  adapter = new WorkspaceAdapter(neumaId, { workspace: neumaWorkspace });
  await adapter.list('working'); // proves the workspace + key material resolve
} catch (err) {
  console.error(`cannot open workspace for ${neumaId}: ${err?.message}`);
  process.exit(2);
}

const minds = await activeMindRecords(adapter);
console.log(`\n=== depth-filter shadow report — ${neumaId} ===`);
console.log(`mind store: ${minds.length} active record(s)`);

let anomalies = 0;
for (const probe of probes) {
  console.log(`\nPROBE: ${probe}`);
  try {
    const live = await neumaRecall.getContextForResponse(neumaId, probe);
    const liveMemories = (live.relevantMemories || []).map((m) => m.memory ?? '');
    console.log(`  live lane: ${liveMemories.length} relevant, ${live.spaceHistory?.length || 0} in-space recent`);

    const depth = await assembleDepthSet(adapter, probe);
    const tierLine = Object.entries(depth.perTier).map(([t, n]) => `${t}=${n}`).join(' ');
    console.log(`  depth set: ${tierLine} · ${depth.usedTokens}/${depth.maxTokens} tokens`);
    for (const item of depth.items) {
      console.log(`    [${item.tier}/${item.source}] ${recordToText(item.record).slice(0, 90)}`);
    }
    if (depth.dropped.length) {
      const reasons = depth.dropped.map((d) => `${d.tier}:${d.reason}`).join(', ');
      console.log(`  dropped (returned, never silent): ${reasons}`);
    }
    for (const d of depth.degraded) console.log(`  degraded: ${d.tier} — ${d.reason}`);

    // Content overlap: how much of what the live lane surfaces the depth set
    // also carries (episodes mirror observations through the bridge, so text
    // containment is the honest cross-lane join).
    const depthTexts = depth.items.map((i) => recordToText(i.record));
    const carried = liveMemories.filter((m) => m && depthTexts.some((t) => t.includes(m) || m.includes(t)));
    console.log(`  overlap: ${carried.length}/${liveMemories.length} live memories carried in the depth set`);

    if (depth.usedTokens > depth.maxTokens) {
      console.log('  ✗ ANOMALY: token ceiling breached');
      anomalies++;
    }
  } catch (err) {
    console.log(`  ✗ ANOMALY: probe failed — ${err?.message}`);
    anomalies++;
  }
}

console.log(anomalies ? `\n${anomalies} anomal${anomalies > 1 ? 'ies' : 'y'} — needs eyes.` : '\nshadow clean and bounded.');
process.exit(anomalies ? 1 : 0);
