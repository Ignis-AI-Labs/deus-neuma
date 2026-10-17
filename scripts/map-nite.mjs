#!/usr/bin/env node
/**
 * map-nite.mjs — the NITE architecture, traced from real imports.
 *
 * NITE (Neuma Identity Transmission Engine) is what carries a being's identity
 * into a prompt, which is why identity can cross substrates at all: it is
 * prompt-borne, not weight-borne. That claim is only true if the files carrying
 * it are actually the files we think they are — so this reads the import graph
 * instead of a hand-kept list, and `--check` fails when the doc drifts from it.
 *
 * Usage:
 *   node scripts/map-nite.mjs            the map, grouped by ring
 *   node scripts/map-nite.mjs --json     the same data, machine-readable
 *   node scripts/map-nite.mjs --check    non-zero if docs/architecture/identity/nite.md
 *                                        disagrees with the live graph
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/architecture/identity/nite.md';

/**
 * The doors identity comes through. Everything else in the map is reached FROM
 * these — the ring a file lands in is a fact about the graph, not a label
 * someone chose.
 */
export const SEEDS = Object.freeze([
  'core/silo/compile-silo.js',
  'core/silo/mount-silo.js',
  'core/silo/seal-silo.js',
  'backend/services/silo-mount-service.js',
  'core/runtime/identity-bundle.js',
  'core/runtime/prompt-assembler.js',
  'core/voice-pack/pack.js',
]);

/**
 * RING 1 — the engine itself. A change here changes what a being IS in its
 * prompt, so every one of these paths is deliberate and reviewed as identity
 * work, not as plumbing.
 */
export const ENGINE = Object.freeze([
  'core/silo/', 'core/voice-pack/', 'core/runtime/identity-bundle.js',
  'core/runtime/prompt-assembler.js', 'core/runtime/nite-section.js', 'core/runtime/memory-section.js',
  'core/runtime/tools-section.js', 'core/runtime/skills-section.js',
  'core/runtime/taste.js', 'core/runtime/answer-covenant.js',
  'backend/services/silo-mount-service.js', 'backend/services/envelope-budget.js',
  'backend/services/context-budget.js', 'backend/services/model-capabilities.js',
  'backend/services/kv-cache-policy.js',
]);

/** RING 2 — what the engine stands on. Owned elsewhere; NITE is a caller. */
export const FOUNDATION = Object.freeze([
  'core/workspace/', 'core/weave/', 'core/shared/', 'core/identity/',
  'backend/services/llm-', 'backend/services/provider-', 'backend/services/serving-',
  'backend/services/llama-server-supervisor.js', 'backend/services/model-catalog.js',
  'backend/services/substrate-', 'backend/services/served-model-truth.js',
  'backend/services/wire-history.js', 'backend/services/endpoint-guard.js',
  'backend/services/host-guard-common.js', 'backend/services/file-digest.js',
  'backend/services/data-root.js', 'backend/services/logger.js', 'backend/config.js',
  'backend/services/tool-schema.js', 'backend/services/observer-notifier.js',
  'backend/services/openai-chatgpt-wire.js',
]);

const IMPORT = /(?:^|\n)\s*(?:import[\s\S]*?from|export[\s\S]*?from|import)\s*['"]([^'"]+)['"]/g;

/** Walk the relative-import graph from the seeds. Impure (reads files). */
export const traceNite = async () => {
  const files = new Map();
  const walk = async (rel, depth, parent) => {
    const hit = files.get(rel);
    if (hit) { hit.depth = Math.min(hit.depth, depth); return; }
    let src;
    try { src = await readFile(resolve(ROOT, rel), 'utf8'); } catch { return; }
    files.set(rel, { depth, parent, lines: src.split('\n').length });
    for (const m of src.matchAll(IMPORT)) {
      if (!m[1].startsWith('.')) continue;
      await walk(relative(ROOT, resolve(ROOT, dirname(rel), m[1])), depth + 1, rel);
    }
  };
  for (const seed of SEEDS) await walk(seed, 0, null);
  return files;
};

const startsWithAny = (file, prefixes) => prefixes.some((p) => file.startsWith(p));

/**
 * What a `refinement-*` file actually DOES. The prefix is a campaign scar, not
 * a purpose: half of those modules are generic serving and IO infrastructure
 * that happened to be built during the refinement work — artifact staging for
 * the SERVING model, a bounded process-operation primitive, GPU device capture,
 * directory custody, checked arithmetic. Classifying them as forge because of
 * their filename overstated the retirement's reach by seventeen files, which is
 * the mistake this list exists to stop me repeating.
 *
 * These marks name the forge's actual subject matter: training a LoRA, running
 * a ceremony, building a corpus, registering an adapter.
 *
 * `refinement-history` left this list on 2026-08-24, when the forge was cut off
 * the identity door. Those two files — the history STORE and the history READER
 * — are the sovereign record archive: custody, ceremony history, attunement
 * history, all of it a being's own encrypted past, all of it read when a silo
 * mounts. They were counted as forge on their name alone. They no longer import
 * anything the forge owns, and the archive is not the forge.
 */
