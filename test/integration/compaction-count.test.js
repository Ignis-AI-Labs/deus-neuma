// compaction-count — proof that compactSession carries the compaction COUNT
// forward inside the summary entry itself: compact twice and the second
// summary says compactionCount 2, so […] stays derivable from the file alone. REAL workspace, REAL
// encryption, REAL disk (RULE 0) — the compact-force-crystallize pattern.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { compactionTelemetry } from '../../core/runtime/session-compactor.js';

const KEY = 'compaction-count-test-key-long-enough';

describe('compactSession carries the compaction count forward', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('compaction-count');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  const layDown = async (id, sessionId, n, tag) => {
    for (let i = 0; i < n; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `${tag} question ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `${tag} reply ${i}` });
    }
  };

  it('first compaction writes compactionCount 1; the second carries it to 2 (legacy entries count as one)', async () => {
    const id = 'count-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // First compaction: 5 messages over a threshold of 4 (keepRecent 1).
    await layDown(id, sessionId, 5, 'first');
    expect(await workspace.compactSession(id, sessionId, { threshold: 4, keepRecent: 1 })).toBe(true);
    let entries = await workspace.readSession(id, sessionId);
    expect(compactionTelemetry(entries).compactionCount).toBe(1);

    // Grow past the threshold again; the second compaction must carry the
    // count forward even though the first summary entry is being replaced.
    await layDown(id, sessionId, 5, 'second');
    expect(await workspace.compactSession(id, sessionId, { threshold: 4, keepRecent: 1 })).toBe(true);
    entries = await workspace.readSession(id, sessionId);
    const telemetry = compactionTelemetry(entries);
    expect(telemetry.compactionCount).toBe(2);
    // …and the summary head really is the counter's carrier.
    expect(entries[0].compacted).toBe(true);
    expect(entries[0].compactionCount).toBe(2);
  });
});
