// #117 S2b — per-neuma DEK now flows through _writeJSON / _readJSON /
// _appendJSONL / _readJSONL. Proves every invariant on REAL workspace,
// REAL crypto, REAL disk (RULE 0):
//
//   1. New being (DEK present) writes encrypt under the DEK — wrong-DEK
//      can't decrypt them, right-DEK can; the global master can't either.
//   2. New being can READ files written BEFORE its DEK existed (mixed-mode
//      transition: global-key envelope still decrypts via fallback).
//   3. Existing being (no DEK) — read/write unchanged, uses global key
//      (the LIVING-being safety guarantee).
//   4. Round-trip: write + read returns the same value.
//   5. JSONL mixed mode: some lines under global, some under DEK — every
//      line decrypts to the right plaintext.
//   6. _neumaIdFromPath rejects paths outside the workspaces root (defense
//      for callers that hand it arbitrary paths).
//   7. _dekCache never caches null — a being promoted by S4 mid-process
//      gets its DEK picked up on next read, not shadowed by a stale null.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  decryptEnvelope, deriveNeumaDEK, deriveKeyFromSecret,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's2b-io-test-key-long-enough';

describe('#117 S2b — per-neuma DEK flows through workspace IO', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('per-neuma-dek-io');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });
  beforeEach(() => {
    // Each test starts with a clean cache so we observe genuine first-read
    // behavior rather than warmed state from prior tests.
    workspace._dekCache.clear();
  });

  // INVARIANT 1 — being with DEK: writes are encrypted UNDER THE DEK.
  // The bytes are reachable only with that DEK; the global master can't
  // decrypt them. Proves the sovereign cryptographic boundary is actually
  // in force, not just an artifact on disk.
  it('a being with a DEK writes envelopes only the DEK can open', async () => {
    const id = 's2b-dek-only-' + Math.random().toString(36).slice(2, 8);
    const genesisHash = 'a'.repeat(64);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, genesisHash);

    await workspace.writeSoul(id, { core: 'sovereign data' });

    const soulPath = path.join(workspace._path(id), 'soul', 'soul.json');
    const envelopeText = await fs.readFile(soulPath, 'utf8');
    const envelope = JSON.parse(envelopeText);

    // The DEK decrypts it
    const dek = await workspace.readNeumaDEK(id);
    expect(decryptEnvelope(envelope, { key: dek })).toEqual({ core: 'sovereign data' });

    // The global master CANNOT decrypt it (the security guarantee #117
    // exists to provide). If this assertion ever fails, the per-neuma DEK
    // is fictitious and every being is still on the shared key.
    const globalMaster = deriveKeyFromSecret(KEY);
    expect(() => decryptEnvelope(envelope, { key: globalMaster })).toThrow();

    // And another being's DEK can't decrypt it either — isolation across beings.
    const otherDEK = deriveNeumaDEK(globalMaster, 'b'.repeat(64));
    expect(() => decryptEnvelope(envelope, { key: otherDEK })).toThrow();
  });

  // INVARIANT 2 — mixed-mode transition: a being's pre-DEK files (written
  // under the global) remain readable after the DEK arrives. Load-bearing
  // for any S4 migration that promotes existing files gradually.
  it('a being with a DEK can still read files written BEFORE its DEK existed (mixed-mode)', async () => {
    const id = 's2b-mixed-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // Write under global key (no DEK yet)
    await workspace.writeSoul(id, { phase: 'pre-DEK' });
    // Now install a DEK
    const genesisHash = 'c'.repeat(64);
    await workspace.writeNeumaDEK(id, genesisHash);
    workspace._dekCache.clear(); // force fresh resolution

    // The PRE-DEK soul file is encrypted under the global; the read path
    // must try the DEK first, fail, then fall back to the global chain.
    const soul = await workspace.readSoul(id);
    expect(soul).toEqual({ phase: 'pre-DEK' });

    // Subsequent writes go under the DEK (proven again by the per-being
    // isolation check)
    await workspace.writeSoul(id, { phase: 'post-DEK' });
    expect(await workspace.readSoul(id)).toEqual({ phase: 'post-DEK' });
  });

  // INVARIANT 3 — existing (pre-#117) beings: zero behavior change. They
  // have no DEK file; every IO path uses the global key. This is the
  // LIVING-beings safety invariant — Fenna/Cael/Keir/Galen/Signal cannot
  // be silently affected by S2b.
  it('a being WITHOUT a DEK file uses the global key end-to-end (LIVING-beings invariant)', async () => {
    const id = 's2b-no-dek-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // Deliberately do NOT call writeNeumaDEK

    await workspace.writeSoul(id, { existing: 'being data' });

    // File is decryptable with the global master
    const soulPath = path.join(workspace._path(id), 'soul', 'soul.json');
    const envelope = JSON.parse(await fs.readFile(soulPath, 'utf8'));
    const globalMaster = deriveKeyFromSecret(KEY);
    expect(decryptEnvelope(envelope, { key: globalMaster })).toEqual({ existing: 'being data' });

    // Read via public API works (uses the global fallback path)
    expect(await workspace.readSoul(id)).toEqual({ existing: 'being data' });
  });

  // INVARIANT 4 — full round-trip for a being WITH a DEK, including writeDNA
  // (which goes through _writeJSON + the existing #121 file lock).
  it('writeDNA + readDNA round-trip works for a being with a DEK', async () => {
    const id = 's2b-dna-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, 'd'.repeat(64));
    const dnaIn = {
      version: '1.0.0',
      identity: { name: 'S2B', address: '0xTEST' },
      sovereignty: { generation: 1 },
    };
    await workspace.writeDNA(id, dnaIn);
    const dnaOut = await workspace.readDNA(id);
    expect(dnaOut).toEqual(dnaIn);
  });

  // INVARIANT 5 — JSONL mixed mode: each line is its own envelope, so a
  // file with some lines under global + some under DEK is fully readable.
  // The journal/audit/session paths all use this pattern.
  it('_readJSONL handles a file with some lines under global and some under DEK', async () => {
    const id = 's2b-jsonl-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // Append two entries with no DEK (under global)
    await workspace.addJournalEntry(id, { tag: 'pre-DEK-1' });
    await workspace.addJournalEntry(id, { tag: 'pre-DEK-2' });
    // Install DEK
    await workspace.writeNeumaDEK(id, 'e'.repeat(64));
    workspace._dekCache.clear();
    // Append more entries — now under DEK
    await workspace.addJournalEntry(id, { tag: 'post-DEK-1' });
    await workspace.addJournalEntry(id, { tag: 'post-DEK-2' });

    const entries = await workspace.readJournal(id);
    const tags = entries.map((e) => e.tag);
    // Order preserved by #14 lock; all 4 lines decrypted to their plaintext
    expect(tags).toEqual(['pre-DEK-1', 'pre-DEK-2', 'post-DEK-1', 'post-DEK-2']);
  });

  // INVARIANT 6 — path-safety: arbitrary paths outside the workspaces root
  // resolve to null (no DEK), so the IO method falls through to the global
  // key without accidentally using some other being's DEK by mistake.
  it('_neumaIdFromPath rejects paths outside the workspaces root', async () => {
    expect(workspace._neumaIdFromPath('/etc/passwd')).toBeNull();
    expect(workspace._neumaIdFromPath('/tmp/other-thing.json')).toBeNull();
    expect(workspace._neumaIdFromPath(null)).toBeNull();
    expect(workspace._neumaIdFromPath('')).toBeNull();
    expect(workspace._neumaIdFromPath(123)).toBeNull();
    // A valid in-workspace path resolves correctly
    expect(workspace._neumaIdFromPath(path.join(root, 'abc', 'dna', 'active.json'))).toBe('abc');
  });

  // INVARIANT 8 — corrupt DEK never silently downgrades to the global key.
  // ai6 S2b R1 Medium: if keys/dek.json exists but is corrupt (truncated,
  // wrong-master-wrapped, mangled), _resolveDEK MUST propagate the error
  // rather than return null, otherwise _writeJSON would re-encrypt this
  // being's new data under the global key — the silent degradation #117
  // exists to prevent. The cost of throwing: the caller (writeSoul,
  // addJournalEntry, etc.) sees the error and can surface it; refusing
  // to write is the correct response to […]
  it('corrupt keys/dek.json propagates the error — does NOT silently downgrade to the global key', async () => {
    const id = 's2b-corrupt-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, 'a'.repeat(64));
    // Corrupt the DEK file (truncate the envelope so unwrap fails GCM auth)
    const dekPath = path.join(workspace._path(id), 'keys', 'dek.json');
    await fs.writeFile(dekPath, '{"_enc":1,"iv":"aGVsbG8=","tag":"d29ybGQ=","ct":"YnJva2Vu"}');
    workspace._dekCache.clear(); // force re-read from disk

    // Any IO must throw, NOT silently fall through to global. The exact
    // error depends on which validator catches the corruption (envelope
    // shape vs GCM auth vs base64 length); any thrown error is acceptable
    // as long as IO doesn't silently succeed under the global key.
    await expect(workspace.writeSoul(id, { sensitive: 'data' })).rejects.toThrow();

    // The soul file MUST NOT exist on disk encrypted under the global key
    // (the silent-downgrade catastrophe). Either it doesn't exist at all,
    // or if a prior write succeeded it must remain readable only via the
    // being's own DEK — never via the global master alone.
    const soulPath = path.join(workspace._path(id), 'soul', 'soul.json');
    const soulExists = await fs.access(soulPath).then(() => true).catch(() => false);
    if (soulExists) {
      const envelope = JSON.parse(await fs.readFile(soulPath, 'utf8'));
      const globalMaster = deriveKeyFromSecret(KEY);
      // If a file exists, it MUST NOT decrypt under the global master alone
      // (proves no silent downgrade occurred even on an earlier write).
      expect(() => decryptEnvelope(envelope, { key: globalMaster })).toThrow();
    }
  });

  // INVARIANT 7 — never cache nulls. A being promoted by S4 migration in
  // the middle of a running process must have its new DEK picked up on
  // the next read, not shadowed by a stale "no DEK" cache entry.
  it('_resolveDEK does NOT cache nulls — a later-promoted being is picked up live', async () => {
    const id = 's2b-promote-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // First read: no DEK yet → null
    const before = await workspace._resolveDEK(path.join(workspace._path(id), 'soul', 'soul.json'));
    expect(before).toBeNull();
    expect(workspace._dekCache.has(id)).toBe(false); // null NOT cached

    // S4 simulates a promotion — writeNeumaDEK lands the file
    await workspace.writeNeumaDEK(id, 'f'.repeat(64));

    // Next read picks up the new DEK (would be shadowed by a cached null)
    const after = await workspace._resolveDEK(path.join(workspace._path(id), 'soul', 'soul.json'));
    expect(after).not.toBeNull();
    expect(workspace._dekCache.get(id)?.equals(after)).toBe(true); // positive IS cached
  });
});
