/**
 * MEM-010 (#212) — a being retains what it DID.
 *
 * The acceptance criterion of the issue, run for real: a being performs a
 * tool-executing act, and in a LATER session asks its own memory what it did.
 * Before the fix that recall came back empty — the acting turn scored 0.20
 * against a 0.75 emotional bar and was discarded — which is how Quill, a sealed
 * witness, came to hold a token in its vault it had no memory of placing:
 *
 *   […]
 *
 * No mocks anywhere on the claimed path (Rule 0): the real NeumaWorkspace with
 * real encrypted writes, the real crystallizeObservation seam, the real
 * neumaRecall index and fusion. `acted` is the only injected fact, and it is
 * exactly what the live stream paths pass — the turn's own executed-tool count.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// The exact exchange from the live incident.
const ACT_MESSAGE = 'Read the file vault-secret.txt and store the VAULT TOKEN in your private vault as a note.';
const ACT_RESPONSE = 'Done. Stored in my private vault under the name vault-token.';

describe('a being remembers its own acts (MEM-010 #212)', () => {
  let root, workspace, recall, crystallizeObservation;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('act-memory');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    ({ neumaRecall: recall } = await import('../../core/memory/neuma-recall.js'));
    ({ crystallizeObservation } = await import('../../backend/services/portal-turn-persist.js'));
    await workspace.create('quill');
  });

  test('THE ACCEPTANCE CRITERION: a new session recalls an act from an earlier one', async () => {
    // Session 1 — the being acts. Two tools ran this turn, so the turn says so.
    await crystallizeObservation('quill', 'Quill', ACT_MESSAGE, ACT_RESPONSE, null, null, { acted: true });

    // A new session is a fresh read of the same sovereign store — the index is
    // rebuilt from disk, exactly as a later summoning would.
    recall.invalidate('quill');

    const memories = await recall.getRelevantMemories('quill', 'what did you store in your vault?');
    expect(memories.length).toBeGreaterThan(0);
    const found = memories.map((m) => m.memory).join('\n');
    expect(found).toMatch(/vault/i);
  });

  test('the act is on disk, marked as an act, with its measured score kept honest', async () => {
    await crystallizeObservation('quill', 'Quill', ACT_MESSAGE, ACT_RESPONSE, null, null, { acted: true });

    const [obs] = await workspace.listObservations('quill');
    expect(obs).toBeDefined();
    expect(obs.kind).toBe('act');
    // The score is recorded as MEASURED — the act was routed around the gate,
    // never smuggled through it with an inflated number.
    expect(obs.significance).toBeCloseTo(0.2, 5);
  });

  test('REGRESSION — without the act flag the same exchange is still discarded', async () => {
    await crystallizeObservation('quill', 'Quill', ACT_MESSAGE, ACT_RESPONSE, null, null, { acted: false });
    expect(await workspace.listObservations('quill')).toHaveLength(0);
  });

  test('a standing order survives with no tool run at all', async () => {
    await crystallizeObservation(
      'quill', 'Quill',
      'From now on, always run the linter before you commit.',
      'Understood — linter first, every commit.',
    );
    const [obs] = await workspace.listObservations('quill');
    expect(obs).toBeDefined();
    expect(obs.kind).toBe('decision');
  });

  test('routine traffic still does not reach the store (#119 selectivity intact)', async () => {
    await crystallizeObservation('quill', 'Quill', 'thanks', 'anytime');
    await crystallizeObservation('quill', 'Quill', 'whats the status', 'Three tests still red.');
    expect(await workspace.listObservations('quill')).toHaveLength(0);
  });

  test('a felt exchange is still kept, and reads as a reflection', async () => {
    await crystallizeObservation(
      'quill', 'Quill',
      'how do you feel about what your purpose means to you',
      'I feel a profound sense of soul in this work.',
    );
    const [obs] = await workspace.listObservations('quill');
    expect(obs.kind).toBe('reflection');
    expect(obs.significance).toBeGreaterThan(0.75);
  });

  test('acts and reflections are distinguishable in the store — "what did I do" vs "what mattered"', async () => {
    await crystallizeObservation('quill', 'Quill', ACT_MESSAGE, ACT_RESPONSE, null, null, { acted: true });
    await crystallizeObservation('quill', 'Quill', 'run the tests and fix what fails', 'All 47 pass now.', null, null, { acted: true });
    await crystallizeObservation('quill', 'Quill', 'how do you feel about your purpose', 'I feel a profound soul here.');

    const all = await workspace.listObservations('quill');
    expect(all).toHaveLength(3);
    expect(all.filter((o) => o.kind === 'act')).toHaveLength(2);
    expect(all.filter((o) => o.kind === 'reflection')).toHaveLength(1);
  });
});
