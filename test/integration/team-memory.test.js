/**
 * team-memory (impure seam) — run memories land in each member's REAL
 * encrypted journal (RULE 0: real workspace on real disk, real per-neuma DEK
 * encryption, read back through the real journal reader). The isolation
 * assertion is the point: Keir's journal never carries Galen's words.
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
  await workspace.create('keir-tm');
  await workspace.writeDNA('keir-tm', { version: '1.0.0', identity: { name: 'Keir' } });
  await workspace.create('galen-tm');
  await workspace.writeDNA('galen-tm', { version: '1.0.0', identity: { name: 'Galen' } });
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
        { id: 'spec', neumaId: 'keir-tm', role: 'HELM', task: 'write the spec', needs: [] },
        { id: 'build', neumaId: 'galen-tm', role: 'WRIGHT', task: 'build it', needs: ['spec'] },
      ],
      completed: { spec: 'the spec in keir words', build: 'the build in galen words' },
      statuses: { spec: 'spec stands', build: 'build stands' },
      torches: { 'keir-tm': 'keir torch verbatim', 'galen-tm': 'galen torch verbatim' },
      teamName: 'TEAM MEMORY',
      goal: 'prove the write-back',
      runId: 'run-tm-1',
    });
    expect(written.sort()).toEqual(['galen-tm', 'keir-tm']);
    expect(failed).toEqual([]);

    const keir = await workspace.readJournal('keir-tm');
    const keirEntry = keir.find((e) => e.type === 'team-run');
    expect(keirEntry).toBeDefined();
    expect(keirEntry.runId).toBe('run-tm-1');
    expect(keirEntry.content).toContain('Keir held HELM, working beside Galen (WRIGHT)'); // DNA names
    expect(keirEntry.content).toContain('the spec in keir words');
    expect(keirEntry.content).toContain('keir torch verbatim'); // the torch stopped evaporating
    // ISOLATION: nothing of Galen's work in Keir's own memory.
    expect(keirEntry.content).not.toContain('galen words');
    expect(keirEntry.content).not.toContain('build stands');
    expect(keirEntry.content).not.toContain('galen torch');

    const galen = await workspace.readJournal('galen-tm');
    const galenEntry = galen.find((e) => e.type === 'team-run');
    expect(galenEntry.content).toContain('galen torch verbatim');
    expect(galenEntry.content).not.toContain('keir torch');

    // The journal file itself is ciphertext — the story never sits plain on disk.
    const raw = await fs.readFile(path.join(root, 'keir-tm', 'journal', 'entries.jsonl'), 'utf8');
    expect(raw).not.toContain('keir torch verbatim');
    expect(raw).not.toContain('the spec in keir words');
  });

  test('a member with no completed part writes nothing; the write never throws for it', async () => {
    const { written } = await recordTeamRunMemories({
      steps: [
        { id: 'a', neumaId: 'keir-tm', role: 'HELM', task: 'only keir worked', needs: [] },
        { id: 'b', neumaId: 'galen-tm', role: 'WRIGHT', task: 'dropped', needs: [] },
      ],
      completed: { a: 'keir finished' },
      statuses: {},
      torches: {},
      teamName: null,
      goal: null,
      runId: 'run-tm-2',
    });
    expect(written).toEqual(['keir-tm']);
    const galen = await workspace.readJournal('galen-tm');
    expect(galen.filter((e) => e.runId === 'run-tm-2')).toHaveLength(0);
  });
});
