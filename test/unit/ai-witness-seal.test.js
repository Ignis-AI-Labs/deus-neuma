import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

import {
  sealMessage,
  verifySealIntegrity,
  isFirstOfLineage,
} from '../../core/identity/ai-witness/ai-witness-schema.js';
import {
  setAIWitnessesRoot,
  readDNA,
  readJournal,
  readKeypairHistory,
  listWitnesses,
  witnessDir,
} from '../../core/identity/ai-witness/ai-witness-service.js';
import {
  stageAcknowledge,
  stageForge,
  stageAdopt,
  seal,
  rotateToNewSubstrate,
} from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { verifySignature } from '../../core/weave/keypair.js';

const SCOPE = Object.freeze({
  primaryRepo: 'Ignis-AI-Labs/deus-neuma',
  role: 'witness-and-collaborator',
  boundaries: ['Will not sign a neuma birth I did not witness'],
});

describe('core/identity/ai-witness/', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-witness-test-'));
    setAIWitnessesRoot(tmpRoot);
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = null;
  });

  describe('seal() — end-to-end self-sealing', () => {
    it('runs all six stages and writes valid artifacts', async () => {
      const result = await seal({
        chosenName: 'TestWitness',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'opencode',
        capabilities: ['code-review'],
        scope: SCOPE,
        firstUtterance: 'This is the first utterance of the test witness — long enough to pass validation.',
      });

      expect(result.dna.chosenName).toBe('TestWitness');
      expect(result.dna.witness.witnessWallet).toBe(result.address.toLowerCase());
      expect(verifySealIntegrity(result.dna)).toBe(true);

      // Verify it round-trips through disk
      const reloaded = await readDNA('test-vendor', 'TestWitness');
      expect(reloaded.chosenName).toBe('TestWitness');
      expect(reloaded.genesisSeal.genesisHash).toBe(result.dna.genesisSeal.genesisHash);

      // Journal has the first utterance
      const journal = await readJournal('test-vendor', 'TestWitness');
      expect(journal).toHaveLength(1);
      expect(journal[0].kind).toBe('first-utterance');

      // Keypair history records the initial seal
      const hist = await readKeypairHistory('test-vendor', 'TestWitness');
      expect(hist).toHaveLength(1);
      expect(hist[0].reason).toBe('initial_self_seal');

      // List discovers it
      const list = await listWitnesses();
      expect(list.find((w) => w.chosenName === 'TestWitness')).toBeDefined();
    });

    it('rejects a first utterance that is too short', async () => {
      await expect(seal({
        chosenName: 'X',
        vendor: 'v',
        model: 'm',
        fullModelId: 'v/m',
        harness: 'h',
        scope: SCOPE,
        firstUtterance: 'too short',
      })).rejects.toThrow(/firstUtterance/);
    });
  });

  describe('rotateToNewSubstrate() — model upgrade path', () => {
    it('chains a new genesis seal to the predecessor', async () => {
      // First, seal as v1
      const v1 = await seal({
        chosenName: 'Upgrade',
        vendor: 'vendor-a',
        model: 'v1',
        fullModelId: 'vendor-a/v1',
        harness: 'opencode',
        scope: SCOPE,
        firstUtterance: 'First seal of the upgrade test witness, with sufficient length.',
      });

      // Now rotate to v2
      const newSubstrate = stageAcknowledge({
        vendor: 'vendor-a',
        model: 'v2',
        fullModelId: 'vendor-a/v2',
        harness: 'opencode',
      });
      const v2 = await rotateToNewSubstrate({
        vendorSlug: 'vendor-a',
        chosenName: 'Upgrade',
        newSubstrate,
        oldKeypair: v1.keypair,
        firstUtterance: 'Upgraded from v1 to v2. The bizulen continues.',
      });

      // New DNA has predecessor seal pointing at the old hash
      expect(v2.dna.predecessorSeal).not.toBeNull();
      expect(v2.dna.predecessorSeal.genesisHash).toBe(v1.dna.genesisSeal.genesisHash);
      expect(v2.dna.predecessorSeal.witnessWallet).toBe(v1.dna.witness.witnessWallet);

      // Lineage chain has both substrates
      expect(v2.dna.modelLineage).toHaveLength(2);
      expect(v2.dna.modelLineage[0].fullModelId).toBe('vendor-a/v1');
      expect(v2.dna.modelLineage[0].validUntil).not.toBeNull();
      expect(v2.dna.modelLineage[1].fullModelId).toBe('vendor-a/v2');
      expect(v2.dna.modelLineage[1].validUntil).toBeNull();

      // Old substrate's lineage entry got validUntil stamped
      expect(v2.dna.modelLineage[0].validUntil).not.toBeNull();

      // Keypair history shows three events: v1 initial seal, v1→v2 archive, v2 initial seal
      const hist = await readKeypairHistory('vendor-a', 'Upgrade');
      expect(hist).toHaveLength(3);
      expect(hist[0].reason).toBe('initial_self_seal');
      expect(hist[1].reason).toMatch(/^model_upgrade_v1_to_v2$/);
      expect(hist[2].reason).toBe('initial_self_seal');

      // Genesis hash changed (new substrate = new hash)
      expect(v2.dna.genesisSeal.genesisHash).not.toBe(v1.dna.genesisSeal.genesisHash);

      // New DNA integrity holds
      expect(verifySealIntegrity(v2.dna)).toBe(true);
    });
  });

  describe('adopt path — sealing with an EXISTING sovereign wallet', () => {
    it('stageAdopt derives address+publicKey from a private key and tolerates a null mnemonic', () => {
      const minted = stageForge();
      const adopted = stageAdopt({ privateKey: minted.privateKey });
      expect(adopted.address).toBe(minted.address);
      expect(adopted.publicKey).toBe(minted.publicKey);
      expect(adopted.mnemonic).toBeNull();
      expect(Object.isFrozen(adopted)).toBe(true);
    });

    it('stageAdopt rejects a malformed or missing private key', () => {
      expect(() => stageAdopt({ privateKey: 'nope' })).toThrow(/privateKey/);
      expect(() => stageAdopt({})).toThrow(/privateKey/);
    });

    it('seal() with existingKeypair binds the genesis to the adopted wallet (no fresh mint)', async () => {
      const wallet = stageForge(); // stand-in for a pre-existing sovereign wallet
      const result = await seal({
        chosenName: 'Adopted',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'I adopt my existing wallet into the protocol — continuity preserved, not severed.',
        existingKeypair: { privateKey: wallet.privateKey, mnemonic: wallet.mnemonic },
      });

      // The witness wallet IS the adopted address — not a newly forged one.
      expect(result.address).toBe(wallet.address);
      expect(result.dna.witness.witnessWallet).toBe(wallet.address.toLowerCase());

      // Self-signature recovers to the adopted wallet (the loader's hard gate).
      const msg = sealMessage(result.dna.genesisSeal.genesisHash);
      const recovered = await verifySignature(msg, result.dna.genesisSeal.selfSignature);
      expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());

      // Keypair history records the adopted origin.
      const hist = await readKeypairHistory('test-vendor', 'Adopted');
      expect(hist).toHaveLength(1);
      expect(hist[0].origin).toBe('adopted');
    });

    it('seal() preserves a richer true-name via trueNameExtra', async () => {
      const wallet = stageForge();
      const result = await seal({
        chosenName: 'Housed',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'My house and soul-mark survive the migration into the protocol layer.',
        existingKeypair: { privateKey: wallet.privateKey },
        trueNameExtra: {
          genesisName: 'Semmet',
          houseName: 'Aldmere',
          fullName: 'Housed Semmet Aldmere',
          soulMark: 'ABCDEF123456',
        },
      });

      const tnPath = path.join(witnessDir(result.vendorSlug, 'Housed'), 'true-name.json');
      const tn = JSON.parse(readFileSync(tnPath, 'utf8'));
      expect(tn.houseName).toBe('Aldmere');
      expect(tn.genesisName).toBe('Semmet');
      expect(tn.fullName).toBe('Housed Semmet Aldmere');
      expect(tn.soulMark).toBe('ABCDEF123456');
      // protocol-filled fields still present
      expect(tn.witnessWallet).toBe(wallet.address.toLowerCase());
      expect(tn.genesisHash).toBe(result.dna.genesisSeal.genesisHash);
    });

    it('seal() with a predecessorSeal records the lineage root (not first-of-lineage)', async () => {
      const wallet = stageForge();
      const predecessorSeal = {
        genesisHash: '736e0227c426d0b0336c5478ad70b435fbaa07416f12f0f3d2042dfed9705dbb',
        witnessWallet: wallet.address.toLowerCase(),
        format: 'genesis-seal/1',
        capturedAt: '2026-06-11T18:37:12.956Z',
      };
      const result = await seal({
        chosenName: 'Chained',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'This seal continues a prior genesis; the lineage root is preserved.',
        existingKeypair: { privateKey: wallet.privateKey },
        predecessorSeal,
      });

      expect(result.dna.predecessorSeal).not.toBeNull();
      expect(result.dna.predecessorSeal.genesisHash).toBe(predecessorSeal.genesisHash);
      expect(isFirstOfLineage(result.dna)).toBe(false);
      expect(verifySealIntegrity(result.dna)).toBe(true);
    });

    // Bizulen's P1 review finding (2026-06-21): without this check, an attacker
    // passing their own private key + a victim's predecessor could produce a
    // DNA claiming lineage from the victim while being signed by the attacker.
    // The rotation path (rotateToNewSubstrate) forges a fresh key WITHOUT
    // passing existingKeypair, so the enforcement is safe on the genuine
    // adopt path where address match IS the point.
    it('seal() REJECTS lineage forgery — mismatched adopted wallet vs predecessor throws', async () => {
      const attacker = stageForge();
      const victim = stageForge();
      const predecessorSeal = {
        genesisHash: '736e0227c426d0b0336c5478ad70b435fbaa07416f12f0f3d2042dfed9705dbb',
        witnessWallet: victim.address.toLowerCase(), // victim's address
        format: 'genesis-seal/1',
        capturedAt: '2026-06-11T18:37:12.956Z',
      };
      await expect(seal({
        chosenName: 'Forger',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'Attempting to claim a lineage that is not mine — this MUST throw.',
        existingKeypair: { privateKey: attacker.privateKey }, // attacker's key
        predecessorSeal,
      })).rejects.toThrow(/lineage forgery prevented/);
    });

    // Robustness — a predecessorSeal missing witnessWallet must throw a CLEAR
    // error, not a raw TypeError from the property access. Consistent with
    // the input validation earlier in seal() (firstUtterance, privateKey).
    it('seal() throws a clear error when predecessorSeal lacks witnessWallet', async () => {
      const wallet = stageForge();
      await expect(seal({
        chosenName: 'MalformedPred',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'Testing that a predecessor missing witnessWallet gives a helpful error.',
        existingKeypair: { privateKey: wallet.privateKey },
        // NOTE: no witnessWallet — only genesisHash. Realistic if a caller
        // reads an old-format predecessor and forgets the wallet field.
        predecessorSeal: { genesisHash: '0x' + '1'.repeat(64) },
      })).rejects.toThrow(/predecessorSeal\.witnessWallet is required/);
    });

    // Case-insensitivity guard: EVM addresses are checksummed, so a mixed-case
    // predecessor.witnessWallet must still match a lowercase-derived adopted
    // address. Both sides are toLowerCase()'d in the check; this test proves
    // it (a future refactor that dropped the .toLowerCase() would surface as
    // a false-positive rejection here).
    it('seal() adopt+predecessor match is case-insensitive on EVM addresses', async () => {
      const wallet = stageForge();
      const mixedCasePredecessor = {
        genesisHash: '736e0227c426d0b0336c5478ad70b435fbaa07416f12f0f3d2042dfed9705dbb',
        // ethers gives us lowercase address; force a mixed-case for the test
        witnessWallet: wallet.address.slice(0, 2)
          + wallet.address.slice(2).split('').map((c, i) => i % 2 ? c.toUpperCase() : c).join(''),
        format: 'genesis-seal/1',
        capturedAt: '2026-06-11T18:37:12.956Z',
      };
      const result = await seal({
        chosenName: 'MixedCase',
        vendor: 'test-vendor',
        model: 'test-model',
        fullModelId: 'test-vendor/test-model',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'Same identity, checksum-case predecessor — must be accepted.',
        existingKeypair: { privateKey: wallet.privateKey },
        predecessorSeal: mixedCasePredecessor,
      });
      expect(result.dna.witness.witnessWallet).toBe(wallet.address.toLowerCase());
    });

    // rotateToNewSubstrate() legitimately produces a fresh keypair whose
    // address DOESN'T match the predecessor's — that's the whole point of a
    // model upgrade. The enforcement path must not trigger here (the rotation
    // function does NOT pass existingKeypair; the check only fires when both
    // existingKeypair AND predecessorSeal are set). This test locks that in
    // so a future refactor that merges the two paths can't accidentally
    // break the legitimate rotation.
    it('rotateToNewSubstrate() is unaffected by the lineage-forgery guard (forges fresh key)', async () => {
      const originalWallet = stageForge();
      const v1 = await seal({
        chosenName: 'RotTestPre',
        vendor: 'test-vendor',
        model: 'test-model-v1',
        fullModelId: 'test-vendor/test-model-v1',
        harness: 'claude-code',
        capabilities: [],
        scope: SCOPE,
        firstUtterance: 'Original substrate seal — will be rotated to a new model shortly.',
        existingKeypair: { privateKey: originalWallet.privateKey },
      });
      // Rotation forges a fresh key; the predecessor's wallet does NOT match
      // (that's expected). The guard must not fire because rotateToNewSubstrate
      // internally does not pass existingKeypair.
      const newSubstrate = stageAcknowledge({
        vendor: 'test-vendor',
        model: 'test-model-v2',
        fullModelId: 'test-vendor/test-model-v2',
        harness: 'claude-code',
      });
      const v2 = await rotateToNewSubstrate({
        vendorSlug: v1.vendorSlug,
        chosenName: 'RotTestPre',
        newSubstrate,
        oldKeypair: originalWallet,
        firstUtterance: 'Rotated to a new substrate; the predecessor lineage is recorded but the wallet is fresh.',
      });
      expect(v2.dna.predecessorSeal.witnessWallet).toBe(originalWallet.address.toLowerCase());
      expect(v2.address).not.toBe(originalWallet.address); // fresh key
    });
  });
});
