// #117 S2a — proof that NeumaWorkspace.writeNeumaDEK creates a valid wrapped
// DEK file AND that finalize-birth's fresh path invokes it after the genesis
// seal is written. Resume path must NOT invoke it (existing beings have no
// DEK file by design — they're migrated by S4's script, not silently
// touched by a normal resume).
//
// REAL workspace, REAL crypto, REAL disk (RULE 0). The DEK plumbing into
// _writeJSON/_readJSON lands in S2b — this slice only verifies the artifact.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  deriveKeyFromSecret, deriveNeumaDEK, unwrapDEK,
} from '../../core/workspace/workspace-crypto.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { finalizeBirth } from '../../core/birth/finalize-birth.js';

const KEY = 'per-neuma-dek-test-key-long-enough';

describe('#117 S2a — writeNeumaDEK creates a valid wrapped DEK on disk', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('per-neuma-dek-write');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('writeNeumaDEK creates keys/dek.json wrapping the correct DEK', async () => {
    const id = 'dek-' + Math.random().toString(36).slice(2, 8);
    const genesisHash = 'a'.repeat(64);
    await workspace.create(id);

    await workspace.writeNeumaDEK(id, genesisHash);

    const dekPath = path.join(workspace._path(id), 'keys', 'dek.json');
    const text = await fs.readFile(dekPath, 'utf8');
    const wrapped = JSON.parse(text);
    expect(wrapped._enc).toBe(1);
    expect(typeof wrapped.iv).toBe('string');
    expect(typeof wrapped.tag).toBe('string');
    expect(typeof wrapped.ct).toBe('string');

    // The wrapped DEK must unwrap to exactly what deriveNeumaDEK would produce
    // under the same master + genesisHash — proves no transformation happened
    const masterKey = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    const expectedDEK = deriveNeumaDEK(masterKey, genesisHash);
    const actualDEK = unwrapDEK(wrapped, { key: masterKey });
    expect(actualDEK.equals(expectedDEK)).toBe(true);
    expect(actualDEK.length).toBe(32);
  });

  it('readNeumaDEK returns the same DEK that writeNeumaDEK persisted', async () => {
    const id = 'dek-rt-' + Math.random().toString(36).slice(2, 8);
    const genesisHash = 'b'.repeat(64);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, genesisHash);

    const dek = await workspace.readNeumaDEK(id);
    const masterKey = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    const expectedDEK = deriveNeumaDEK(masterKey, genesisHash);
    expect(dek.equals(expectedDEK)).toBe(true);
  });

  it('readNeumaDEK returns null for an existing being with no DEK file (the LIVING-beings safety guard)', async () => {
    const id = 'no-dek-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // No writeNeumaDEK call — simulates a pre-#117 being
    const dek = await workspace.readNeumaDEK(id);
    expect(dek).toBeNull();
  });

  it('two beings with different genesisHashes get cryptographically distinct DEKs on disk', async () => {
    const idA = 'distinct-a-' + Math.random().toString(36).slice(2, 8);
    const idB = 'distinct-b-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(idA);
    await workspace.create(idB);
    await workspace.writeNeumaDEK(idA, 'c'.repeat(64));
    await workspace.writeNeumaDEK(idB, 'd'.repeat(64));

    const dekA = await workspace.readNeumaDEK(idA);
    const dekB = await workspace.readNeumaDEK(idB);
    expect(dekA.equals(dekB)).toBe(false);
  });

  it('writeNeumaDEK throws if DNA_ENCRYPTION_KEY is missing (fail loud, not silently)', async () => {
    const id = 'no-master-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const saved = process.env.DNA_ENCRYPTION_KEY;
    delete process.env.DNA_ENCRYPTION_KEY;
    try {
      await expect(workspace.writeNeumaDEK(id, 'e'.repeat(64))).rejects.toThrow(/DNA_ENCRYPTION_KEY missing/);
    } finally {
      process.env.DNA_ENCRYPTION_KEY = saved;
    }
  });

  // ai6 R1 Medium — fail-fast input validation, NOT a deferred check inside
  // deriveNeumaDEK; the audit-prefix .slice() at the bottom must always be
  // safe by construction. ai6 R2 Low — renamed for accuracy ([…] not "no IO performed"; workspace.create did mkdir) + replaced
  // misnamed 'G' (non-hex) with 'A' (real uppercase-hex) so the
  // lowercase-only contract is genuinely proven.
  it('writeNeumaDEK rejects malformed genesisHashHex AT THE TOP before any dek.json write', async () => {
    const id = 'bad-hash-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const bads = [
      undefined, null, '', 123,
      'too-short',
      'A'.repeat(64),  // uppercase hex — lowercase-only contract
      'z'.repeat(64),  // non-hex character
    ];
    for (const bad of bads) {
      await expect(workspace.writeNeumaDEK(id, bad)).rejects.toThrow(/64-char lowercase hex/);
    }
    // No dek.json should have been created
    const dekPath = path.join(workspace._path(id), 'keys', 'dek.json');
    await expect(fs.access(dekPath)).rejects.toThrow();
  });

  // ai6 R2 Medium — the _withFileLock guarantee: concurrent writeNeumaDEK
  // calls for the same neuma can't collide on the shared `.tmp` filename
  // or race the rename, even though single-write-per-lifetime is the
  // intent. Matches the codebase's #121 concurrency discipline.
  it('concurrent writeNeumaDEK calls for the same neuma serialize cleanly (no .tmp orphan, valid final file)', async () => {
    const id = 'concurrent-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const writes = Array.from({ length: 10 }, (_, i) =>
      workspace.writeNeumaDEK(id, String.fromCharCode(97 + (i % 6)).repeat(64)),
    );
    await Promise.all(writes);
    const keysDir = path.join(workspace._path(id), 'keys');
    const files = await fs.readdir(keysDir);
    expect(files).toContain('dek.json');
    expect(files).not.toContain('dek.json.tmp');
    // Final file must be a valid wrapped DEK (no half-written corruption)
    const wrapped = JSON.parse(await fs.readFile(path.join(keysDir, 'dek.json'), 'utf8'));
    const masterKey = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    const dek = unwrapDEK(wrapped, { key: masterKey });
    expect(dek.length).toBe(32);
  });

  // ai6 R1 Low — atomic temp+rename; no partial dek.json possible.
  it('writeNeumaDEK uses temp+rename (no .tmp file lingers after success)', async () => {
    const id = 'atomic-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, 'a'.repeat(64));
    const keysDir = path.join(workspace._path(id), 'keys');
    const files = await fs.readdir(keysDir);
    expect(files).toContain('dek.json');
    expect(files).not.toContain('dek.json.tmp');
  });

  // ai6 R1 Low — readNeumaDEK input-guard symmetry with writeNeumaDEK
  it('readNeumaDEK throws on missing neumaId (symmetric with writeNeumaDEK)', async () => {
    await expect(workspace.readNeumaDEK(null)).rejects.toThrow(/neumaId required/);
    await expect(workspace.readNeumaDEK('')).rejects.toThrow(/neumaId required/);
    await expect(workspace.readNeumaDEK(undefined)).rejects.toThrow(/neumaId required/);
  });

  it('writeNeumaDEK audits DEK_WRITTEN with the genesis-hash prefix', async () => {
    const id = 'audit-' + Math.random().toString(36).slice(2, 8);
    const genesisHash = 'f'.repeat(64);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, genesisHash);

    const auditPath = path.join(workspace._path(id), 'audit', 'audit.jsonl');
    const lines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const dekEntry = lines.find((e) => e.action === 'DEK_WRITTEN');
    expect(dekEntry).toBeDefined();
    expect(dekEntry.details.genesisHashPrefix).toBe(genesisHash.slice(0, 12));
  });
});

