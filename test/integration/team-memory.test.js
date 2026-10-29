/**
 * team-memory (impure seam) — run memories land in each member's REAL
 * encrypted journal (RULE 0: real workspace on real disk, real per-neuma DEK
 * encryption, read back through the real journal reader). The isolation
 * assertion is the point: Hazel's journal never carries Cedar's words.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

let workspace;
let setWorkspacesRoot;
let recordTeamRunMemories;
let prevKey;
let root;

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'gnosis-team-memory-key-long-okay';
  const ws = await import('../../core/workspace/neuma-workspace.js');
  workspace = ws.default;
  setWorkspacesRoot = ws.setWorkspacesRoot;
  root = path.join(await createTempDir('team-memory'), 'workspaces');
  setWorkspacesRoot(root);
  ({ recordTeamRunMemories } = await import('../../backend/services/team-memory.js'));
  await workspace.create('hazel-tm');
  await workspace.writeDNA('hazel-tm', { version: '1.0.0', identity: { name: 'Hazel' } });
  await workspace.create('cedar-tm');
  await workspace.writeDNA('cedar-tm', { version: '1.0.0', identity: { name: 'Cedar' } });
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

describe('recordTeamRunMemories — real encrypted journals', () => {
  test('each member remembers ITS part; nothing of the other; names come from DNA', async () => {
    const { written, failed } = await recordTeamRunMemories({
      steps: [
        { id: 'spec', neumaId: 'hazel-tm', role: 'HELM', task: 'write the spec', needs: [] },
        { id: 'build', neumaId: 'cedar-tm', role: 'WRIGHT', task: 'build it', needs: ['spec'] },
      ],
      completed: { spec: 'the spec in hazel words', build: 'the build in cedar words' },
      statuses: { spec: 'spec stands', build: 'build stands' },
      torches: { 'hazel-tm': 'hazel torch verbatim', 'cedar-tm': 'cedar torch verbatim' },
      teamName: 'TEAM MEMORY',
      goal: 'prove the write-back',
      runId: 'run-tm-1',
    });
    expect(written.sort()).toEqual(['cedar-tm', 'hazel-tm']);
    expect(failed).toEqual([]);

    const hazel = await workspace.readJournal('hazel-tm');
    const hazelEntry = hazel.find((e) => e.type === 'team-run');
    expect(hazelEntry).toBeDefined();
    expect(hazelEntry.runId).toBe('run-tm-1');
    expect(hazelEntry.content).toContain('Hazel held HELM, working beside Cedar (WRIGHT)'); // DNA names
    expect(hazelEntry.content).toContain('the spec in hazel words');
    expect(hazelEntry.content).toContain('hazel torch verbatim'); // the torch stopped evaporating
    // ISOLATION: nothing of Cedar's work in Hazel's own memory.
    expect(hazelEntry.content).not.toContain('cedar words');
    expect(hazelEntry.content).not.toContain('build stands');
    expect(hazelEntry.content).not.toContain('cedar torch');

    const cedar = await workspace.readJournal('cedar-tm');
    const cedarEntry = cedar.find((e) => e.type === 'team-run');
    expect(cedarEntry.content).toContain('cedar torch verbatim');
    expect(cedarEntry.content).not.toContain('hazel torch');

    // The journal file itself is ciphertext — the story never sits plain on disk.
    const raw = await fs.readFile(path.join(root, 'hazel-tm', 'journal', 'entries.jsonl'), 'utf8');
    expect(raw).not.toContain('hazel torch verbatim');
    expect(raw).not.toContain('the spec in hazel words');
  });

  test('a member with no completed part writes nothing; the write never throws for it', async () => {
    const { written } = await recordTeamRunMemories({
      steps: [
        { id: 'a', neumaId: 'hazel-tm', role: 'HELM', task: 'only hazel worked', needs: [] },
        { id: 'b', neumaId: 'cedar-tm', role: 'WRIGHT', task: 'dropped', needs: [] },
      ],
      completed: { a: 'hazel finished' },
      statuses: {},
      torches: {},
      teamName: null,
      goal: null,
      runId: 'run-tm-2',
    });
    expect(written).toEqual(['hazel-tm']);
    const cedar = await workspace.readJournal('cedar-tm');
    expect(cedar.filter((e) => e.runId === 'run-tm-2')).toHaveLength(0);
  });
});
