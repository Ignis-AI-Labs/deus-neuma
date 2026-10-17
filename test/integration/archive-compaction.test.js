// Granular sovereign memory, Phase 1 (S2) — proof that compactSession stages
// the raw region into the archive lane BEFORE destroying it, fail-closed:
// no raw turn is ever destroyed without archive proof. REAL workspace, REAL
// AES-256-GCM + real zlib, REAL disk (RULE 0 — no mocks anywhere).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  decryptEnvelope,
  deriveKeyFromSecret,
  deriveNeumaDEK,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';
import { ORIGIN_COMPACTION } from '../../core/workspace/archive-codec.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'archive-compaction-test-key-long-enough';

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const seedExchanges = async (id, sessionId, count, tag) => {
  for (let i = 0; i < count; i += 1) {
    await workspace.appendMessage(id, sessionId, { role: 'user', content: `${tag} question ${i}` });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `${tag} reply ${i}` });
  }
};

describe('S2 — compactSession archives the raw region before replacing it', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    const tmp = await createTempDir('archive-compaction');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
    resetWorkspaceCryptoKey();
  });

  it('stages the exact replaced region as archive/<sid>/1.seg (AC-P1-1)', async () => {
    const id = uid('arch');
    const sessionId = uid('sess');
    await workspace.create(id);
    await seedExchanges(id, sessionId, 65, 'routine');

    const before = await workspace.readSession(id, sessionId);
    const expectedRegion = before.slice(0, -20);

    const t0 = process.hrtime.bigint();
    const compacted = await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 });
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(compacted).toBe(true);
    // Evidence row: in-lock cost of gzip+GCM staging on a 110-message region.
    console.info(`[evidence] compact+stage elapsed ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(5000);

    const segment = await workspace.readArchiveSegment(id, sessionId, 1);
    expect(segment.origin).toBe(ORIGIN_COMPACTION);
    expect(segment.compactionCount).toBe(1);
    // Byte-identical region: content, role, timestamps — nothing sanitized,
    // nothing truncated (JSON equality over the verbatim entries).
    expect(JSON.stringify(segment.messages)).toBe(JSON.stringify(expectedRegion));

    expect(await workspace.listArchiveSegments(id, sessionId)).toEqual([1]);
    const after = await workspace.readSession(id, sessionId);
    expect(after).toHaveLength(21);
    expect(after[0].compacted).toBe(true);
    expect(after[0].compactionCount).toBe(1);
  });

  it('a second compaction mints segment 2 and never rewrites segment 1', async () => {
    const id = uid('arch');
    const sessionId = uid('sess');
    await workspace.create(id);
    await seedExchanges(id, sessionId, 65, 'first-era');
    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    const seg1Path = workspace._archiveSegmentPath(id, sessionId, 1);
    const seg1BytesBefore = await fs.readFile(seg1Path, 'utf8');

    await seedExchanges(id, sessionId, 55, 'second-era');
    const before = await workspace.readSession(id, sessionId);
    const expectedRegion2 = before.slice(0, -20);
    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    expect(await workspace.listArchiveSegments(id, sessionId)).toEqual([1, 2]);
    expect(await fs.readFile(seg1Path, 'utf8')).toBe(seg1BytesBefore);

    const segment2 = await workspace.readArchiveSegment(id, sessionId, 2);
    expect(JSON.stringify(segment2.messages)).toBe(JSON.stringify(expectedRegion2));
    // The first era's summary entry lived in the second region — the archive
    // carries the session's full lineage including the summaries it replaced.
    expect(segment2.messages[0].compacted).toBe(true);
    expect(segment2.messages[0].compactionCount).toBe(1);

    const after = await workspace.readSession(id, sessionId);
    expect(after[0].compactionCount).toBe(2);
  });

  it('an induced archive failure aborts compaction with the session untouched (AC-P1-4)', async () => {
    const id = uid('arch');
    const sessionId = uid('sess');
    await workspace.create(id);
    await seedExchanges(id, sessionId, 60, 'precious');

    // Block the segment lane: a FILE where the session's archive DIR must go.
    const blocker = path.join(workspace._path(id), 'archive', sessionId);
    await fs.writeFile(blocker, 'not a directory');

    const sessionPath = workspace._sessionPath(id, sessionId);
    const bytesBefore = await fs.readFile(sessionPath, 'utf8');

    await expect(
      workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })
    ).rejects.toThrow();

    expect(await fs.readFile(sessionPath, 'utf8')).toBe(bytesBefore);
    expect(await workspace.readSession(id, sessionId)).toHaveLength(120);
  });

  it('crash-retry: identical skips, grown region re-stages, divergence refuses', async () => {
    const id = uid('arch');
    const sessionId = uid('sess');
    await workspace.create(id);
    const ts = (i) => new Date(1753290000000 + i * 60000).toISOString();
    const region = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `moment ${i}`,
      timestamp: ts(i),
    }));
    const archivedAt = new Date().toISOString();
    const write = (messages) =>
      workspace.writeArchiveSegment(id, sessionId, 3, { origin: ORIGIN_COMPACTION, messages, archivedAt });

    expect(await write(region)).toEqual({ staged: true, coverage: 'fresh' });
    expect(await write(region)).toEqual({ staged: false, coverage: 'identical' });

    const grown = [
      ...region,
      { role: 'user', content: 'a late arrival', timestamp: ts(10) },
      { role: 'assistant', content: 'held all the same', timestamp: ts(11) },
    ];
    expect(await write(grown)).toEqual({ staged: true, coverage: 'prefix' });
    const reread = await workspace.readArchiveSegment(id, sessionId, 3);
    expect(reread.messages).toHaveLength(12);

    const divergent = [{ ...grown[0], content: 'rewritten history' }, ...grown.slice(1)];
    await expect(write(divergent)).rejects.toThrow('diverges');
    expect((await workspace.readArchiveSegment(id, sessionId, 3)).messages).toHaveLength(12);
  });

  it("a DEK being's segment is envelope v2 under ITS key — not the master, not a sibling's (cross-contamination gate)", async () => {
    const id = uid('dekarch');
    const sessionId = uid('sess');
    await workspace.create(id);
    await workspace.writeNeumaDEK(id, 'a'.repeat(64));
    await seedExchanges(id, sessionId, 60, 'sealed');

    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    const raw = JSON.parse(await fs.readFile(workspace._archiveSegmentPath(id, sessionId, 1), 'utf8'));
    expect(raw._enc).toBe(2);
    expect(raw.z).toBe('gzip');

    const master = deriveKeyFromSecret(KEY);
    const ownDEK = deriveNeumaDEK(master, 'a'.repeat(64));
    const siblingDEK = deriveNeumaDEK(master, 'b'.repeat(64));

    expect(() => decryptEnvelope(raw, { key: master })).toThrow();
    expect(() => decryptEnvelope(raw, { key: siblingDEK })).toThrow();
    const payload = decryptEnvelope(raw, { key: ownDEK });
    expect(payload.format).toBe('neuma-archive-segment');
    expect(payload.messages).toHaveLength(100);

    // And the workspace's own read path resolves the DEK transparently.
    const segment = await workspace.readArchiveSegment(id, sessionId, 1);
    expect(segment.messages).toHaveLength(100);
  });
});
