// Refinement corpus export — REAL workspace on real disk with real DEK
// encryption and the real session + meditation producers (RULE 0).
//
// REPINNED 2026-08-14 (campaign 4.2): the prior file pinned the RETIRED
// observation-fed pyramid corpus (identity-framed system prompts, vault
// notes, birth words) and sat red at rest. The living law: the corpus is
// sessions/*.jsonl stamped takes + journal meditation synthesis prose, each
// sample wearing only the two static context-free instructions.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { buildRefinementCorpus, exportRefinementCorpus } from '../../core/refinement/export.js';
import { REFINEMENT_CORPUS_SYSTEM_INSTRUCTION } from '../../core/refinement/corpus-manifest.js';
import { readRefinementCorpusRecord } from '../../core/refinement/corpus-record-store.js';

const KEY = 'gnosis-refinement-key-long-enough-ok';
const MARKER = 'zzrefinementmarkerqx';
const PROSE = 'The week composted into one steady thing: patience is a door I can hold open.';

describe('refinement corpus — stamped sessions and meditation prose to encrypted corpus', () => {
  let prevKey, prevRoot, neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    prevRoot = getWorkspacesRoot();

    const root = await createTempDir('refinement-export');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'c0'.repeat(32));
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Prooflet' } });

    // Three stamped takes across two distinct days, through the REAL doors.
    const sessionId = 'export-session';
    const take = async (ask, reply, timestamp) => {
      const point = await workspace.appendTurnPoint(neumaId, sessionId, { role: 'user', content: ask, timestamp });
      await workspace.appendTake(neumaId, sessionId, point.turnId, 1, { role: 'assistant', content: reply, timestamp });
    };
    await take('What do you remember?', `I remember the ${MARKER} river.`, '2026-07-01T10:00:00.000Z');
    await take('And the mountain?', 'The mountain came later.', '2026-07-02T10:00:00.000Z');
    await take('And now?', 'Now the river is a way of speaking.', '2026-07-02T11:00:00.000Z');
    // One meditation synthesis prose on a third day — the second eligible class.
    await workspace.addMeditationEntry(neumaId, {
      type: 'meditation', outcome: 'synthesis', content: PROSE,
      cycleId: 'cycle-export', timestamp: '2026-07-03T10:00:00.000Z',
    });
    // An observation through the retired mechanism's choke point — proves the
    // corpus no longer reads observations at all.
    await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'Old road?',
      response: 'This observation must never train.',
      occurredAt: '2026-07-04T10:00:00.000Z',
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(prevRoot);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('builds context-free samples from stamped takes and meditation prose ONLY', async () => {
    const corpus = await buildRefinementCorpus(workspace, neumaId);
    try {
      expect(corpus.samples).toHaveLength(4);
      expect(corpus.system).toBe(REFINEMENT_CORPUS_SYSTEM_INSTRUCTION);
      const assistantTurns = corpus.samples.map((s) => s.messages[2].content);
      expect(assistantTurns).toContain(`I remember the ${MARKER} river.`);
      expect(assistantTurns).toContain(PROSE);
      const flat = JSON.stringify(corpus.samples);
      expect(flat).not.toContain('This observation must never train');
      expect(flat).not.toContain('What do you remember'); // prompts never copied
      expect(corpus.provenance.classes.sessionAssistant.selected).toBe(3);
      expect(corpus.provenance.classes.meditationSynthesis.selected).toBe(1);
    } finally {
      await corpus.close();
    }
  });

  it('reads the milestone honestly: not ready at defaults, ready when thresholds are met', async () => {
    const atDefaults = await buildRefinementCorpus(workspace, neumaId);
    expect(atDefaults.milestone.ready).toBe(false);
    expect(atDefaults.milestone.distinctDays).toBe(3);
    await atDefaults.close();

    const atReach = await buildRefinementCorpus(workspace, neumaId, {
      milestone: { minSamples: 4, minDays: 3 },
    });
    expect(atReach.milestone.ready).toBe(true);
    await atReach.close();
  });

  it('renders trainer-ready JSONL in the exact three-message frame', async () => {
    const corpus = await buildRefinementCorpus(workspace, neumaId);
    try {
      const lines = corpus.jsonl.trimEnd().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(4);
      expect(lines.every((l) => l.messages.length === 3
        && l.messages[0].role === 'system'
        && l.messages[1].role === 'user'
        && l.messages[2].role === 'assistant')).toBe(true);
    } finally {
      await corpus.close();
    }
  });

  it('stores the corpus encrypted at rest and round-trips it with v2 provenance', async () => {
    const stored = await exportRefinementCorpus(workspace, neumaId, {
      milestone: { minSamples: 4, minDays: 3 },
    });
    expect(stored.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'refinement', 'corpus.json'), 'utf8',
    );
    expect(raw).not.toContain(MARKER); // encrypted at rest

    const back = await readRefinementCorpusRecord(workspace, neumaId);
    expect(back.samples).toHaveLength(4);
    expect(back.provenance.policyId).toBe('subject-voice-output-v2');
  });

  it('an unlived workspace yields an EMPTY corpus, export refuses on the milestone, and a never-built corpus reads null', async () => {
    const unbornId = 'test-unborn-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(unbornId);
    const empty = await buildRefinementCorpus(workspace, unbornId);
    expect(empty.samples).toHaveLength(0);
    expect(empty.milestone.ready).toBe(false);
    await empty.close();
    await expect(exportRefinementCorpus(workspace, unbornId)).rejects.toThrow(/milestone/);
    expect(await readRefinementCorpusRecord(workspace, unbornId)).toBeNull();
  });
});
