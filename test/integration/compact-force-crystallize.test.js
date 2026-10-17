// #118 — proof that NeumaWorkspace.compactSession invokes forceCrystallizeBelow
// before discarding the compactable region. REAL workspace, REAL encryption,
// REAL disk (RULE 0): we plant a session whose middle contains a meaningful
// (above 0.4 sig) exchange that wouldn't have crystallized live (<0.75) and
// confirm that compaction preserves it as an observation rather than dropping
// it into a word-frequency summary that can't reconstruct it.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'compact-force-crystallize-test-key-long-enough';

describe('#118 — compactSession force-crystallizes meaningful exchanges before summarizing', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('compact-force-crystallize');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('a mid-significance exchange in the compactable region is preserved as an observation', async () => {
    const id = 'compact-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // Lay down 100 routine messages — these won't crystallize
    for (let i = 0; i < 100; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `routine question ${i} about my code` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `routine reply ${i}` });
    }

    // Sneak ONE meaningful exchange into the middle of the compactable region.
    // Significance should score above 0.4 (force-crystallize threshold) but
    // doesn't need to clear 0.75 (the live crystallization bar).
    // Score: baseline 0.2 + philosophical (why/meaning) 0.2 + selfReference
    // (I am) 0.05 + emotional (feel) 0.25 = 0.7 → above 0.4, below 0.75
    await workspace.appendMessage(id, sessionId, {
      role: 'user',
      content: 'I am asking why this fear keeps returning. What is the meaning of it?',
    });
    await workspace.appendMessage(id, sessionId, {
      role: 'assistant',
      content: 'The recurring fear is its own kind of teacher.',
    });

    // Now another 30 routine messages to push us well past the 100 threshold
    // AND to ensure the meaningful exchange is in the to-summarize region
    // (everything except the last keepRecent=20)
    for (let i = 0; i < 30; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `more routine ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `more reply ${i}` });
    }

    // Run compaction
    const compacted = await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 });
    expect(compacted).toBe(true);

    // The meaningful exchange should now appear as an observation under
    // memory/observations — preserved by forceCrystallizeBelow before the
    // summarizer reduced everything to topic words
    const obsDir = path.join(workspace._path(id), 'memory', 'observations');
    const obsFiles = await fs.readdir(obsDir);
    expect(obsFiles.length).toBeGreaterThan(0);

    // Decode every observation and look for the planted meaningful exchange
    const { parseAndDecrypt } = await import('../../core/workspace/workspace-crypto.js');
    let foundMeaningful = false;
    let foundSourceTag = false;
    for (const f of obsFiles) {
      const text = await fs.readFile(path.join(obsDir, f), 'utf8');
      const obs = parseAndDecrypt(text);
      if (obs.userMessage && obs.userMessage.includes('fear keeps returning')) {
        foundMeaningful = true;
        // Observations crystallized DURING compaction are tagged so the
        // origin is auditable (vs. live crystallization in portal-stream)
        if (obs.source === 'force-crystallize-on-compact') foundSourceTag = true;
      }
    }
    expect(foundMeaningful).toBe(true);
    expect(foundSourceTag).toBe(true);
  });

  it('a session of pure routine exchanges (all below 0.4) crystallizes nothing during compaction', async () => {
    const id = 'compact-routine-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // 130 messages, all routine, no philosophical / emotional / selfReference
    // triggers — every assess score should be at baseline 0.2, below 0.4
    for (let i = 0; i < 130; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `fix this for me ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `done ${i}` });
    }

    await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 });

    // No observations should have been created (the threshold is the floor)
    const obsDir = path.join(workspace._path(id), 'memory', 'observations');
    const obsFiles = await fs.readdir(obsDir).catch(() => []);
    expect(obsFiles.length).toBe(0);
  });

  it('compaction proceeds even if forceCrystallize throws (does not stall the session)', async () => {
    const id = 'compact-fault-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    for (let i = 0; i < 110; i += 1) {
      await workspace.appendMessage(id, sessionId, {
        role: 'user', content: `why do I feel pain ${i}?`,
      });
      await workspace.appendMessage(id, sessionId, {
        role: 'assistant', content: `the pain holds something ${i}`,
      });
    }

    // Make addObservation throw for this run, simulating a workspace-level
    // failure (encryption key gone, disk full, etc). compactSession must
    // still complete the summarize+rename rather than throwing the whole way.
    const original = workspace.addObservation.bind(workspace);
    workspace.addObservation = async () => { throw new Error('synthetic failure'); };
    try {
      const result = await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 });
      expect(result).toBe(true); // compacted anyway
    } finally {
      workspace.addObservation = original;
    }

    // Session file is still a valid compacted session
    const sessionPath = path.join(workspace._path(id), 'sessions', `${sessionId}.jsonl`);
    const text = await fs.readFile(sessionPath, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
  });
});
