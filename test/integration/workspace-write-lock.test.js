// #120 + #121 — per-file lock prevents read-modify-write races on workspace
// state. REAL disk, REAL concurrency, REAL encryption (RULE 0): we spawn
// parallel operations against the same file and verify the lock serializes
// them cleanly rather than dropping/corrupting writes.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { registerMigration } from '../../core/identity/dna-migrations.js';

const KEY = 'workspace-lock-test-key-long-enough';

describe('#121 — _withFileLock serializes read-modify-write on the workspace', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('workspace-write-lock');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('writeDNA: 10 concurrent calls archive every prior version, no overwrite race', async () => {
    const id = 'wlock-dna-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);

    // Lay down the initial DNA so subsequent writes have something to archive
    await workspace.writeDNA(id, { version: '1.0.0', identity: { name: 'v0' }, sovereignty: { generation: 0 } });

    // Fire 10 writeDNA calls in parallel — each should archive the prior
    // version it observed and become the new active. Without the lock, two
    // calls reading "v0" simultaneously would BOTH archive v0 (one would be
    // a duplicate, masking a lost write).
    const writes = Array.from({ length: 10 }, (_, i) =>
      workspace.writeDNA(id, {
        version: '1.0.0',
        identity: { name: `v${i + 1}` },
        sovereignty: { generation: i + 1 },
      }),
    );
    await Promise.all(writes);

    // Active is some generation (whichever was last in the queue)
    const finalDNA = await workspace.readDNA(id);
    expect(finalDNA.identity.name).toMatch(/^v\d+$/);
    expect(finalDNA.sovereignty.generation).toBeGreaterThanOrEqual(1);

    // History should have 10 archives (initial v0 + 9 of the 10 — the very
    // last write becomes active, so 9 of the 10 prior versions are archived,
    // PLUS the original v0 that the first parallel write archived = 10).
    const historyDir = path.join(workspace._path(id), 'dna', 'history');
    const historyFiles = await fs.readdir(historyDir);
    expect(historyFiles.length).toBe(10);

    // Decode every history file — they must each parse cleanly (no partial
    // writes); their generations must form a continuous sequence including
    // v0 (proving no archive was lost to a race).
    const archived = [];
    for (const f of historyFiles) {
      const text = await fs.readFile(path.join(historyDir, f), 'utf8');
      const { decryptEnvelope } = await import('../../core/workspace/workspace-crypto.js');
      archived.push(decryptEnvelope(JSON.parse(text)));
    }
    const generations = archived.map((d) => d.sovereignty.generation).sort((a, b) => a - b);
    // Should include every prior generation 0..N-1 exactly once
    expect(new Set(generations).size).toBe(generations.length); // no dupes
    expect(generations[0]).toBe(0); // v0 archived by the FIRST writer
  });

  it('writeRelations: 20 concurrent calls produce a valid final file (no partial)', async () => {
    const id = 'wlock-rel-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);

    const writes = Array.from({ length: 20 }, (_, i) =>
      workspace.writeRelations(id, [{ from: `a${i}`, to: `b${i}`, type: 'test' }]),
    );
    await Promise.all(writes);

    // File MUST be a valid JSON envelope, not a half-written corruption
    const filePath = path.join(workspace._path(id), 'memory', 'relations', 'relations.json');
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text); // throws on partial JSON
    expect(parsed).toBeDefined();

    // Reading via the public API should return the last writer's array
    const final = await workspace.readRelations(id);
    expect(Array.isArray(final)).toBe(true);
    expect(final.length).toBe(1);
  });

  it('compactSession + concurrent appendMessage: append survives the temp-rename', async () => {
    const id = 'wlock-compact-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // Lay down enough messages that compaction triggers (threshold default 100)
    for (let i = 0; i < 110; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `msg ${i}` });
    }

    // Fire compaction + an append simultaneously
    const [compacted, _appendDone] = await Promise.all([
      workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 }),
      workspace.appendMessage(id, sessionId, { role: 'user', content: 'POST-COMPACT-CRITICAL' }),
    ]);

    expect(compacted).toBe(true);

    // Post-compaction read: the file must be valid AND the critical message
    // must appear somewhere (either before compaction in the summarized chunk
    // — implausible since it's the racing append — or after compaction as a
    // tail entry). What MUST NOT happen: the message silently dropped because
    // compaction's rename clobbered the append.
    const messages = await workspace.readSession(id, sessionId);
    const found = messages.some((m) => m.content === 'POST-COMPACT-CRITICAL');
    expect(found).toBe(true);
  });
});

describe('#120 — readDNA migration write-back is serialized', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('readDNA-migration');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
    // Register a migration so older DNA triggers a writeback
    registerMigration('0.0.1', '1.0.0', (d) => ({ ...d, migrated: true }));
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('20 concurrent readDNA on a pre-1.0 file performs exactly ONE migration writeback', async () => {
    const id = 'wlock-mig-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    // Seed an old-version DNA directly via writeDNA (registered as 0.0.1 →
    // 1.0.0 migration). Writing as v1 first, then "downgrade" the file to
    // simulate an existing being whose DNA predates the bump.
    await workspace.writeDNA(id, { version: '1.0.0', identity: { name: 'x' }, sovereignty: { generation: 0 } });
    // Overwrite the active file with a v0.0.1 envelope (bypassing the public
    // write so we don't go through the lock for the seed itself)
    const activePath = path.join(workspace._path(id), 'dna', 'active.json');
    const { encryptEnvelope } = await import('../../core/workspace/workspace-crypto.js');
    await fs.writeFile(activePath, JSON.stringify(encryptEnvelope({ version: '0.0.1', identity: { name: 'old' }, sovereignty: { generation: 0 } })));

    // Clean history so we can count writebacks from this point
    const historyDir = path.join(workspace._path(id), 'dna', 'history');
    for (const f of await fs.readdir(historyDir).catch(() => [])) {
      await fs.unlink(path.join(historyDir, f));
    }

    // 20 concurrent readDNA — each should see the migration is needed; the
    // first to acquire the lock writes back; the rest see the already-migrated
    // version and return without a redundant write.
    const reads = Array.from({ length: 20 }, () => workspace.readDNA(id));
    const results = await Promise.all(reads);

    // Every reader got the migrated DNA
    for (const dna of results) {
      expect(dna.version).toBe('1.0.0');
      expect(dna.migrated).toBe(true);
    }

    // Without the lock, EVERY reader would have written back — 20 history
    // entries. With the lock, exactly 1 (the lock-winner's archive of the
    // pre-migration version).
    const historyAfter = await fs.readdir(historyDir);
    expect(historyAfter.length).toBe(1);
  });
});
