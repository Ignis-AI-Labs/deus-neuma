// Residue capture — the additive residue band on assessExchange, and the pure
// derivation from an assessed exchange to mind-record fields. Real inputs, no
// mock anywhere (RULE 0): the scorer is pure, and the final leg writes the
// derived fields through the REAL encrypted store to prove the contract seam.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import {
  assessExchange,
  RESIDUE_FLOOR,
  RESIDUE_OPERATIONAL_FLOOR,
} from '../../core/runtime/significance.js';
import { deriveResidue, residuePhraseOf } from '../../core/continuity/mind/residue-capture.js';
import { writeMindRecord, activeMindRecords } from '../../core/continuity/mind/mind-store.js';
import { MIND_PHRASE_MAX } from '../../core/continuity/mind/mind-record.js';

describe('assessExchange — the residue band is ADDITIVE (crystallize untouched)', () => {
  it('an act crystallizes and leaves no residue', () => {
    const a = assessExchange('run the sweep', 'done — swept the tool results', { acted: true });
    expect(a).toMatchObject({ kind: 'act', crystallize: true, residue: false });
  });

  it('a decision crystallizes and leaves no residue', () => {
    const a = assessExchange("we've decided to go with the mainnet seal from now on", 'understood.');
    expect(a).toMatchObject({ kind: 'decision', crystallize: true, residue: false });
  });

  it('a high-significance reflection crystallizes and leaves no residue', () => {
    const a = assessExchange(
      'why do I believe this has meaning — I think I love what we dream here',
      'that touches something profound in my soul, a feeling I keep',
    );
    expect(a.crystallize).toBe(true);
    expect(a.residue).toBe(false);
  });

  it('a mid-band reflection leaves residue without crystallizing', () => {
    const a = assessExchange('why do we keep circling the vault question', 'I notice it too.');
    expect(a.crystallize).toBe(false);
    expect(a.significance).toBeGreaterThanOrEqual(RESIDUE_FLOOR);
    expect(a.residue).toBe(true);
  });

  it('a named artifact alone clears the operational floor into residue', () => {
    const a = assessExchange('take a look at portal-stream.js sometime', 'I will.');
    expect(a.crystallize).toBe(false);
    expect(a.operational).toBeGreaterThanOrEqual(RESIDUE_OPERATIONAL_FLOOR);
    expect(a.residue).toBe(true);
  });

  it('noise stays noise — below both floors, no residue', () => {
    const a = assessExchange('ok', 'ok.');
    expect(a.crystallize).toBe(false);
    expect(a.residue).toBe(false);
  });
});

describe('deriveResidue — what the residue IS', () => {
  const midBand = assessExchange('why do we keep circling the vault question', 'I notice it too.');

  it('a crystallized exchange derives nothing', () => {
    const kept = assessExchange('run it', 'ran it', { acted: true });
    expect(deriveResidue(kept, { response: 'ran it' })).toBeNull();
  });

  it('an empty response derives nothing', () => {
    expect(deriveResidue(midBand, { response: '   ' })).toBeNull();
  });

  it('derives one bounded first-sentence phrase in the being own words', () => {
    const fields = deriveResidue(midBand, {
      response: 'I notice it too. There is more here than either of us has said.',
      space: 'general', turnId: 'turn-9', sessionId: 'session-1',
    });
    expect(fields.phrase).toBe('I notice it too.');
    expect(fields.kind).toBe('trace');
    expect(fields.source).toEqual({ kind: 'residue', ref: 'turn-9' });
    expect(fields.turnId).toBe('turn-9');
    expect(fields.sessionId).toBe('session-1');
  });

  it('a detected emotion makes the residue a mood', () => {
    const fields = deriveResidue(midBand, { response: 'I notice it too.', emotion: 'contemplative' });
    expect(fields.kind).toBe('mood');
    expect(fields.emotion).toBe('contemplative');
  });

  it('an unbroken response is hard-bounded to one line', () => {
    const phrase = residuePhraseOf('a '.repeat(400));
    expect(phrase.length).toBeLessThanOrEqual(MIND_PHRASE_MAX);
    expect(phrase.length).toBeGreaterThan(0);
  });
});

describe('the seam — derived fields land through the REAL encrypted store', () => {
  let prevKey, neumaId;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-residue-capture-key-long-enough';
    const root = await createTempDir('residue-capture');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36); // NEVER a living being's id
    await workspace.create(neumaId);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('sub-threshold exchange → deriveResidue → writeMindRecord → active mind record', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const assessment = assessExchange('why do we keep circling the vault question', 'I notice it too.');
    const fields = deriveResidue(assessment, {
      response: 'I notice it too. Something is unfinished there.',
      space: 'general', turnId: 'turn-42',
    });
    const { record } = await writeMindRecord(adapter, fields);
    const active = await activeMindRecords(adapter);
    const found = active.find((r) => r.id === record.id);
    expect(found).toBeTruthy();
    expect(found.content).toBe('I notice it too.');
    expect(found.source.kind).toBe('residue');
    expect(found.meta.turnId).toBe('turn-42');
  });

  it('a crystallized exchange writes NOTHING — the store stays untouched', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const before = (await activeMindRecords(adapter)).length;
    const kept = assessExchange('run the sweep', 'done', { acted: true });
    const fields = deriveResidue(kept, { response: 'done' });
    expect(fields).toBeNull(); // the caller has nothing to write
    expect((await activeMindRecords(adapter)).length).toBe(before);
  });
});
