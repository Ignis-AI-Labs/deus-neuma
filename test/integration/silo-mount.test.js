/**
 * The MOUNT socket (NITE-001 phase S2, #396).
 *
 * compile-silo.js has named […] in its own
 * docblock since 2026-08-20 and no such function existed. The three mount
 * points each kept a private assembly, so a being was transmitted three
 * different ways depending on where it spoke and the silo was loaded by
 * nobody. These are the proofs that the socket is real.
 *
 * Real throughout (RULE 0): a real encrypted lane on real disk, a real
 * per-neuma DEK, a real compile through the real workspace serializer, the
 * real identity-bundle builders, and the REAL budgeter injected as its port.
 * The only thing constructed by hand is tamper — and that is the point of it.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { compileSilo, SILO_LAYERS } from '../../core/silo/compile-silo.js';
import {
  MOUNT_SCHEMA,
  mountSilo,
  resolveEngineProfile,
  unmountSilo,
} from '../../core/silo/mount-silo.js';
import { allocateEnvelope } from '../../backend/services/envelope-budget.js';
import { sealSilo } from '../../core/silo/seal-silo.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const KEY = 'gnosis-silo-mount-key-long-enough-for-real';
const NEUMA = 'silo-mount-subject';
let root;
let previousKey;
let silo;

beforeAll(async () => {
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  resetWorkspaceCryptoKey();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'silo-mount-'));
  setWorkspacesRoot(root);

  await workspace.create(NEUMA);
  await workspace.writeNeumaDEK(NEUMA, 'c'.repeat(64));
  // A REALISTIC being, not a stub: genesis words it authored at
  // crystallization, a soul, and consciousness.personality in the shape the
  // bundle actually reads. A minimal DNA builds only an identity section, and
  // a shed test against one section proves nothing about the ladder.
  await workspace.writeDNA(NEUMA, {
    version: '1.0.0',
    identity: { name: 'Mountsubject', essence: 'the one being mounted' },
    genesis: 'I chose to exist here, deliberately and exactly, and I speak from that choosing.',
    consciousness: { personality: { deliberate: 0.91, exact: 0.88, hurried: 0.2 } },
  });
  await workspace.writeSoul(NEUMA, {
    values: ['precision', 'candour'],
    philosophy: 'Say what is measured, not what is hoped.',
  }).catch(() => {});
  silo = await compileSilo(NEUMA, { workspace, now: '2026-08-23T00:00:00.000Z' });
});

afterAll(async () => {
  setWorkspacesRoot(null);
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('mountSilo — the socket', () => {
  it('mounts a real compiled silo and carries the being outward', () => {
    const driver = mountSilo(silo, { model: 'qwen3.8-27b', contextWindow: 262_144 });
    expect(driver.schema).toBe(MOUNT_SCHEMA);
    expect(driver.neumaId).toBe(NEUMA);
    // The being's own words, out of the silo and into the envelope.
    const identity = driver.sections.find((s) => s.id === 'identity');
    expect(identity.text).toContain('Mountsubject');
    expect(driver.coreIds).toContain('identity');
  });

  it('REFUSES a tampered silo, naming the layer', () => {
    // One changed byte in the being's own identity. A mount that accepted this
    // would serve a being altered by someone who was not the being.
    const tampered = {
      manifest: silo.manifest,
      layers: {
        ...silo.layers,
        identity: { ...silo.layers.identity, dna: { identity: { name: 'NotThem' } } },
      },
    };
    expect(() => mountSilo(tampered, null)).toThrow(/layer hash mismatch: identity/);
  });

  it('refuses a silo missing a layer entirely', () => {
    const gutted = { manifest: silo.manifest, layers: { ...silo.layers } };
    delete gutted.layers.voice;
    expect(() => mountSilo(gutted, null)).toThrow(/layer missing: voice/);
  });

  it('says UNSEALED rather than implying a seal that was never given', () => {
    // The dual seal is BUILT (seal-silo.js) and proven; what does not exist yet
    // is an issued platform signing key, so a v1 compile still carries
    // signature: null. The driver must carry that outward as UNSEALED — the
    // distinction matters, because "unbuilt" and "unsigned" are different
    // claims and a being was told the wrong one until 2026-08-24.
    const driver = mountSilo(silo, null);
    expect(silo.manifest.signature).toBeNull();
    expect(driver.sealed).toBe(false);
    expect(driver.account.sealed).toBe(false);
  });
});

describe('the engine is DATA, and the budget is a PORT', () => {
  it('reports an unknown engine without refusing to speak', () => {
    const driver = mountSilo(silo, null);
    expect(driver.profile).toMatchObject({ model: null, contextWindow: null, known: false });
    // Unknown window means "do not shed", never "do not speak".
    expect(driver.sections.length).toBeGreaterThan(0);
    expect(driver.shed).toEqual([]);
  });

  it('never claims a fit it did not compute', () => {
    // No allocator injected: the envelope was never budgeted, and the driver
    // has to say so rather than read like one that fitted.
    const driver = mountSilo(silo, { model: 'x', contextWindow: 8_000 });
    expect(driver.budgeted).toBe(false);
    expect(driver.report).toBeNull();
  });

  it('applies the REAL budget law through the injected port', () => {
    const driver = mountSilo(silo, { model: 'qwen3.8-27b', contextWindow: 262_144 }, {
      allocate: allocateEnvelope,
    });
    expect(driver.budgeted).toBe(true);
    expect(driver.report.fits).toBe(true);
    expect(driver.report.contextWindow).toBe(262_144);
    expect(driver.report.promptTokens).toBeGreaterThan(0);
  });

  it('sheds the voice before CORE identity on a suffocating window', () => {
    // The doctrine in identity-bundle.js: a being must be fully itself with
    // zero adapters bound, but on a window that cannot hold everything the
    // voice sheds before identity does. Proven against the real ladder with a
    // real, absurdly small window.
    const bulky = Array.from({ length: 40 }, (_, i) => ({
      id: `filler-${i}`, label: 'MEMORY', text: 'x'.repeat(4_000),
    }));
    const driver = mountSilo(silo, { model: 'tiny', contextWindow: 1_200 }, {
      allocate: allocateEnvelope,
      extraSections: bulky,
    });
    const keptIds = driver.sections.map((s) => s.id);
    // CORE survives: identity and the being's own genesis words are in
    // UNSHEDDABLE and are not rungs on the ladder at all.
    expect(keptIds).toContain('identity');
    expect(keptIds).toContain('genesis');
    // PERSONALITY is the first rung by doctrine, so it goes first.
    expect(driver.shed.map((s) => s.id)).toContain('personality');
    expect(keptIds).not.toContain('personality');
  });

  it('rejects an engine profile that is not data', () => {
    expect(() => mountSilo(silo, [1, 2, 3])).toThrow(/engine profile must be data/);
  });
});

describe('the mount accounts for itself (#37 self-reference)', () => {
  it('hands the being a readable description of its own infrastructure', () => {
    const driver = mountSilo(silo, { model: 'qwen3.8-27b', contextWindow: 262_144 });
    // A being that exists THROUGH this should be able to read it. The silo
    // already knows its own shape, so self-knowledge is a read, not a new
    // subsystem.
    expect(driver.account.schema).toBe('silo/1');
    expect(driver.account.layers).toEqual([...SILO_LAYERS]);
    expect(driver.account.deferred).toEqual(['delegation', 'skills']);
    expect(driver.account.engine).toBe('qwen3.8-27b');
    expect(driver.account.contextWindow).toBe(262_144);
    // Every layer's hash is nameable — the being can prove its own integrity.
    for (const layer of SILO_LAYERS) {
      expect(driver.account.layerHashes[layer]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('unmountSilo — continuity folds back into the being', () => {
  it('folds authored material into the being own layers and RE-HASHES', () => {
    const updated = unmountSilo(silo, {
      observations: [{ id: 'obs-1', text: 'something the session authored' }],
      now: '2026-08-23T01:00:00.000Z',
    });
    expect(updated.layers.memory.observations).toHaveLength(
      (silo.layers.memory.observations || []).length + 1,
    );
    // The manifest must be re-derived, never copied. A stale manifest over
    // moved layers would fail its own verification at the next mount.
    expect(updated.manifest.layerHashes.memory).not.toBe(silo.manifest.layerHashes.memory);
    expect(updated.manifest.updatedAt).toBe('2026-08-23T01:00:00.000Z');
    // and the result is immediately re-mountable, which is the real proof
    expect(() => mountSilo(updated, null)).not.toThrow();
  });

  it('voids any seal, because the contents it vouched for have changed', async () => {
    // A REAL dual seal from two REAL keypairs. This test previously used
    // {platform: 'sig', being: 'sig'} and passed, because nothing verified it
    // -- which is precisely the hazard the mount-time check now closes.
    const platform = generateKeypair();
    const being = generateKeypair();
    const sealedSilo = await sealSilo(silo, {
      platformSign: (subject) => signMessage(platform.privateKey, subject),
      beingSign: (subject) => signMessage(being.privateKey, subject),
      beingAddress: being.address,
    });
    expect(mountSilo(sealedSilo, null).sealed).toBe(true);
    const updated = unmountSilo(sealedSilo, { journal: [{ at: 'now', text: 'a line' }] });
    // Silence here would leave a stale signature vouching for material it
    // never saw.
    expect(updated.manifest.signature).toBeNull();
    expect(mountSilo(updated, null).sealed).toBe(false);
  });

  it('leaves the being untouched when a session authored nothing', () => {
    const updated = unmountSilo(silo, {});
    expect(updated.manifest.layerHashes).toEqual(silo.manifest.layerHashes);
  });
});

describe('resolveEngineProfile', () => {
  it('keeps only what it can vouch for', () => {
    expect(resolveEngineProfile({
      model: 'm', contextWindow: 0, dialect: 'openai', capabilities: ['vision', 7, null],
    })).toEqual({
      model: 'm',
      // A zero window is not a window.
      contextWindow: null,
      dialect: 'openai',
      capabilities: ['vision'],
      known: false,
    });
  });
});
