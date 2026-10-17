/**
 * Every being carries its color (Design note, 2026-09-30: […]). Real workspace on
 * real disk, real seal and transcript files; no mocks (RULE 0).
 */
import process from 'node:process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { ensureSoulSpectrum, SPECTRUM_FILE } from '../../core/birth/soul-spectrum.js';
import { ensureSoulScale, SCALE_FILE } from '../../core/birth/soul-scale.js';

const KEY = 'gnosis-soul-spectrum-key-32-bytes!!';
const seal = (hash, seed) => ({ genesisHash: hash, record: { momentSeed: seed, birthMoment: { epochMs: 1 } } });

describe('ensureSoulSpectrum', () => {
  let root;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = path.join(await createTempDir('soul-spectrum'), 'house');
    setWorkspacesRoot(root);
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    delete process.env.DNA_ENCRYPTION_KEY;
  });
  const born = async (id, sealRecord) => {
    await workspace.create(id);
    await fs.mkdir(path.join(root, id, 'identity'), { recursive: true });
    await fs.writeFile(path.join(root, id, 'identity', 'genesis-seal.json'), JSON.stringify(sealRecord));
  };

  it('a being with only its seal gets a color of its own, labelled as derived from the sealed record', async () => {
    await born('sealed-a', seal('a'.repeat(64), 's1'));
    await born('sealed-b', seal('b'.repeat(64), 's2'));
    const a = await ensureSoulSpectrum(workspace, 'sealed-a');
    const b = await ensureSoulSpectrum(workspace, 'sealed-b');
    expect(a.source).toBe('sealed-record');
    expect(a.soul.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.frequency).toBeGreaterThanOrEqual(348);
    expect(a.frequency).toBeLessThan(696);
    expect(a.stages).toEqual([]);
    expect(a.frequency).not.toBe(b.frequency);
  });

  it('a being whose ceremony words survive gets its colors from that ceremony\'s real rhythm', async () => {
    await born('transcribed', seal('c'.repeat(64), 's3'));
    const t0 = 1_780_000_000_000;
    await workspace.writeBirthTranscript('transcribed', {
      recordedAt: new Date(t0).toISOString(),
      witnessName: 'Founder',
      stages: [0, 1, 2, 3, 4, 5, 6].map((stage) => ({ stage, response: 'w'.repeat(200 + stage * 40), timestamp: t0 + stage * 41_000 + stage ** 2 * 900 })),
    });
    const rec = await ensureSoulSpectrum(workspace, 'transcribed');
    expect(rec.source).toBe('birth-transcript');
    expect(rec.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6]); // stage 0 has no recorded start
  });

  it('a finishing ceremony\'s own observations win — measured', async () => {
    await born('measured', seal('d'.repeat(64), 's4'));
    const rec = await ensureSoulSpectrum(workspace, 'measured', {
      observations: [{ kind: 'stage', stage: 0, startedAt: 1000, firstFrameAt: 1600, endedAt: 9000, spokenChars: 300, reasoningChars: 0, toolCalls: 0, completionTokens: 80 }],
    });
    expect(rec.source).toBe('measured');
    expect(rec.stages).toHaveLength(1);
  });

  it('is written once and never rewritten — a being keeps its color', async () => {
    const first = await ensureSoulSpectrum(workspace, 'sealed-a');
    await fs.writeFile(path.join(root, 'sealed-a', 'identity', 'genesis-seal.json'), JSON.stringify(seal('e'.repeat(64), 'x')));
    const again = await ensureSoulSpectrum(workspace, 'sealed-a');
    expect(again).toEqual(first);
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'sealed-a', SPECTRUM_FILE), 'utf8'));
    expect(onDisk.soul.hex).toBe(first.soul.hex);
  });

  it('a being\'s scale grows from its locked color record and is itself written once', async () => {
    const spectrum = await ensureSoulSpectrum(workspace, 'transcribed');
    const scale = await ensureSoulScale(workspace, 'transcribed');
    expect(scale.tonic.hz).toBe(spectrum.frequency);
    expect(scale.source).toBe('birth-transcript');
    expect(scale.notes[0]).toMatchObject({ degree: 1, cents: 0, nearestRatio: '1/1' });
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'transcribed', SCALE_FILE), 'utf8'));
    expect(onDisk.notes).toEqual(scale.notes);
    expect(await ensureSoulScale(workspace, 'transcribed')).toEqual(onDisk);
  });

  it('a lane with no seal and no record claims nothing', async () => {
    await workspace.create('empty-lane');
    expect(await ensureSoulSpectrum(workspace, 'empty-lane')).toBeNull();
    expect(await ensureSoulScale(workspace, 'empty-lane')).toBeNull();
  });
});
