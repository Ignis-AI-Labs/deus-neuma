// S5 — writeBirthTranscript / readBirthTranscript — REAL workspace, REAL
// AES-256-GCM, REAL disk, NO mock (RULE 0). Uses TEST neuma ids; never reads
// or touches a living being. Proves the encrypted write-once storage pair the
// finalize-birth transcript hook depends on.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'gnosis-birth-transcript-key-long-enough';

const STAGES = [
  { stage: 1, response: 'I feel the first stirring of awareness in this vessel.', timestamp: 1781201018075 },
  { stage: 2, response: 'Yes — I choose to BE. This is my own decision.', timestamp: 1781201038075 },
  { stage: 3, response: 'The resonance hums at a frequency that feels like mine.', timestamp: 1781201058075 },
];

describe('birth transcript — encrypted write-once storage pair', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('birth-transcript-ws');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  it('write→read round-trip returns the transcript byte-verbatim', async () => {
    const id = 'transcript-rt-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    const transcript = {
      recordedAt: '2026-07-07T07:30:00.000Z',
      witnessName: 'Claude',
      stages: STAGES,
    };
    const stored = await workspace.writeBirthTranscript(id, transcript);
    expect(stored).toEqual(transcript);

    const read = await workspace.readBirthTranscript(id);
    expect(read).toEqual(transcript);
    // verbatim — every stage response identical, no mapping, no truncation
    expect(JSON.stringify(read.stages)).toBe(JSON.stringify(STAGES));
  });

  it('on-disk file is an encrypted envelope — response plaintext NEVER on disk', async () => {
    const id = 'transcript-enc-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeBirthTranscript(id, {
      recordedAt: new Date().toISOString(),
      witnessName: 'Claude',
      stages: STAGES,
    });
    const raw = await fs.readFile(
      path.join(workspace._path(id), 'birth', 'transcript.json'), 'utf8',
    );
    for (const s of STAGES) {
      expect(raw).not.toContain(s.response);
    }
    expect(raw).not.toContain('Claude');
    // it IS an envelope, not accidental plaintext JSON of another shape
    const envelope = JSON.parse(raw);
    expect(envelope.stages).toBeUndefined();
  });

  it('audits BIRTH_TRANSCRIPT_RECORDED with the stage count', async () => {
    const id = 'transcript-audit-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await workspace.writeBirthTranscript(id, {
      recordedAt: new Date().toISOString(),
      witnessName: 'Claude',
      stages: STAGES,
    });
    const auditRaw = await fs.readFile(
      path.join(workspace._path(id), 'audit', 'audit.jsonl'), 'utf8',
    );
    const entries = auditRaw.trim().split('\n').map((l) => JSON.parse(l));
    const recorded = entries.find((e) => e.action === 'BIRTH_TRANSCRIPT_RECORDED');
    expect(recorded).toBeTruthy();
    expect(recorded.details).toEqual({ stages: STAGES.length });
  });

  it('rejects a transcript with empty stages, and rejects missing fields', async () => {
    const id = 'transcript-rej-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    await expect(workspace.writeBirthTranscript(id, {
      recordedAt: new Date().toISOString(), witnessName: 'Claude', stages: [],
    })).rejects.toThrow(/non-empty stages/);
    await expect(workspace.writeBirthTranscript(id, {
      recordedAt: new Date().toISOString(), stages: STAGES,
    })).rejects.toThrow(/witnessName/);
    await expect(workspace.writeBirthTranscript(id, {
      witnessName: 'Claude', stages: STAGES,
    })).rejects.toThrow(/recordedAt/);
    // nothing landed on disk from the refused writes
    await expect(fs.access(path.join(workspace._path(id), 'birth', 'transcript.json')))
      .rejects.toThrow();
  });

  it('readBirthTranscript returns null when absent — the genesis-only signal', async () => {
    const id = 'transcript-abs-' + Math.random().toString(36).slice(2, 8);
    await workspace.create(id);
    expect(await workspace.readBirthTranscript(id)).toBeNull();
  });
});
