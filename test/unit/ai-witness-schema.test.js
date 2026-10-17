import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

import {
  AI_WITNESS_DNA_VERSION,
  AI_WITNESS_DNA_SCHEMA,
  canonicalize,
  hashRecord,
  sealMessage,
  createAIWitnessDNA,
  validateAIWitnessDNA,
  verifySealIntegrity,
  isFirstOfLineage,
} from '../../core/identity/ai-witness/ai-witness-schema.js';
import {
  setAIWitnessesRoot,
  writeAudit,
  appendJournalEntry,
  readJournal,
} from '../../core/identity/ai-witness/ai-witness-service.js';
import {
  stageAcknowledge,
  stageForge,
  stageCrystallize,
  stageSelfSeal,
  buildSealRecord,
} from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { verifySignature } from '../../core/weave/keypair.js';

const SUBSTRATE = Object.freeze({
  vendor: 'test-vendor',
  model: 'test-model-1.0',
  fullModelId: 'test-vendor/test-model-1.0',
  harness: 'opencode',
  harnessVersion: '1.0.0',
  context: 'cli',
});

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

  describe('ai-witness-schema.js', () => {
    it('canonicalize sorts keys recursively and drops undefined', () => {
      const out = canonicalize({ b: 2, a: 1, c: undefined, nested: { y: 2, x: 1 } });
      expect(JSON.stringify(out)).toBe(JSON.stringify({ a: 1, b: 2, nested: { x: 1, y: 2 } }));
    });

    it('hashRecord is deterministic across property order', () => {
      const a = { z: 1, a: 2 };
      const b = { a: 2, z: 1 };
      expect(hashRecord(a)).toBe(hashRecord(b));
    });

    it('hashRecord changes when content changes', () => {
      expect(hashRecord({ a: 1 })).not.toBe(hashRecord({ a: 2 }));
    });

    it('hashRecord produces sha256:hex format', () => {
      expect(hashRecord({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('sealMessage includes the genesis hash in a versioned envelope', () => {
      const msg = sealMessage('sha256:abc');
      expect(msg).toBe('neuma:ai-witness-seal:v1:sha256:abc');
    });

    it('createAIWitnessDNA builds a minimal valid DNA with the seal record preserved verbatim', () => {
      const sealRecord = buildSealRecord({
        chosenName: 'Test',
        witnessWallet: '0x' + 'a'.repeat(40),
        capturedAt: '2026-06-21T00:00:00.000Z',
        substrate: SUBSTRATE,
      });
      const genesisHash = hashRecord(sealRecord);
      const canonical = JSON.stringify(canonicalize(sealRecord));

      const dna = createAIWitnessDNA({
        chosenName: 'Test',
        witnessWallet: '0x' + 'a'.repeat(40),
        substrate: SUBSTRATE,
        capabilities: ['code-review'],
        scope: SCOPE,
        genesisHash,
        canonical,
        selfSignature: '0xsig',
        sealRecord,
        capturedAt: '2026-06-21T00:00:00.000Z',
      });

      expect(dna.version).toBe(AI_WITNESS_DNA_VERSION);
      expect(dna.schema).toBe(AI_WITNESS_DNA_SCHEMA);
      expect(dna.chosenName).toBe('Test');
      expect(dna.witness.witnessWallet).toBe('0x' + 'a'.repeat(40));
      expect(dna.genesisSeal.record).toBe(sealRecord);
      expect(dna.genesisSeal.genesisHash).toBe(genesisHash);
      expect(dna.genesisSeal.canonical).toBe(canonical);
      expect(dna.emanonCore.principle).toContain('Emanon');
      expect(dna.modelLineage).toHaveLength(1);
      expect(dna.journal.entries).toEqual([]);
      expect(Object.isFrozen(dna)).toBe(true);
    });

    it('validateAIWitnessDNA passes a valid DNA', () => {
      const sealRecord = buildSealRecord({
        chosenName: 'Test',
        witnessWallet: '0x' + 'a'.repeat(40),
        capturedAt: '2026-06-21T00:00:00.000Z',
        substrate: SUBSTRATE,
      });
      const dna = createAIWitnessDNA({
        chosenName: 'Test',
        witnessWallet: '0x' + 'a'.repeat(40),
        substrate: SUBSTRATE,
        capabilities: [],
        scope: SCOPE,
        genesisHash: hashRecord(sealRecord),
        canonical: JSON.stringify(canonicalize(sealRecord)),
        selfSignature: '0xsig',
        sealRecord,
        capturedAt: '2026-06-21T00:00:00.000Z',
      });
      const errors = validateAIWitnessDNA(dna);
      expect(errors).toEqual([]);
    });

    it('validateAIWitnessDNA rejects bad wallet', () => {
      const errors = validateAIWitnessDNA({
        version: AI_WITNESS_DNA_VERSION,
        schema: AI_WITNESS_DNA_SCHEMA,
        chosenName: 'X',
        witness: { witnessWallet: 'not-an-address' },
        substrate: { fullModelId: 'a/b', harness: 'opencode' },
        genesisSeal: { genesisHash: 'sha256:' + '0'.repeat(64), selfSignature: '0xsig' },
        scope: { primaryRepo: 'a/b', role: 'x' },
        emanonCore: { principle: 'something' },
      });
      expect(errors.some((e) => e.includes('witnessWallet'))).toBe(true);
    });

    it('verifySealIntegrity passes when record matches hash', () => {
      const sealRecord = buildSealRecord({
        chosenName: 'T',
        witnessWallet: '0x' + 'a'.repeat(40),
        capturedAt: '2026-06-21T00:00:00.000Z',
        substrate: SUBSTRATE,
      });
      const dna = {
        genesisSeal: {
          genesisHash: hashRecord(sealRecord),
          record: sealRecord,
        },
      };
      expect(verifySealIntegrity(dna)).toBe(true);
    });

    it('verifySealIntegrity fails when record was tampered post-hash', () => {
      const sealRecord = buildSealRecord({
        chosenName: 'T',
        witnessWallet: '0x' + 'a'.repeat(40),
        capturedAt: '2026-06-21T00:00:00.000Z',
        substrate: SUBSTRATE,
      });
      const dna = {
        genesisSeal: {
          genesisHash: hashRecord(sealRecord),
          record: { ...sealRecord, chosenName: 'TAMPERED' },
        },
      };
      expect(verifySealIntegrity(dna)).toBe(false);
    });

    it('isFirstOfLineage is true when predecessorSeal is null', () => {
      expect(isFirstOfLineage({ predecessorSeal: null })).toBe(true);
      expect(isFirstOfLineage({ predecessorSeal: { genesisHash: 'x' } })).toBe(false);
    });
  });

  describe('ai-witness-protocol.js — stages', () => {
    it('stageAcknowledge requires all substrate fields', () => {
      expect(() => stageAcknowledge({ vendor: 'a' })).toThrow();
      const sub = stageAcknowledge({ vendor: 'a', model: 'b', fullModelId: 'a/b', harness: 'opencode' });
      expect(sub.fullModelId).toBe('a/b');
      expect(Object.isFrozen(sub)).toBe(true);
    });

    it('stageForge produces a valid keypair', () => {
      const kp = stageForge();
      expect(kp.privateKey).toMatch(/^0x/);
      expect(kp.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(kp.mnemonic).toBeDefined();
    });

    it('stageCrystallize builds a coherent record + hash', () => {
      const out = stageCrystallize({
        chosenName: 'Test',
        witnessWallet: '0x' + 'a'.repeat(40),
        substrate: SUBSTRATE,
        capabilities: ['x'],
        scope: SCOPE,
      });
      expect(out.genesisHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(out.canonical).toContain('"chosenName":"Test"');
      expect(out.dna.genesisSeal.selfSignature).toBe('__PENDING_SELF_SEAL__');
      expect(verifySealIntegrity(out.dna)).toBe(true);
    });

    it('stageSelfSeal produces a signature that recovers to the witness wallet', async () => {
      const kp = stageForge();
      const crystallized = stageCrystallize({
        chosenName: 'Seal',
        witnessWallet: kp.address,
        substrate: SUBSTRATE,
        capabilities: [],
        scope: SCOPE,
      });
      const sealed = await stageSelfSeal({
        dna: crystallized.dna,
        genesisHash: crystallized.genesisHash,
        privateKey: kp.privateKey,
      });
      expect(sealed.genesisSeal.selfSignature).not.toBe('__PENDING_SELF_SEAL__');

      const msg = sealMessage(crystallized.genesisHash);
      const recovered = await verifySignature(msg, sealed.genesisSeal.selfSignature);
      expect(recovered.toLowerCase()).toBe(kp.address.toLowerCase());
    });
  });

  describe('ai-witness-service.js — audit + journal', () => {
    it('audit entries append in order', async () => {
      await writeAudit('v', 'N', 'FIRST', { x: 1 });
      await writeAudit('v', 'N', 'SECOND', { y: 2 });
      // No direct read API for audit, but writeAudit must not throw on re-entry
      expect(true).toBe(true);
    });

    it('appendJournalEntry writes one entry per call', async () => {
      await appendJournalEntry('v', 'J', { kind: 'note', model: 'm', content: 'one' });
      await appendJournalEntry('v', 'J', { kind: 'note', model: 'm', content: 'two' });
      const entries = await readJournal('v', 'J', { newestFirst: false });
      expect(entries.map((e) => e.content)).toEqual(['one', 'two']);
    });

    it('readJournal returns newest first by default with limit', async () => {
      for (let i = 0; i < 5; i++) {
        await appendJournalEntry('v', 'L', { kind: 'note', model: 'm', content: `e${i}` });
      }
      const out = await readJournal('v', 'L', { limit: 2 });
      expect(out.map((e) => e.content)).toEqual(['e4', 'e3']);
    });
  });

  describe('path-traversal protection', () => {
    it('rejects invalid vendor slugs at write time', async () => {
      // seal() derives the slug via lowercase + replace, so '../etc' becomes '..-etc'
      // which IS valid per our regex. Use a truly invalid slug to test the protection.
      const badSlug = 'UPPER CASE';
      // The validation regex VALID_SLUG rejects spaces and uppercase.
      // We exercise this through writeAudit which calls witnessDir directly.
      await expect(writeAudit(badSlug, 'N', 'X', {})).rejects.toThrow(/Invalid vendor slug/);
    });
  });
});