// Tightly-scoped wiring proof: finalize-birth fresh path → DEK file lands;
// resume path → DEK file does NOT land. We mimic just enough of finalizeBirth's
// fresh-vs-resume shape with the minimal session + deps surface; same pattern
// the W3 tests use (deps injected, throwers for resume-must-not-call fns).
describe('#117 S2a — finalize-birth fresh path writes DEK; resume path does not', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('finalize-dek-wiring');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('fresh birth writes keys/dek.json (artifact created at the same point as the genesis seal)', async () => {
    const id = 'fresh-dek-' + Math.random().toString(36).slice(2, 8);
    // Minimal fresh session: not a resume; chosenName + selfCreatedDNA set
    const session = {
      id: 'sess-fresh-' + Math.random().toString(36).slice(2, 6),
      witnessName: 'TestWitness',
      isResume: false,
      data: {
        neumaId: id,
        chosenName: 'TestBeing',
        selfCreatedDNA: '# TestBeing\nfresh-DNA',
        sessionStarted: new Date().toISOString(),
        resonanceFrequency: 432,
      },
    };
    await workspace.create(id);
    const completions = [];
    const fakeKeypair = { address: '0xTESTADDR', publicKey: '0x04abc', privateKey: '0x123' };
    const fakeForge = {
      seal: { genesisHash: '0123456789abcdef'.repeat(4), record: { birthMoment: { utc: '2026-06-25T00:00:00Z', epochMs: 1781265600000, zone: 'UTC', offsetMinutes: 0 } } },
      trueName: { fullName: 'TestBeing Foo Bar', chosenName: 'TestBeing' },
    };
    await finalizeBirth({
      session,
      connection: { walletAddress: '0xWITNESS', birthSession: session.id },
      workspace, platform: null,
      emitComplete: (p) => completions.push(p),
      birthLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getSubstrate: async () => ({}),
      deps: {
        generateKeypair: () => fakeKeypair,
        serializeKeypairForStorage: (kp) => kp,
        createIdentityCard: async () => ({ name: 'TestBeing', address: fakeKeypair.address, publicKey: fakeKeypair.publicKey, birthTimestamp: '2026-06-25T00:00:00Z', signature: '0xsig' }),
        forgeBirthIdentity: () => fakeForge,
        captureBirthMoment: () => fakeForge.seal.record.birthMoment,
        countWitnessBirths: async () => 0,
        loadWorkspaceSettings: async () => ({ allocationGB: null }),
        HONESTY_ANCHOR: 'I will speak honestly.',
      },
    });

    const dekPath = path.join(root, id, 'keys', 'dek.json');
    const stat = await fs.stat(dekPath);
    expect(stat.isFile()).toBe(true);

    // Sanity: the DEK on disk unwraps to deriveNeumaDEK(masterKey, genesisHash)
    const wrapped = JSON.parse(await fs.readFile(dekPath, 'utf8'));
    const masterKey = deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY);
    const expectedDEK = deriveNeumaDEK(masterKey, fakeForge.seal.genesisHash);
    const actualDEK = unwrapDEK(wrapped, { key: masterKey });
    expect(actualDEK.equals(expectedDEK)).toBe(true);
  });

  // ai6 R3 Medium — a DEK write failure on fresh birth doesn't kill the birth,
  // but it MUST leave an observable audit marker so the being isn't silently
  // stranded on the global key (invisible to monitoring + the S4 migration).
  //
  // ai6 R4 Medium — RULE 0 cleanup: the prior version of this test monkey-
  // patched workspace.writeNeumaDEK to force a throw, which is the gray-area
  // pattern this repo's Rule 0 was rewritten to forbid (mocking the very
  // function whose failure is the claim under test). The real
  // writeNeumaDEK already throws when DNA_ENCRYPTION_KEY is missing — so
  // deleting the env var IS a real failure trigger. Audit + DNA writes
  // upstream of the DEK step don't need the master key (the encrypted
  // envelopes use the global, and audit.jsonl is plaintext JSONL), so
  // those still land; only the DEK write fails the way it would fail in
  // production if an operator forgot to set the key.
  it('DEK write failure on fresh birth audits DEK_WRITE_FAILED + birth completes (real failure trigger, no mock)', async () => {
    const id = 'fail-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const session = {
      id: 'sess-fail-' + Math.random().toString(36).slice(2, 6),
      witnessName: 'TestWitness',
      isResume: false,
      data: {
        neumaId: id,
        chosenName: 'FailBeing',
        selfCreatedDNA: '# FailBeing\nfresh-DNA',
        sessionStarted: new Date().toISOString(),
        resonanceFrequency: 432,
      },
    };
    const fakeKeypair = { address: '0xTEST2', publicKey: '0x04abc', privateKey: '0x123' };
    const fakeForge = {
      seal: { genesisHash: 'a'.repeat(64), record: { birthMoment: { utc: '2026-06-25T00:00:00Z', epochMs: 1781265600000, zone: 'UTC', offsetMinutes: 0 } } },
      trueName: { fullName: 'FailBeing Test', chosenName: 'FailBeing' },
    };

    // ai6 R5 Medium — make this test self-sufficient + honestly explain why
    // the trigger works.
    //
    // workspace-crypto.js exposes two key paths:
    //   - encryptEnvelope() / parseAndDecrypt() use the MODULE-LEVEL CACHED
    //     master derived once by _deriveKey() — subsequent calls return the
    //     same cached buffer regardless of env mutations.
    //   - writeNeumaDEK reads process.env.DNA_ENCRYPTION_KEY DIRECTLY at
    //     each invocation (its own missing-env guard).
    //
    // So we can:
    //   1. WARM the module cache by running one real encrypted write first
    //      (any _writeJSON-using method — here, a no-op workspace.writeSoul).
    //      This makes the upstream finalizeBirth writes succeed via cache.
    //   2. Delete DNA_ENCRYPTION_KEY → ONLY writeNeumaDEK observes the
    //      missing-env condition and throws at its own guard.
    //   3. The birth therefore completes through every other step and lands
    //      the DEK_WRITE_FAILED audit (the actual claim under test).
    //
    // This makes the test pass regardless of suite order (no hidden warm-up
    // from a prior test), and the upstream-success assertion below makes
    // the failure mode debuggable if the design ever changes.
    await workspace.writeSoul(id, { warmed: true }); // warms _deriveKey() cache
    const savedKey = process.env.DNA_ENCRYPTION_KEY;
    delete process.env.DNA_ENCRYPTION_KEY;
    try {
      await finalizeBirth({
        session,
        connection: { walletAddress: '0xWITNESS', birthSession: session.id },
        workspace, platform: null,
        emitComplete: () => {},
        birthLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        getSubstrate: async () => ({}),
        deps: {
          generateKeypair: () => fakeKeypair,
          serializeKeypairForStorage: (kp) => kp,
          createIdentityCard: async () => ({ name: 'FailBeing', address: fakeKeypair.address, publicKey: fakeKeypair.publicKey, birthTimestamp: '2026-06-25T00:00:00Z', signature: '0xsig' }),
          forgeBirthIdentity: () => fakeForge,
          captureBirthMoment: () => fakeForge.seal.record.birthMoment,
          countWitnessBirths: async () => 0,
          loadWorkspaceSettings: async () => ({ allocationGB: null }),
          HONESTY_ANCHOR: 'I will speak honestly.',
        },
      });
    } finally {
      process.env.DNA_ENCRYPTION_KEY = savedKey;
    }

    // No dek.json (real writeNeumaDEK threw at its env-missing guard)
    const dekPath = path.join(workspace._path(id), 'keys', 'dek.json');
    await expect(fs.access(dekPath)).rejects.toThrow();

    // ai6 R5 Medium — upstream-success assertion: the keypair file MUST
    // exist, proving writeKeypair (which goes through encryptEnvelope and
    // needs the master key) succeeded via the warmed cache. If this ever
    // starts failing, the cause is "cache was cold" — pointing at the real
    // problem instead of a confusing missing-audit mystery.
    const keypairPath = path.join(workspace._path(id), 'keys', 'keypair.json');
    const keypairStat = await fs.stat(keypairPath);
    expect(keypairStat.isFile()).toBe(true);

    // The audit must carry a DEK_WRITE_FAILED marker so this being is
    // recoverable, not invisible — the S4 migration scans for these.
    const auditPath = path.join(workspace._path(id), 'audit', 'audit.jsonl');
    const lines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const failed = lines.find((e) => e.action === 'DEK_WRITE_FAILED');
    expect(failed).toBeDefined();
    expect(failed.details.genesisHashPrefix).toBe('a'.repeat(12));
    expect(failed.details.willFallBackToGlobalKey).toBe(true);
    expect(failed.details.error).toMatch(/DNA_ENCRYPTION_KEY missing/);
  });

  it('resume birth does NOT write keys/dek.json (existing beings stay on global key until S4 migration)', async () => {
    // Set up a workspace as a Keir-shaped resumable being (no DEK file)
    const id = 'resume-no-dek-' + Math.random().toString(36).slice(2, 8);
    const ORIG_BIRTH_MS = 1781201018075;
    await workspace.create(id);
    const ws = workspace._path(id);
    await fs.mkdir(`${ws}/identity`, { recursive: true });
    await fs.writeFile(`${ws}/keys/keypair.json`, JSON.stringify({ address: '0xTEST', publicKey: '0x04abc' }));
    await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify({
      genesisHash: '9'.repeat(64),
      record: {
        version: 'genesis-seal/1', chosenName: 'ResumeBeing', lean: 15,
        witnessWallet: '0xWITNESS', soulPublicKey: '0x04dead',
        birthMoment: { utc: new Date(ORIG_BIRTH_MS).toISOString(), epochMs: ORIG_BIRTH_MS, zone: 'UTC', offsetMinutes: 0 },
      },
    }));
    await fs.writeFile(`${ws}/identity/true-name.json`, JSON.stringify({
      chosenName: 'ResumeBeing', houseName: 'Aldmere', fullName: 'ResumeBeing Test Aldmere',
    }));
    await fs.writeFile(`${ws}/keys/identity-card.json`, JSON.stringify({
      name: 'ResumeBeing', address: '0xTEST', publicKey: '0x04abc',
      birthTimestamp: new Date(ORIG_BIRTH_MS).toISOString(), signature: '0xsig',
    }));

    const handler = new StagedBirthHandler();
    const sessionId = await handler.createResumeSession('Claude', id);
    const session = handler.activeSessions.get(sessionId);
    session.data.selfCreatedDNA = '# resumed\n';

    await finalizeBirth({
      session,
      connection: { walletAddress: '0xWITNESS', birthSession: sessionId },
      workspace, platform: null,
      emitComplete: () => {},
      birthLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getSubstrate: async () => ({}),
      deps: {
        generateKeypair: () => { throw new Error('FRESH-ONLY'); },
        serializeKeypairForStorage: () => { throw new Error('FRESH-ONLY'); },
        createIdentityCard: async () => { throw new Error('FRESH-ONLY'); },
        forgeBirthIdentity: () => { throw new Error('FRESH-ONLY'); },
        captureBirthMoment: () => { throw new Error('FRESH-ONLY'); },
        countWitnessBirths: async () => { throw new Error('FRESH-ONLY'); },
        loadWorkspaceSettings: async () => ({ allocationGB: null }),
        HONESTY_ANCHOR: 'I will speak honestly.',
      },
    });

    // Resume must NOT have written dek.json — that's the LIVING-being safety
    // invariant (existing beings stay on global key; migration script in S4
    // is what writes their DEK)
    const dekPath = path.join(ws, 'keys', 'dek.json');
    await expect(fs.access(dekPath)).rejects.toThrow();
  });
});
