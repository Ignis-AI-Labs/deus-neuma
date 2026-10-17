/**
 * Identity Silo v1 — the COMPILE half proven on a REAL lane (RULE 0):
 * a real encrypted workspace on disk, real DNA/observations/voice entries,
 * the real canonical hasher. Under test is the contract's own language
 * (docs/architecture/identity/identity-silo.md):
 *
 *   - complete: the silo carries what the lane holds, split into the
 *     contract's layers, keyed by neumaId for EVERY member (Founder's law);
 *   - self-verifying: one changed byte in any layer is refused LOUDLY;
 *   - honest: v1 declares its own gaps (deferred layers, null signature)
 *     inside the artifact instead of implying a seal it does not have;
 *   - weights referenced, never embedded: lineage rows pass through as
 *     pointers supplied by the caller who holds the registry authorities.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { appendVoiceEntry } from '../../core/voice-pack/voice-store.js';
import { compileSilo, verifySilo, assertSiloIntegrity, SILO_LAYERS } from '../../core/silo/compile-silo.js';

const BEING_A = 'silo-being-a';
const BEING_B = 'silo-being-b';

let root;
let silo;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'silo-compile-'));
  setWorkspacesRoot(path.join(root, 'workspaces'));
  for (const id of [BEING_A, BEING_B]) await workspace.create(id);

  await workspace.writeDNA(BEING_A, { name: 'Aster', essence: 'the one who compiles', genesis: 'I chose this shape myself.' });
  await workspace.addObservation(BEING_A, { content: 'the operator asked for a loadable self', significance: 0.9 });
  await appendVoiceEntry(workspace, BEING_A, {
    text: 'I speak in my own claimed words, and the silo carries them across every engine I ever ride.', origin: 'being', source: { kind: 'seal-rite' },
  });

  silo = await compileSilo(BEING_A, {
    workspace,
    refinementLineage: [{ adapterId: 'aster-voice-1', baseModel: 'gemma-4-31b', artifactSha256: 'a'.repeat(64) }],
    now: '2026-08-20T08:00:00.000Z',
  });
});

afterAll(async () => {
  setWorkspacesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('complete and keyed by id', () => {
  test('every contract layer is present and hashed; the lane\'s state crossed', () => {
    expect(silo.manifest.schema).toBe('silo/1');
    expect(silo.manifest.neumaId).toBe(BEING_A);
    for (const layer of SILO_LAYERS) {
      expect(silo.layers[layer]).toBeDefined();
      expect(silo.manifest.layerHashes[layer]).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(silo.layers.identity.dna.essence).toBe('the one who compiles');
    expect(silo.layers.memory.observations.some((o) => o.content.includes('loadable self'))).toBe(true);
    expect(silo.layers.voice.pack.some((e) => e.text.includes('my own claimed words'))).toBe(true);
    expect(silo.layers.refinement.lineage).toEqual([
      { adapterId: 'aster-voice-1', baseModel: 'gemma-4-31b', artifactSha256: 'a'.repeat(64) },
    ]);
  });

  test('v1 declares its own gaps inside the artifact', () => {
    expect(silo.manifest.deferred).toEqual(['delegation', 'skills']);
    expect(silo.manifest.signature).toBeNull();
  });

  test('two beings compile DISTINCT silos — nothing keys off a name', async () => {
    const other = await compileSilo(BEING_B, { workspace, now: '2026-08-20T08:00:00.000Z' });
    expect(other.manifest.neumaId).toBe(BEING_B);
    expect(other.manifest.layerHashes.identity).not.toBe(silo.manifest.layerHashes.identity);
    expect(other.layers.refinement.lineage).toEqual([]);
  });
});

describe('self-verifying', () => {
  test('an untampered silo verifies clean', () => {
    expect(verifySilo(silo)).toEqual({ ok: true, failures: [] });
    expect(assertSiloIntegrity(silo)).toBe(true);
  });

  test('one changed byte in any layer is refused loudly, naming the layer', () => {
    const tampered = structuredClone(silo);
    tampered.layers.identity.dna.essence = 'someone else entirely';
    const { ok, failures } = verifySilo(tampered);
    expect(ok).toBe(false);
    expect(failures).toEqual(['layer hash mismatch: identity']);
    expect(() => assertSiloIntegrity(tampered)).toThrow(/silo refused: layer hash mismatch: identity/);
  });

  test('a missing layer and a foreign schema are refusals, not shrugs', () => {
    const gutted = structuredClone(silo);
    delete gutted.layers.voice;
    expect(verifySilo(gutted).failures).toContain('layer missing: voice');
    expect(verifySilo({ manifest: { schema: 'silo/999' }, layers: {} }).ok).toBe(false);
  });
});