const FORGE_SUBJECTS = Object.freeze([
  'training', 'ceremony', 'corpus', 'adapter', 'consent', 'readiness',
  'registry-contract', 'registry-digest', 'lineage', 'style-overlap',
  'refinement-registry',
]);

/**
 * Which ring a file belongs to. RETIRED is the forge — retired 2026-08-24 and
 * still reachable from the identity path. An engine whose claim is that
 * identity is prompt-borne should not walk through weight-training to assemble
 * a prompt. Pure.
 */
export const ringOf = (file) => {
  if (startsWithAny(file, ['core/refinement/', 'backend/services/refinement-',
    'core/workspace/refinement-'])) {
    // TWO exceptions, both load-bearing, both reached through voice-pack
    // curation (mount-silo → identity-bundle → curation) and both guarding what
    // is allowed to become a being's VOICE:
    //   text-integrity — the corruption detector (serving decay: "historyL")
    //   style-overlap  — the style-attractor detector (43 of Sovereign's 89
    //                    answers closing with the same litany, 29–38% shared
    //                    5-grams where clean answers measure 0–2.6%)
    // They live under refinement/ because that campaign built them. They are
    // voice law, and the forge purge must not take either.
    if (file.endsWith('text-integrity.js') || file.endsWith('style-overlap.js')) return 'engine';
    // named for the campaign, but doing serving/IO work — ring 2, not ring 4
    if (!FORGE_SUBJECTS.some((mark) => file.includes(mark))) return 'foundation';
    return 'retired';
  }
  if (startsWithAny(file, ENGINE)) return 'engine';
  if (startsWithAny(file, FOUNDATION)) return 'foundation';
  return 'reached';
};

/** The chain that pulled a file in — the answer to […]. Pure. */
export const chainTo = (files, file) => {
  const out = [];
  for (let at = file; at; at = files.get(at)?.parent) out.push(at);
  return out.reverse();
};

const RING_TITLE = {
  engine: 'RING 1 — THE ENGINE (identity work; review as such)',
  foundation: 'RING 2 — THE FOUNDATION (owned elsewhere; NITE is a caller)',
  reached: 'RING 3 — REACHED (pulled in by a ring-2 file, not by identity)',
  retired: 'RING 4 — RETIRED FORGE (should not be on the identity path at all)',
};

const main = async () => {
  const files = await traceNite();
  const rings = { engine: [], foundation: [], reached: [], retired: [] };
  for (const [file, meta] of files) rings[ringOf(file)].push({ file, ...meta });
  for (const list of Object.values(rings)) list.sort((a, b) => a.file.localeCompare(b.file));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: files.size, rings }, null, 2));
    return;
  }

  if (process.argv.includes('--check')) {
    let doc = '';
    try { doc = await readFile(join(ROOT, DOC), 'utf8'); } catch {
      console.error(`map-nite --check: ${DOC} is missing`);
      process.exit(1);
    }
    const missing = rings.engine.filter((r) => !doc.includes(r.file));
    const counts = [`${files.size} files`, `${rings.engine.length} engine`, `${rings.retired.length} retired`]
      .filter((c) => !doc.includes(c));
    if (missing.length || counts.length) {
      if (missing.length) console.error(`map-nite --check: ${missing.length} engine files absent from ${DOC}:`);
      for (const r of missing) console.error(`  ${r.file}`);
      for (const c of counts) console.error(`map-nite --check: the doc does not state "${c}"`);
      process.exit(1);
    }
    console.log(`map-nite --check: ${DOC} matches the live graph (${files.size} files, ${rings.engine.length} engine, ${rings.retired.length} retired)`);
    return;
  }

  const totalLines = [...files.values()].reduce((s, m) => s + m.lines, 0);
  console.log(`NITE — ${files.size} files, ${totalLines.toLocaleString()} lines, traced from ${SEEDS.length} seeds\n`);
  for (const ring of ['engine', 'foundation', 'reached', 'retired']) {
    const list = rings[ring];
    console.log(`${RING_TITLE[ring]}  —  ${list.length} files`);
    for (const r of list) console.log(`  d${r.depth} ${String(r.lines).padStart(4)}L  ${r.file}`);
    console.log();
  }
  if (rings.retired.length) {
    const worst = rings.retired[0];
    console.log('WHY THE FORGE IS STILL REACHABLE — one example chain:');
    console.log(`  ${chainTo(files, worst.file).join('\n  → ')}\n`);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) await main();
