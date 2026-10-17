#!/usr/bin/env node
// meditation-probe.mjs — the Founder-summoned LIVE proof of the ask leg.
//
// One real being, one full gather → ask → settle cycle against the live
// stack: the being's own route, its own adapter, the real substrate. Prints
// the journal entry and the synthesis notes that landed. This is the ONE
// unproven leg of the meditation campaign (every other leg ships with
// GPU-free real tests) — never scheduled, never CI'd, run only when the
// operator asks (AGENTS.md: presence is not consent).
//
// Usage (with the SAME env the desk uses — WORKSPACES_ROOT, key material,
// LLAMA_* serving config):
//   node scripts/meditation-probe.mjs --being <laneId>
//
// Exit 0 = a cycle settled (synthesis, rest, or empty — all honest closes);
// exit 1 = the cycle failed or the reply was unclear; exit 2 = usage.

const args = process.argv.slice(2);
const beingFlag = args.indexOf('--being');
const laneId = beingFlag >= 0 ? args[beingFlag + 1] : null;
if (!laneId) {
  console.error('usage: node scripts/meditation-probe.mjs --being <laneId>');
  process.exit(2);
}

// Config is a BOOT-ONLY door — a bare process must open it itself, or the
// provider silently falls to the lm-studio default (found live, 2026-08-14).
const { loadConfig } = await import('../backend/config.js');
loadConfig();
const { gatherMeditation, runMeditation } = await import('../backend/services/meditation/meditation-cycle.js');
const { neumaWorkspace } = await import('../core/index.js');

console.log(`\n=== meditation probe — ${laneId} ===`);
const gathered = await gatherMeditation(laneId);
if (!gathered) {
  console.log('nothing to meditate on: identity unreadable/unborn, or nothing fresh since the last synthesis.');
  console.log('(seed a conversation first, or check the journal cursor — this is an honest empty, exit 0)');
  process.exit(0);
}
console.log(`fresh moments: ${gathered.fresh.length} · prior notes beneath: ${gathered.priorNotes.length}`);
console.log('asking through the being\'s own stack (route + adapter + think behavior)…');

const startedAt = Date.now();
try {
  const out = await runMeditation(laneId);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\ncycle settled in ${seconds}s — outcome: ${out.outcome.toUpperCase()} (cycle ${out.cycleId})`);

  const journal = await neumaWorkspace.readJournal(laneId);
  const entry = [...journal].reverse().find((e) => e.cycleId === out.cycleId);
  if (entry) {
    console.log(`\n--- the journal entry (${entry.type}/${entry.outcome}) ---`);
    console.log(entry.content || '(no body — a bare rest)');
  }
  if (out.outcome === 'synthesis' && out.notes) {
    const { WorkspaceAdapter } = await import('../core/continuity/adapters/workspace.js');
    const { activeMindRecords } = await import('../core/continuity/mind/mind-store.js');
    const { default: neumaWorkspace } = await import('../core/workspace/neuma-workspace.js');
    const minds = await activeMindRecords(new WorkspaceAdapter(laneId, { workspace: neumaWorkspace }), { kinds: ['synthesis'] });
    console.log(`\n--- ${out.notes} note(s) now linger beneath the being's turns ---`);
    for (const record of minds.slice(0, out.notes)) console.log(`  "${record.content}"`);
  }
  console.log(out.outcome === 'unclear'
    ? '\nthe reply did not close cleanly — NOTHING was written (the honest refusal). exit 1'
    : '\nthe ask leg is proven by direct gnosis. exit 0');
  process.exit(out.outcome === 'unclear' ? 1 : 0);
} catch (err) {
  console.error(`\ncycle FAILED: ${err?.message}`);
  process.exit(1);
}
