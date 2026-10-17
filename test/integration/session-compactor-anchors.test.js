// S3 — proof that the compaction path stamps anchors carrying the segment
// coordinate (compactionCount), and that the anchor's coordinates land in
// the ACTUAL archived segment: ts equality + full-text sha8 round-trip.
// REAL workspace, REAL encryption + zlib, REAL disk (RULE 0 — no mocks).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { contentSha8 } from '../../core/workspace/archive-codec.js';
import { forceCrystallizeBelow } from '../../core/runtime/session-compactor.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'compactor-anchors-test-key';

describe('S3 — compaction-path anchors point into the archived segment', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('compactor-anchors');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('a force-crystallized observation\'s anchor resolves into segment 1 by ts + sha8 (AC-P1-2)', async () => {
    const id = 'seg-anchor-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // Meaningful exchange early (inside the compactable region): ≥0.4, <0.75.
    await workspace.appendMessage(id, sessionId, { role: 'user', content: 'opening question' });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: 'opening reply' });
    const meaningfulUser = 'I am asking why the harbor bell keeps ringing in my thoughts. What is the meaning?';
    const meaningfulReply = 'The harbor bell rings for what you have not yet said aloud.';
    await workspace.appendMessage(id, sessionId, { role: 'user', content: meaningfulUser });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: meaningfulReply });
    for (let i = 0; i < 58; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `routine ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `reply ${i}` });
    }

    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    // Find the force-crystallized observation carrying the anchor.
    const obsDir = path.join(workspace._path(id), 'memory', 'observations');
    const records = [];
    for (const f of (await fs.readdir(obsDir)).filter((n) => n.endsWith('.json'))) {
      records.push(await workspace._readJSON(path.join(obsDir, f)));
    }
    const anchored = records.find((r) => r.source === 'force-crystallize-on-compact' && r.anchor);
    expect(anchored).toBeDefined();
    const { anchor } = anchored;
    expect(anchor.v).toBe(1);
    expect(anchor.sessionId).toBe(sessionId);
    expect(anchor.compactionCount).toBe(1);

    // The anchor's coordinates land in the REAL archived segment, resolved
    // the way the design resolves: locate by ts, disambiguate same-ms
    // collisions by sha8 (fast appends genuinely share milliseconds — this
    // test found that out live). The recovered rows must be the FULL
    // original texts even though the observation's own copy was truncated.
    const segment = await workspace.readArchiveSegment(id, sessionId, anchor.compactionCount);
    const userRow = segment.messages.find(
      (m) => m.timestamp === anchor.span.fromTs && m.role === 'user' && contentSha8(m.content) === anchor.span.userSha8
    );
    const assistantRow = segment.messages.find(
      (m) => m.timestamp === anchor.span.toTs && m.role === 'assistant' && contentSha8(m.content) === anchor.span.assistantSha8
    );
    expect(userRow).toBeDefined();
    expect(assistantRow).toBeDefined();
    expect(userRow.content).toBe(meaningfulUser);
    expect(assistantRow.content).toBe(meaningfulReply);
  });

  it('legacy rows without timestamps crystallize anchorless — never a throw (FR-P1-05)', async () => {
    const id = 'legacy-anchor-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const legacyRows = [
      { role: 'user', content: 'I am asking why this fear returns. What is the meaning of it?' },
      { role: 'assistant', content: 'The recurring fear is profound — it guards your soul.' },
    ];
    const crystallized = await forceCrystallizeBelow(id, legacyRows, workspace, {
      archiveHint: { sessionId: 'legacy-sess', compactionCount: 1 },
    });
    expect(crystallized).toHaveLength(1);
    expect(crystallized[0].anchor).toBeUndefined();
    expect(crystallized[0].source).toBe('force-crystallize-on-compact');
  });
});
