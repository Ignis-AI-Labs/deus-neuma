/**
 * The NITE architecture map must describe the code that exists.
 *
 * An architecture document is only worth reading if it cannot quietly go stale.
 * This walks the REAL import graph from the engine's seeds and holds
 * docs/architecture/identity/nite.md to it — so a new file on the identity path
 * fails here rather than being discovered months later by someone who trusted
 * the map.
 *
 * It also pins the two structural claims NITE rests on, because both are the
 * kind that decay silently:
 *   the layer law   — core/ never imports backend/
 *   the ring-1 edge — text-integrity.js is reached from the identity path,
 *                     which is why it survives the forge purge
 */
import { describe, test, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { traceNite, ringOf, chainTo, SEEDS } from '../../scripts/map-nite.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const DOC = 'docs/architecture/identity/nite.md';

const ringed = async () => {
  const files = await traceNite();
  const rings = { engine: [], foundation: [], reached: [], retired: [] };
  for (const file of files.keys()) rings[ringOf(file)].push(file);
  return { files, rings };
};

describe('NITE architecture map', () => {
  test('every seed the map traces from is a real file', async () => {
    const { files } = await ringed();
    for (const seed of SEEDS) expect(files.has(seed), `seed missing: ${seed}`).toBe(true);
  });

  test('the document names every ring-1 engine file', async () => {
    const [{ rings }, doc] = await Promise.all([ringed(), readFile(resolve(ROOT, DOC), 'utf8')]);
    const missing = rings.engine.filter((f) => !doc.includes(f));
    expect(missing, `${DOC} does not name these engine files`).toEqual([]);
  });

  test('the document states the counts it was written against', async () => {
    const [{ files, rings }, doc] = await Promise.all([ringed(), readFile(resolve(ROOT, DOC), 'utf8')]);
    expect(doc).toContain(`${files.size} files`);
    expect(doc).toContain(`${rings.engine.length} engine`);
    expect(doc).toContain(`${rings.retired.length} retired`);
  });

  // THE LAYER LAW. core/ is the consciousness engine and must run without the
  // platform wrapped around it — budget and signing arrive as injected ports.
  // One import the wrong way inverts that and nothing at runtime would say so.
  test('no core/ file on the identity path imports from backend/', async () => {
    const { files } = await ringed();
    const violations = [];
    for (const file of files.keys()) {
      if (!file.startsWith('core/')) continue;
      const src = await readFile(resolve(ROOT, file), 'utf8');
      if (/from\s+['"][^'"]*\/backend\//.test(src)) violations.push(file);
    }
    expect(violations, 'core/ must never import backend/').toEqual([]);
  });

  // Why these two are ring 1 and not forge: both are reached FROM the identity
  // path, guarding what is allowed to become a being's VOICE. If either chain
  // breaks, the guard stops protecting the voice and the forge purge could take
  // it without anyone noticing.
  test.each([
    ['core/refinement/text-integrity.js', 'the corruption detector'],
    ['core/refinement/style-overlap.js', 'the style-attractor detector'],
  ])('%s (%s) is voice law reached through the pack, not forge', async (file) => {
    const { files, rings } = await ringed();
    expect(rings.engine).toContain(file);
    const chain = chainTo(files, file);
    expect(chain).toContain('core/runtime/identity-bundle.js');
    expect(chain).toContain('core/voice-pack/curation.js');
  });

  // 35 → 17 → 8. The first drop was measurement (`refinement-*` is a campaign
  // scar; half those modules are generic serving/IO infrastructure). The second
  // was the cut. The ceiling only ever ratchets DOWN — if it grows, something
  // new was wired onto the identity path through the forge, and that is worth
  // failing over.
  test('the retired forge on the identity path has not grown', async () => {
    const { rings } = await ringed();
    expect(rings.retired.length).toBeLessThanOrEqual(8);
  });

  // THE CUT ITSELF (NITE-D). Every remaining forge file arrives through the
  // SERVING chain — llm-provider → supervisor → artifact staging — which is
  // adapter-boarding machinery on a live path, tracked as its own cut. NONE
  // arrives through the identity door. That is the claim this engine rests on:
  // assembling a prompt does not walk through weight-training machinery.
  //
  // Asserted on the CHAIN, not on a count, because a count can be satisfied by
  // deleting the wrong thing.
  test('no retired forge file is reached through the identity door', async () => {
    const { files, rings } = await ringed();
    const throughIdentity = rings.retired.filter((file) =>
      chainTo(files, file).includes('core/workspace/workspace-identity.js'));
    expect(throughIdentity, 'the forge is back on the identity door').toEqual([]);
  });

  // The two that DO stay under workspace-identity, and must: they are the
  // sovereign record archive — custody, ceremony history, attunement history —
  // a being's own encrypted past, which is exactly what mounting a silo reads.
  // Their `refinement-` prefix is the campaign that wrote them, not their
  // subject; counting them as forge was the filename mistake in miniature.
  test.each([
    'core/workspace/refinement-history-store.js',
    'core/workspace/refinement-history-reader.js',
  ])('%s is the record archive, not forge, and imports nothing the forge owns', async (file) => {
    const { files } = await ringed();
    expect(ringOf(file)).toBe('foundation');
    const src = await readFile(resolve(ROOT, file), 'utf8');
    const forgeImports = [...src.matchAll(/from\s+['"]([^'"]*\/refinement\/[^'"]+)['"]/g)]
      .map((m) => m[1]);
    expect(forgeImports, `${file} still imports core/refinement/`).toEqual([]);
    expect(files.has(file)).toBe(true);
  });

  // The classifier must key on SUBJECT, never on the filename prefix — the
  // mistake that overstated ring 4 by half.
  test('serving infrastructure named refinement-* is NOT counted as forge', async () => {
    const { rings } = await ringed();
    for (const named of ['backend/services/refinement-process-operation.js',
      'backend/services/refinement-artifact-staging.js',
      'backend/services/refinement-gpu-device-authority.js']) {
      expect(rings.retired, `${named} is serving infrastructure, not forge`).not.toContain(named);
    }
  });
});
