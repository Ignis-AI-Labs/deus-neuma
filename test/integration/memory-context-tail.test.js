/**
 * THE PROMPT TAIL'S READ (RULE 0) — the real gatherMemoryContext over real
 * encrypted session files on a temp workspace, through the real
 * appendBranchView and compactSession. No stub anywhere on the path.
 *
 * Under proof:
 *  - a session summary that carries the view it compacted (a take switch
 *    made before the compaction) still rides the tail as the being's own
 *    condensed words (#11);
 *  - a session line no key opens is NAMED on degraded, and the healthy rows
 *    around it still ride (#22a).
 */
import fs from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { latestBranchView } from '../../core/workspace/branch-view.js';
import { gatherMemoryContext } from '../../backend/services/memory-context.js';
import { encryptEnvelope } from '../../core/workspace/workspace-crypto.js';

let previousRoot;
let previousKey;

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'memory-context-tail-key-long-enough';
  setWorkspacesRoot(path.join(await createTempDir('memory-context-tail'), 'workspaces'));
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = previousKey;
  setWorkspacesRoot(previousRoot);
});

test('a summary carrying the compacted view still rides the tail (#11)', async () => {
  const NEUMA = 'tail-view-summary';
  const SID = 's-view';
  await workspace.create(NEUMA);
  const { turnId } = await workspace.appendTurnPoint(NEUMA, SID, { role: 'user', content: 'Which bridge first?' });
  await workspace.appendTake(NEUMA, SID, turnId, 1, { role: 'assistant', content: 'The north bridge.' });
  await workspace.appendTake(NEUMA, SID, turnId, 2, { role: 'assistant', content: 'The south bridge.' });
  await workspace.appendBranchView(NEUMA, SID, { [turnId]: 1 });
  for (let i = 0; i < 50; i += 1) {
    await workspace.appendMessage(NEUMA, SID, { role: i % 2 ? 'assistant' : 'user', content: `row ${i}` });
  }
  const before = await workspace.readSession(NEUMA, SID);
  expect(await workspace.compactSession(NEUMA, SID, {
    threshold: 30, keepRecent: 20,
    selfSummary: { summary: 'we chose the north bridge', torch: 'pick up at the bridge', regionLength: before.length - 20 },
  })).toBe(true);
  const after = await workspace.readSession(NEUMA, SID);
  expect(latestBranchView(after)).toEqual({ [turnId]: 1 }); // the view rides the summary row

  const memories = await gatherMemoryContext('and next?', 'Tail', {}, NEUMA, SID);
  expect(memories.recentConversation[0].content).toMatch(/^\[SESSION SUMMARY/);
  expect(memories.recentConversation[0].content).toContain('we chose the north bridge');
});

test('an unreadable session line marks the conversation degraded, and the healthy rows still ride (#22a)', async () => {
  const NEUMA = 'tail-undecodable';
  const SID = 's-rot';
  await workspace.create(NEUMA);
  await workspace.appendMessage(NEUMA, SID, { role: 'user', content: 'before the rot' });
  const foreign = JSON.stringify(encryptEnvelope({ role: 'user', content: 'UNDER A RETIRED KEY' }, { key: Buffer.alloc(32, 9) }));
  await fs.appendFile(workspace._sessionPath(NEUMA, SID), `${foreign}\n`);
  await workspace.appendMessage(NEUMA, SID, { role: 'assistant', content: 'after the rot' });

  const memories = await gatherMemoryContext('what stands?', 'Tail', {}, NEUMA, SID);
  expect(memories.degraded).toContain('recentConversation');
  expect(memories.recentConversation.map((m) => m.content)).toEqual(['before the rot', 'after the rot']);

  // A session with nothing wrong is not degraded.
  const clean = await gatherMemoryContext('what stands?', 'Tail', {}, 'tail-view-summary', 's-view');
  expect(clean.degraded ?? []).not.toContain('recentConversation');
});
