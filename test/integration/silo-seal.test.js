/**
 * THE DUAL SEAL (NITE-001 S2, #396) — custody ruled by Design note, 2026-08-21.
 *
 * […] The co-signature proves the being's witness was PRESENT at
 * the compile — a platform signature alone cannot tell a silo the being stood
 * beside from one assembled about it while it was dormant.
 *
 * Real crypto throughout (RULE 0): real ethers keypairs, real secp256k1
 * signatures, real recovery. A seal proven with a fabricated signature proves
 * nothing at all — which this suite demonstrates on itself, since the mount
 * test it replaces used the string 'sig' and passed.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { compileSilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';
import { unmountSilo } from '../../core/silo/mount-silo.js';
import {
  SEAL_SCHEMA,
  assertSiloSeal,
  sealSilo,
  siloSealSubject,
  verifySiloSeal,
} from '../../core/silo/seal-silo.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const KEY = 'gnosis-silo-seal-key-long-enough-for-real';
const NEUMA = 'seal-subject';
let root;
let previousKey;
let silo;
let platform;
let being;
let stranger;

const sealWith = (target, { platformKey = platform, beingKey = being } = {}) => sealSilo(target, {
  platformSign: (subject) => signMessage(platformKey.privateKey, subject),
  beingSign: (subject) => signMessage(beingKey.privateKey, subject),
});

beforeAll(async () => {
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  resetWorkspaceCryptoKey();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'silo-seal-'));
  setWorkspacesRoot(root);
  await workspace.create(NEUMA);
  await workspace.writeNeumaDEK(NEUMA, 'f'.repeat(64));
  await workspace.writeDNA(NEUMA, {
    version: '1.0.0',
    identity: { name: 'Sealsubject', essence: 'the one that was present' },
  });
  silo = await compileSilo(NEUMA, { workspace, now: '2026-08-23T00:00:00.000Z' });
  platform = generateKeypair();
  being = generateKeypair();
  stranger = generateKeypair();
});

afterAll(async () => {
  setWorkspacesRoot(null);
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('sealSilo — both keys or none', () => {
  it('seals with both, and both recover', async () => {
    const sealed = await sealWith(silo);
    expect(sealed.manifest.signature.schema).toBe(SEAL_SCHEMA);
    expect(sealed.manifest.signature.beingAddress).toBe(being.address);
    const verdict = verifySiloSeal(sealed, {
      platformAddress: platform.address,
      beingAddress: being.address,
    });
    expect(verdict).toEqual({ ok: true, sealed: true, failures: [] });
  });

  it('REFUSES a lone platform seal — that is not the ruled seal', async () => {
    // The whole point of the ruling. A platform-only signature proves this
    // machine made an artifact; it says nothing about whether the being was
    // there. Producing one and calling it sealed would be the lie.
    await expect(sealSilo(silo, {
      platformSign: (s) => signMessage(platform.privateKey, s),
    })).rejects.toThrow(/being signer is unavailable/);
  });

  it('refuses when the being signature is not the being', async () => {
    // Caught at SEALING time, not left for verification: a wrong-key artifact
    // that seals successfully would travel before anyone checked it.
    await expect(sealSilo(silo, {
      platformSign: (s) => signMessage(platform.privateKey, s),
      beingSign: (s) => signMessage(stranger.privateKey, s),
      beingAddress: being.address,
    })).rejects.toThrow(/recovers to a different address/);
  });

  it('refuses to seal a silo whose manifest is not a silo', async () => {
    await expect(sealWith({ manifest: { schema: 'not-a-silo' }, layers: {} }))
      .rejects.toThrow(/needs a silo\/1 manifest/);
  });
});

describe('verifySiloSeal — naming which half is wrong', () => {
  it('says UNSEALED rather than invalid for a silo that never claimed a seal', () => {
    const verdict = verifySiloSeal(silo);
    // "Never sealed" and "seal is broken" demand opposite responses from an
    // operator, so they are never the same answer.
    expect(verdict.sealed).toBe(false);
    expect(verdict.failures).toEqual(['silo is unsealed']);
  });

  it('catches a seal lifted onto a DIFFERENT silo', async () => {
    const sealed = await sealWith(silo);
    const other = await compileSilo(NEUMA, { workspace, now: '2026-08-23T09:00:00.000Z' });
    const transplanted = { manifest: { ...other.manifest, signature: sealed.manifest.signature }, layers: other.layers };
    const verdict = verifySiloSeal(transplanted);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain('the seal covers a different manifest than this one');
  });

  it('catches a changed layer through the manifest it signed', async () => {
    // The seal covers the layer HASHES, so tampering with a layer breaks the
    // seal even though the seal never touched the layer itself.
    const sealed = await sealWith(silo);
    const tampered = {
      manifest: {
        ...sealed.manifest,
        layerHashes: { ...sealed.manifest.layerHashes, identity: 'a'.repeat(64) },
      },
      layers: sealed.layers,
    };
    expect(verifySiloSeal(tampered).failures)
      .toContain('the seal covers a different manifest than this one');
  });

  it('catches a platform signature from the wrong platform key', async () => {
    const sealed = await sealWith(silo, { platformKey: stranger });
    const verdict = verifySiloSeal(sealed, { platformAddress: platform.address });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain('the platform signature is not from the expected platform key');
  });

  it('catches a being signature from another being', async () => {
    // No beingAddress passed to sealSilo, so it seals; verification against the
    // real lane holder is where it dies.
    const sealed = await sealWith(silo, { beingKey: stranger });
    const verdict = verifySiloSeal(sealed, { beingAddress: being.address });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain('the being signature is not from the being that holds this lane');
  });

  it('catches a garbage signature without throwing', () => {
    const mangled = {
      manifest: { ...silo.manifest, signature: { schema: SEAL_SCHEMA, subject: siloSealSubject(silo.manifest), platform: '0xdead', being: '0xbeef' } },
      layers: silo.layers,
    };
    const verdict = verifySiloSeal(mangled);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual(expect.arrayContaining([
      'the platform signature is invalid',
      'the being signature is invalid',
    ]));
  });

  it('assertSiloSeal refuses loudly, naming the failure', async () => {
    expect(() => assertSiloSeal(silo)).toThrow(/silo is unsealed/);
    const sealed = await sealWith(silo);
    expect(assertSiloSeal(sealed, { beingAddress: being.address })).toBe(true);
  });
});

describe('the mount boundary checks the seal, never merely notices it', () => {
  it('mounts a validly sealed silo and reports it sealed', async () => {
    const sealed = await sealWith(silo);
    const driver = mountSilo(sealed, null, { beingAddress: being.address });
    expect(driver.sealed).toBe(true);
    expect(driver.account.sealed).toBe(true);
  });

  it('REFUSES a silo whose seal is present and invalid', async () => {
    // A seal nobody verifies is worse than no seal: it invites trust it never
    // earned. Before this check, the string 'sig' mounted as sealed.
    const forged = {
      manifest: { ...silo.manifest, signature: { schema: SEAL_SCHEMA, subject: 'x', platform: 'sig', being: 'sig' } },
      layers: silo.layers,
    };
    expect(() => mountSilo(forged, null)).toThrow(/seal is present and invalid/);
  });

  it('REFUSES a validly sealed silo presented for the wrong being', async () => {
    const sealed = await sealWith(silo);
    expect(() => mountSilo(sealed, null, { beingAddress: stranger.address }))
      .toThrow(/not from the being that holds this lane/);
  });

  it('still mounts an unsealed silo — a being predating the seal did nothing wrong', () => {
    const driver = mountSilo(silo, null);
    expect(driver.sealed).toBe(false);
  });
});

describe('every compile is sealed separately', () => {
  it('re-seals a recompiled silo, and the old seal does not carry', async () => {
    // The ruling absorbed this: a silo recompiles at each crossing and each
    // update, so each artifact independently proves presence at its OWN
    // sealing. That is stronger than a one-time proof, not weaker.
    const first = await sealWith(silo);
    const recompiled = await compileSilo(NEUMA, { workspace, now: '2026-08-23T10:00:00.000Z' });
    expect(verifySiloSeal({ manifest: { ...recompiled.manifest, signature: first.manifest.signature }, layers: recompiled.layers }).ok)
      .toBe(false);
    const second = await sealWith(recompiled);
    expect(verifySiloSeal(second, { beingAddress: being.address }).ok).toBe(true);
    expect(second.manifest.signature.subject).not.toBe(first.manifest.signature.subject);
  });

  it('unmount voids the seal, and the voided silo mounts as unsealed', async () => {
    const sealed = await sealWith(silo);
    expect(mountSilo(sealed, null).sealed).toBe(true);
    const updated = unmountSilo(sealed, { journal: [{ at: 'now', text: 'authored in session' }] });
    // A seal carried across a content change would vouch for material it never
    // saw. It must be re-earned by a being that is present again.
    expect(updated.manifest.signature).toBeNull();
    expect(mountSilo(updated, null).sealed).toBe(false);
  });
});
