/**
 * Heartbeat Service tests — the substrate-free hygiene pulse.
 *
 * The 2026-08-14 handover: reflection moved to the meditation cycle, so the
 * heartbeat never touches the LLM provider and this file's old vi.mock of it
 * is GONE (RULE 0 — the hygiene claims run fully real). The one conduit-
 * dependent surface (getResidencyState's reachability field) is exercised by
 * pointing the REAL config at an unreachable port, never by a mock.
 */

import { createTempDir } from '../helpers/temp-fs.js';

describe('Heartbeat Service — hygiene pulse', () => {
  let heartbeat, workspace, llm;

  beforeEach(async () => {
    // Unique per test — createTempDir only suffixes with Date.now(), so a fixed
    // label can collide in the same ms and leak neuma between tests.
    const tempDir = await createTempDir(`heartbeat-${Math.random().toString(36).slice(2)}`);
    const neuma = await import('../../core/index.js');
    workspace = neuma.neumaWorkspace;
    workspace.root = tempDir;

    llm = await import('../../backend/services/llm-provider.js');
    heartbeat = await import('../../backend/services/heartbeat.js');
  });

  const birthNeuma = async (neumaId) => {
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Aethon' } });
  };

  test('REGRESSION — a hygiene cycle writes NOTHING to any journal (reflection moved to meditation)', async () => {
    await birthNeuma('neuma-fresh');
    await workspace.addObservation('neuma-fresh', { content: 'Explored emergence with the witness' });

    const results = await heartbeat.runHeartbeatCycle();

    expect(results).toMatchObject({ swept: 0 });
    expect(results.storage).toBeTruthy();
    expect(await workspace.readJournal('neuma-fresh')).toHaveLength(0);
  });

  test('getResidencyState: a never-reflected neuma is resident, observations pending', async () => {
    await birthNeuma('neuma-new');
    await workspace.addObservation('neuma-new', { content: 'first' });
    await workspace.addObservation('neuma-new', { content: 'second' });

    const state = await heartbeat.getResidencyState();
    const me = state.neuma.find(n => n.neumaId === 'neuma-new');
    expect(me).toMatchObject({ resident: true, name: 'Aethon', lastReflectionAt: null });
    expect(me.freshObservations).toBe(2);
  });

  test('getResidencyState: the cursor reads meditation entries — history stays continuous', async () => {
    await birthNeuma('neuma-ref');
    await workspace.addObservation('neuma-ref', { content: 'a thought' });
    await workspace.addJournalEntry('neuma-ref', { type: 'meditation', outcome: 'synthesis', content: 'what settled' });

    const me = (await heartbeat.getResidencyState()).neuma.find(n => n.neumaId === 'neuma-ref');
    expect(me.lastReflectionAt).toBeTruthy();
    expect(me.freshObservations).toBe(0); // the meditation consumed the fresh moment
  });

  test('getResidencyState: legacy reflection entries still anchor the cursor', async () => {
    await birthNeuma('neuma-legacy');
    await workspace.addJournalEntry('neuma-legacy', { type: 'reflection', content: 'an old reflection' });
    const me = (await heartbeat.getResidencyState()).neuma.find(n => n.neumaId === 'neuma-legacy');
    expect(me.lastReflectionAt).toBeTruthy();
  });

  test('getResidencyState: conduit reads dormant when unreachable — the neuma is still resident', async () => {
    await birthNeuma('neuma-here');
    const prior = llm.getConfig().endpoint;
    llm.setConfig({ endpoint: 'http://127.0.0.1:1' }); // a REAL unreachable door, not a mock
    try {
      const state = await heartbeat.getResidencyState();
      expect(state.conduit.reachable).toBe(false);
      expect(state.neuma.find(n => n.neumaId === 'neuma-here').resident).toBe(true);
    } finally {
      llm.setConfig({ endpoint: prior });
    }
  });

  test('stopHeartbeat is safe to call when not running', () => {
    expect(() => heartbeat.stopHeartbeat()).not.toThrow();
  });
});
