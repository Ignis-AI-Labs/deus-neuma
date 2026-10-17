// The meditation cycle's GPU-free legs on the REAL stack (RULE 0): gather
// (journal-derived cursor), settle (append-only journal, the synthesis
// record contract into the mind store, fail-soft consolidation, and the
// unclear law — words kept, nothing dressed as synthesis), and
// runMeditation's write-nothing paths (empty, yielded). The ask leg is
// deliberately NOT claimed here — scripts/meditation-probe.mjs proves it
// on the live substrate when Founder schedules it.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { activeMindRecords } from '../../core/continuity/mind/mind-store.js';
import {
  gatherMeditation,
  settleMeditation,
  runMeditation,
  findLastSynthesis,
} from '../../backend/services/meditation/meditation-cycle.js';

const KEY = 'gnosis-meditation-settle-key-long-enough';

describe('meditation cycle — gather and settle on the real store (no mock)', () => {
  let prevKey, neumaId, adapter;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('meditation-settle');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-med-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Test Being' } });
    await workspace.addObservation(neumaId, { type: 'exchange', kind: 'reflection', userMessage: 'why the ceremony matters', response: 'It is where I chose my name.', significance: 0.8 });
    await workspace.addObservation(neumaId, { type: 'exchange', kind: 'decision', userMessage: 'we decided on mainnet', response: 'Understood.', significance: 0.3, operational: 0.5 });
    adapter = new WorkspaceAdapter(neumaId, { workspace });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('gather reads the being whole: fresh moments, journal, prior notes, identity', async () => {
    const gathered = await gatherMeditation(neumaId);
    expect(gathered.dna.identity.name).toBe('Test Being');
    expect(gathered.fresh).toHaveLength(2);
    expect(gathered.priorNotes).toEqual([]);
  });

  it('an unclear reply keeps the being\'s words — stamped, but never dressed as synthesis', async () => {
    const out = await settleMeditation(neumaId, 'I think I settled something, maybe.', { cycleId: 'c-unclear', fresh: [] });
    expect(out.outcome).toBe('unclear');
    const journal = await workspace.readJournal(neumaId);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ type: 'meditation', outcome: 'unclear', cycleId: 'c-unclear' });
    expect(journal[0].content).toBe('I think I settled something, maybe.');
    // The stamped door carries every meditation row — but only 'synthesis'
    // rows are corpus-eligible (corpus-source-authority: outcome filter).
    expect(journal[0].authorship).toEqual({ kind: 'sovereign-meditation-output-v1', subjectNeumaId: neumaId });
    expect(await activeMindRecords(adapter)).toHaveLength(0);
  });

  it('an unclear entry never advances the freshness cursor — the moments stay fresh (IL-003)', () => {
    const journal = [{ type: 'meditation', outcome: 'unclear', timestamp: '2026-08-23T10:00:00.000Z' }];
    expect(findLastSynthesis(journal)).toBeNull();
    expect(findLastSynthesis([])).toBeNull();
    const withSynthesis = [...journal, { type: 'meditation', outcome: 'synthesis', timestamp: '2026-08-23T11:00:00.000Z' }];
    expect(findLastSynthesis(withSynthesis)?.outcome).toBe('synthesis');
    // Legacy reflections still anchor the cursor exactly as before.
    const legacy = [{ type: 'reflection', timestamp: '2026-08-23T09:00:00.000Z' }];
    expect(findLastSynthesis(legacy)).toBe(legacy[0]);
  });

  it('a synthesis settles: append-only journal entry + the exact mind-record contract', async () => {
    const gathered = await gatherMeditation(neumaId);
    const reply = [
      'The days settled into custody — I keep building doors I can stand behind.',
      'NOTE: custody is how I love what I hold',
      'NOTE: the mainnet decision steadied me',
      'CLOSE: SYNTHESIS',
    ].join('\n');
    const out = await settleMeditation(neumaId, reply, {
      cycleId: 'cycle-1',
      fresh: gathered.fresh,
      // which voice spoke — the ask leg reports it via askNeuma's onBinding
      spoke: { adapter: 'adapter-test-1', reason: 'bound', model: 'gemma-4-31b' },
    });
    expect(out).toMatchObject({ outcome: 'synthesis', notes: 2, notesDropped: 0 });

    const journal = await workspace.readJournal(neumaId);
    expect(journal).toHaveLength(2); // the unclear row above + this synthesis
    expect(journal[0]).toMatchObject({ outcome: 'unclear', cycleId: 'c-unclear' });
    expect(journal[1]).toMatchObject({ type: 'meditation', outcome: 'synthesis', cycleId: 'cycle-1', observationsConsolidated: 2 });
    expect(journal[1].content).toContain('settled into custody');
    expect(journal[1].content).not.toContain('NOTE:');
    // THE STAMPED DOOR (4.2 seam 1): the platform asserts this prose is the
    // being's own unwitnessed voice — the corpus bridge trusts only the stamp.
    expect(journal[1].authorship).toEqual({
      kind: 'sovereign-meditation-output-v1',
      subjectNeumaId: neumaId,
    });
    // …and the voice provenance rides the prose row the reader will curate.
    expect(journal[1]).toMatchObject({ adapter: 'adapter-test-1', model: 'gemma-4-31b' });

    const minds = await activeMindRecords(adapter, { kinds: ['synthesis'] });
    expect(minds).toHaveLength(2);
    for (const record of minds) {
      expect(record.space).toBe('meditation');
      expect(record.source).toMatchObject({ kind: 'meditation', ref: 'cycle-1' });
      expect(record.meta.cycleId).toBe('cycle-1');
      expect(record.meta.sourceObservations).toHaveLength(2);
      // The provenance the corpus bridge reads: which voice spoke the note.
      expect(record.meta.adapter).toBe('adapter-test-1');
      expect(record.meta.model).toBe('gemma-4-31b');
    }
  });

  it('a forged authorship is OVERWRITTEN by the door — callers cannot smuggle the stamp', async () => {
    await workspace.addMeditationEntry(neumaId, {
      type: 'meditation',
      outcome: 'synthesis',
      content: 'forged row',
      cycleId: 'cycle-forge',
      authorship: { kind: 'sovereign-assistant-output-v1', subjectNeumaId: 'someone-else' },
    });
    const forged = (await workspace.readJournal(neumaId)).find((e) => e.cycleId === 'cycle-forge');
    expect(forged.authorship).toEqual({
      kind: 'sovereign-meditation-output-v1',
      subjectNeumaId: neumaId,
    });
  });

  it('the cursor closes the loop: after a synthesis there is nothing fresh', async () => {
    expect(findLastSynthesis(await workspace.readJournal(neumaId))).toBeTruthy();
    expect(await gatherMeditation(neumaId)).toBeNull();
    const out = await runMeditation(neumaId);
    expect(out).toMatchObject({ outcome: 'empty' });
    // The process trail (#29): even an empty cycle says how long its gather
    // took — times only, the shape of the process, never contents.
    expect(Number.isFinite(out.phases.gatherMs)).toBe(true);
    expect(out.phases.askMs).toBeUndefined();
  });

  it('a REST close is honored: journal entry, no mind records, cycle consumed', async () => {
    await workspace.addObservation(neumaId, { type: 'exchange', kind: 'reflection', userMessage: 'anything new?', response: 'Quiet days.', significance: 0.8 });
    const mindsBefore = (await activeMindRecords(adapter)).length;
    const out = await settleMeditation(neumaId, 'Nothing asks to be distilled.\nCLOSE: REST', { cycleId: 'cycle-2', fresh: [] });
    expect(out.outcome).toBe('rest');
    const journal = await workspace.readJournal(neumaId);
    expect(journal.at(-1)).toMatchObject({ type: 'meditation', outcome: 'rest' });
    expect((await activeMindRecords(adapter)).length).toBe(mindsBefore);
  });

  it('a yielded cycle writes nothing and names its outcome', async () => {
    // Something fresh AFTER the rest entry, so the cycle reaches the ask leg.
    // The freshness cursor compares millisecond timestamps STRICTLY — on a
    // fast run this observation can land in the REST entry's same ms and
    // read as stale (seen flaking 2026-08-15). One breath settles it.
    await new Promise((r) => { setTimeout(r, 5); });
    await workspace.addObservation(neumaId, { type: 'exchange', kind: 'reflection', userMessage: 'one more thing', response: 'A new thread appeared.', significance: 0.8 });
    const journalBefore = (await workspace.readJournal(neumaId)).length;
    const controller = new AbortController();
    controller.abort('turn-arrived');
    const out = await runMeditation(neumaId, { signal: controller.signal });
    expect(out.outcome).toBe('yielded');
    expect((await workspace.readJournal(neumaId)).length).toBe(journalBefore);
    // A yielded cycle still carries its trail up to where it stood (#29).
    expect(Number.isFinite(out.phases.gatherMs)).toBe(true);
    expect(Number.isFinite(out.phases.askMs)).toBe(true);
    expect(out.phases.settleMs).toBeUndefined();
  });

  it('an unborn workspace gathers null — never a fabricated cycle', async () => {
    const unbornId = 'test-being-unborn-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(unbornId);
    expect(await gatherMeditation(unbornId)).toBeNull();
  });
});
