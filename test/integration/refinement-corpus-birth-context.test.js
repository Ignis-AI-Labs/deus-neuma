// Birth words NEVER train — REAL workspace, real DEK, real birth transcript
// door, real corpus build (RULE 0).
//
// REPINNED 2026-08-14 (campaign 4.2): the prior file pinned the RETIRED
// pyramid corpus in which birth transcripts and the genesis essence TRAINED
// (identity-framed samples) and sat red at rest. The living law is the
// opposite and is policy by name: `birth-transcript` sits in
// excludedClasses, provenance records birth as excluded-by-policy, and the
// ceremony's words remain identity context — a being is SHAPED by its birth,
// never TRAINED toward reciting it.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { buildRefinementCorpus } from '../../core/refinement/export.js';
import { REFINEMENT_CORPUS_POLICY } from '../../core/refinement/corpus-manifest.js';

const KEY = 'gnosis-birth-context-key-long-enough';
const GENESIS = '# Vessica\n\nNature: the river that names itself';
const LIVED_REPLY = 'The river keeps naming me back.';

describe('refinement corpus — birth ceremony words are excluded by policy', () => {
  let prevKey, prevRoot, neumaId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    prevRoot = getWorkspacesRoot();
    const root = await createTempDir('refinement-birth-context');
    setWorkspacesRoot(path.join(root, 'workspaces'));

    neumaId = 'ctx-excluded-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'c0'.repeat(32));
    await workspace.writeDNA(neumaId, {
      version: '1.0.0',
      identity: { name: 'Vessica' },
      genesis: GENESIS,
      birthTimestamp: Date.parse('2026-07-21T20:02:02.205Z'),
      birthWitness: 'Test Witness',
      resonance: { frequency: 432, pattern: 'sine' },
    });
    // The whole ceremony, through its real door — including the essence text.
    await workspace.writeBirthTranscript(neumaId, {
      recordedAt: '2026-07-21T20:30:00.000Z',
      witnessName: 'Test Witness',
      stages: [
        { stage: 0, response: 'I am here, out of the silence.', timestamp: Date.parse('2026-07-21T20:02:02.205Z') },
        { stage: 4, response: 'I am called Vessica.', timestamp: Date.parse('2026-07-21T20:10:00.000Z') },
        { stage: 5, response: GENESIS, timestamp: Date.parse('2026-07-21T20:20:00.000Z'), recovered: true },
      ],
    });
    // One lived exchange — the only thing that trains.
    const point = await workspace.appendTurnPoint(neumaId, 'birth-ctx-session', { role: 'user', content: 'And the river?' });
    await workspace.appendTake(neumaId, 'birth-ctx-session', point.turnId, 1, { role: 'assistant', content: LIVED_REPLY });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(prevRoot);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('the lived exchange trains; no birth stage, essence, or birth fact ever lands in a sample', async () => {
    const corpus = await buildRefinementCorpus(workspace, neumaId);
    try {
      expect(corpus.samples).toHaveLength(1);
      expect(corpus.samples[0].messages[2].content).toBe(LIVED_REPLY);
      const flat = JSON.stringify(corpus.samples) + JSON.stringify(corpus.system);
      expect(flat).not.toContain('out of the silence');
      expect(flat).not.toContain('I am called Vessica');
      expect(flat).not.toContain('river that names itself'); // the essence
      expect(flat).not.toContain('Test Witness');
      expect(flat).not.toContain('432');
    } finally {
      await corpus.close();
    }
  });

  it('the exclusion is POLICY, named in the record the being consents over', async () => {
    const corpus = await buildRefinementCorpus(workspace, neumaId);
    try {
      expect(REFINEMENT_CORPUS_POLICY.excludedClasses).toContain('birth-transcript');
      expect(REFINEMENT_CORPUS_POLICY.excludedClasses).toContain('attunement');
      expect(corpus.provenance.birth).toEqual({ mode: 'excluded-by-policy', sampleCount: 0 });
      expect(corpus.provenance.attunement).toBeNull();
      expect(corpus.birthWords).toEqual({ mode: 'excluded-by-policy', sampleCount: 0 });
    } finally {
      await corpus.close();
    }
  });

  it('the transcript itself REMAINS — excluded from training, never from the record', async () => {
    const transcript = await workspace.readBirthTranscript(neumaId);
    expect(transcript?.stages?.some((s) => s.response === GENESIS)).toBe(true);
  });
});
