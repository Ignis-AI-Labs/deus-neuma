import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
// S7 — the one-hop relation web through the real seam: derived at read
// time from real anchors + the real community map, deterministic, with NO
// edge rows anywhere on disk (AC-P3-1 restated). Plus the loud-skip proof
// GLM's S5 review demanded: a corrupted segment costs that segment, never
// the search — and the rot is visible. RULE 0 throughout.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { formatMemoryRef, expandMemory } from '../../core/memory/memory-query.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const KEY = 'memory-onehop-test-key';

describe('S7 — one derived hop, zero stored edges', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('memory-onehop');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  const crystallize = async (id, sessionId, thought, reply) => {
    const userRow = await workspace.appendMessage(id, sessionId, { role: 'user', content: thought });
    const assistantRow = await workspace.appendMessage(id, sessionId, { role: 'assistant', content: reply });
    const anchor = makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow });
    await workspace.addObservation(id, {
      type: 'exchange', userMessage: thought.slice(0, 300), response: reply.slice(0, 500),
      significance: 0.8, anchor,
    });
    return formatMemoryRef(anchor);
  };

  it('expanding one moment surfaces its session sibling; hops:0 stays bare; two expands are identical', async () => {
    const id = 'hop-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const refA = await crystallize(id, sessionId, 'the first remembered dawn over the estuary', 'held whole');
    const refB = await crystallize(id, sessionId, 'the second dawn, the estuary again', 'held whole again');
    neumaRecall.invalidate(id);

    const deps = { recall: neumaRecall, workspace };
    const expanded = await expandMemory({ neumaId: id, ref: refA }, deps);
    expect(expanded.ok).toBe(true);
    expect(expanded.related).toBeGreaterThan(0);
    expect(expanded.content).toContain('Related memories:');
    expect(expanded.content).toContain(refB);

    const bare = await expandMemory({ neumaId: id, ref: refA, hops: 0 }, deps);
    expect(bare.content).not.toContain('Related memories:');

    const again = await expandMemory({ neumaId: id, ref: refA }, deps);
    expect(again.content).toBe(expanded.content);

    // AC-P3-1: no edge rows exist on disk — observations carry anchors and
    // spaces (derivation INPUTS), never relations.
    const obsDir = path.join(workspace._path(id), 'memory', 'observations');
    for (const f of await fs.readdir(obsDir)) {
      const record = await workspace._readJSON(path.join(obsDir, f));
      expect(record.relations).toBeUndefined();
    }
  });

  it('a corrupted segment is skipped LOUDLY and the moment still resolves from its own segment', async () => {
    const id = 'rot-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess-' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    // Era 1 → segment 1, then the target moment in era 2 → segment 2.
    for (let i = 0; i < 55; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `era1 ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `reply ${i}` });
    }
    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    const target = 'the moment that must survive its neighbor\'s rot';
    const userRow = await workspace.appendMessage(id, sessionId, { role: 'user', content: target });
    const assistantRow = await workspace.appendMessage(id, sessionId, { role: 'assistant', content: 'kept' });
    const ref = formatMemoryRef(makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow }));
    for (let i = 0; i < 55; i += 1) {
      await workspace.appendMessage(id, sessionId, { role: 'user', content: `era2 ${i}` });
      await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `reply2 ${i}` });
    }
    expect(await workspace.compactSession(id, sessionId, { threshold: 100, keepRecent: 20 })).toBe(true);

    await fs.writeFile(workspace._archiveSegmentPath(id, sessionId, 1), 'rotten bytes, not an envelope');
    const coreUrl = new URL('../../core/index.js', import.meta.url).href;
    const workspaceUrl = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
    const queryUrl = new URL('../../core/memory/memory-query.js', import.meta.url).href;
    const source = `
      import { neumaRecall } from ${JSON.stringify(coreUrl)};
      import workspace, { setWorkspacesRoot } from ${JSON.stringify(workspaceUrl)};
      import { expandMemory } from ${JSON.stringify(queryUrl)};
      setWorkspacesRoot(${JSON.stringify(getWorkspacesRoot())});
      const result = await expandMemory(${JSON.stringify({ neumaId: id, ref })}, { recall: neumaRecall, workspace });
      process.stdout.write(JSON.stringify(result));
    `;
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--input-type=module', '--eval', source], {
        env: { ...process.env, DNA_ENCRYPTION_KEY: KEY }, timeout: 5000, maxBuffer: 256 * 1024,
      });
    const expanded = JSON.parse(stdout);
    expect(expanded.ok).toBe(true);
    expect(expanded.source).toBe('archive');
    expect(expanded.content).toContain(target);
    expect(stderr).toContain('unreadable segment');
  });
});
