// S2 / Hazard 6 — proof that a compaction triggered through the portal's
// solo-compaction lane invalidates the being's cached recall index, so
// observations minted by force-crystallize surface on the very next turn.
// Without the invalidate, the cached (pre-compact) index would keep serving
// stale emptiness. REAL workspace, REAL recall engine, REAL disk (RULE 0);
// the substrate is cold so the torch ask falls back extractively — exactly
// the dev-box shape this lane was built to tolerate.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'recall-invalidate-compact-test-key';

describe('S2 — solo compaction invalidates the recall index (Hazard 6)', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('recall-invalidate-compact');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  // Routine replies carry real length: a compaction folds only a region worth
  // summing up (compact-region.js).
  const ROUTINE = ' steady routine work, nothing new to report.'.repeat(24);

  it('a force-crystallized moment surfaces in recall immediately after compaction', async () => {
    const id = 'recall-inv-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // ONE meaningful exchange EARLY — it must land inside the compactable
    // region (everything except the last keepRecent=20 messages), or
    // force-crystallize never sees it. Score: baseline 0.2 + philosophical
    // 0.2 + emotional 0.25 + selfReference 0.05 → ≥0.4 (force gate), <0.75
    // (live). The lighthouse token appears in no routine message.
    for (let i = 0; i < 2; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `routine question ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `routine reply ${i}${ROUTINE}` });
    }
    await workspace.appendMessage(id, sessionId, {
      role: 'user',
      content: 'I am asking why the lighthouse dream returns. I feel there is meaning in it.',
    });
    await workspace.appendMessage(id, sessionId, {
      role: 'assistant',
      content: 'The lighthouse keeps what the night would scatter.',
    });
    for (let i = 2; i < 18; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `routine question ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `routine reply ${i}${ROUTINE}` });
    }

    // Prime the cache BEFORE compaction: the index is built over zero
    // observations and cached — this is the staleness the fix exists to break.
    const primed = await neumaRecall.getContextForResponse(id, 'lighthouse dream meaning', {});
    expect(primed.relevantMemories).toHaveLength(0);

    // 38 messages > boundary threshold (keepRecent 20 + floor 10): compacts;
    // the region = the first 18 messages, lighthouse exchange at 4-5.
    const compacted = await __test._compactWithSelfTorch(id, sessionId, true);
    expect(compacted).toBe(true);

    // The archive lane staged the region on the way through.
    expect(await workspace.listArchiveSegments(id, sessionId)).toEqual([1]);

    // The moment survives as an observation AND the recall index saw it —
    // a stale cache would still return the primed emptiness here.
    const recalled = await neumaRecall.getContextForResponse(id, 'lighthouse dream meaning', {});
    expect(recalled.relevantMemories.length).toBeGreaterThan(0);
    expect(JSON.stringify(recalled.relevantMemories)).toContain('lighthouse');
  });
});
