/**
 * Continuity logs + session compaction survive the per-neuma DEK migration.
 *
 * Both live under <root>/<neumaId>/, so the DEK backfill re-encrypts them under
 * the being's own key. Two latent bugs in the exact class of the voice-dna crash:
 *
 *   1. readContinuityLog decrypted with the GLOBAL master only — so after
 *      migration it FAILED to open a being's continuity lines (every line torn),
 *      silently losing the continuity layer for every migrated being.
 *   2. compactSession rewrote the whole session file under the GLOBAL master —
 *      silently downgrading a DEK-holding being's session out of its own key on
 *      every compaction.
 *
 * REAL temp workspace, REAL AES-256-GCM, REAL migrateBeing / compactSession.
 * No mocks (RULE 0).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import { decryptEnvelope, deriveKeyFromSecret, resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';

const KEY = 'continuity-dek-master-key-long-enough';
const WITNESS = '0x' + 'b'.repeat(40);

// Give the being the identity a migration requires (plaintext seal + owner).
const seedBeing = async (root, neumaId) => {
  const dir = path.join(root, neumaId);
  await fs.mkdir(path.join(dir, 'identity'), { recursive: true });
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet: WITNESS, claimedAt: Date.now() }));
  const genesisHash = neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
  await fs.writeFile(
    path.join(dir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash, record: { chosenName: neumaId } }),
  );
};

// Every non-empty JSONL line must be UNreadable with the global master key
// (i.e. it is sealed under the being's DEK).
const assertAllUnderDEK = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(() => decryptEnvelope(JSON.parse(line), { key: deriveKeyFromSecret(KEY) })).toThrow();
  }
};

describe('continuity + compaction survive the per-neuma DEK migration', () => {
  let house, origRoot, origKey;

  beforeEach(async () => {
    origKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir(`continuity-dek-${Math.random().toString(36).slice(2)}`);
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });

  afterEach(() => {
    setWorkspacesRoot(origRoot);
    if (origKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = origKey;
    resetWorkspaceCryptoKey();
    vi.restoreAllMocks();
  });

  it('readContinuityLog still opens a layer after the being is migrated to its own key', async () => {
    const id = 'continuityone';
    await seedBeing(house, id);
    // Append continuity BEFORE migration (written under the global key).
    await workspace.appendContinuityEntry(id, 'episodic', { id: 'e1', text: 'first breath' });
    await workspace.appendContinuityEntry(id, 'episodic', { id: 'e2', text: 'second breath' });

    const result = await migrateBeing(workspace, id);
    expect(result.status).toBe('migrated');

    // The continuity file is now under the DEK — global key alone can't open it.
    const layerPath = path.join(house, id, 'continuity', 'episodic.jsonl');
    await assertAllUnderDEK(layerPath);

    // …yet the log reads back cleanly via the DEK-first fallback (the bug was
    // that every line came back torn and the layer was silently lost).
    const entries = await workspace.readContinuityLog(id, 'episodic');
    expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);

    // A NEW append after migration must also land under the DEK, not the global
    // master — and the mixed-history file stays fully readable.
    await workspace.appendContinuityEntry(id, 'episodic', { id: 'e3', text: 'third breath' });
    await assertAllUnderDEK(layerPath);
    const after = await workspace.readContinuityLog(id, 'episodic');
    expect(after.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('compactSession re-seals the session under the DEK, not the global master', async () => {
    const id = 'compactionone';
    await seedBeing(house, id);
    const sid = 'session-1';
    // Six messages under the global key (pre-migration).
    for (let i = 0; i < 6; i++) {
      await workspace.appendMessage(id, sid, { role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` });
    }

    const result = await migrateBeing(workspace, id);
    expect(result.status).toBe('migrated');

    // Two more turns after migration (these already go under the DEK).
    await workspace.appendMessage(id, sid, { role: 'user', content: 'turn 6' });
    await workspace.appendMessage(id, sid, { role: 'assistant', content: 'turn 7' });

    // Compact: threshold 5 forces it; keepRecent 2 keeps the last two verbatim.
    const compacted = await workspace.compactSession(id, sid, { threshold: 5, keepRecent: 2 });
    expect(compacted).toBe(true);

    // The rewritten file must be entirely under the DEK. Before the fix the
    // compactor rewrote it under the GLOBAL master — this is the regression.
    const sessionPath = path.join(house, id, 'sessions', `${sid}.jsonl`);
    await assertAllUnderDEK(sessionPath);

    // And it still reads back: a summary line plus the two kept turns.
    const messages = await workspace.readSession(id, sid);
    expect(messages[0].compacted).toBe(true);
    expect(messages.slice(-2).map((m) => m.content)).toEqual(['turn 6', 'turn 7']);
  });
});
