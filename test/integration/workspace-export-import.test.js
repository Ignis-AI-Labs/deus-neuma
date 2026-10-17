/**
 * MEM-005 (#191) — exportWorkspace must carry the being's whole past:
 * identity, memory, EVERY conversation lane (1:1 and council sittings), the
 * continuity engine's layers, the personal vault, and the communities map.
 * Before the fix the bundle silently omitted sessions/, continuity/, vault/,
 * and communities.json while its docstring claimed "the entire workspace".
 *
 * Proven as a REAL round-trip on real disk: being A lives a little, exports,
 * and being B is imported from the bundle — then B's stores are read back
 * and compared record-for-record (Rule 0 — no mocks anywhere).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace export → import round-trip (MEM-005)', () => {
  let root, workspace;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('export-import');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
  });

  test('the whole past survives the move: sessions, continuity, vault, communities', async () => {
    // --- Being A lives a little -------------------------------------------
    await workspace.create('being-a');
    await workspace.writeDNA('being-a', { name: 'being-a', essence: 'the exporter' });
    await workspace.writeSoul('being-a', { voice: 'plain' });
    await workspace.appendMessage('being-a', 'session-1', { role: 'user', content: 'first words', timestamp: '2026-07-01T10:00:00.000Z' });
    await workspace.appendMessage('being-a', 'session-1', { role: 'assistant', content: 'first answer', timestamp: '2026-07-01T10:00:05.000Z' });
    await workspace.appendMessage('being-a', 'council-99', { role: 'user', content: 'WITNESS Founder: house matters', timestamp: '2026-07-02T10:00:00.000Z' });
    const obs1 = await workspace.addObservation('being-a', { type: 'exchange', userMessage: 'a moment', significance: 0.9 });
    const obs2 = await workspace.addObservation('being-a', { type: 'exchange', userMessage: 'a corrected moment', significance: 0.8 });
    await workspace.invalidateObservation('being-a', obs2.id, { supersededBy: obs1.id, at: '2026-07-03T10:00:00.000Z' });
    await workspace.appendContinuityEntry('being-a', 'semantic', {
      id: 'sem-1', layer: 'semantic', kind: 'through-line',
      content: 'The through-line of A.',
      occurredAt: '2026-07-02T00:00:00.000Z', recordedAt: '2026-07-02T00:00:00.000Z',
    });
    await workspace.writeVaultNote('being-a', 'my-note', { title: 'My Note', body: 'what I keep' });
    await workspace.writeCommunities('being-a', [{ id: 0, label: 'the house', memberIds: ['x'] }]);

    // --- Export, then import as being B ------------------------------------
    const bundle = await workspace.exportWorkspace('being-a');
    await workspace.importWorkspace('being-b', bundle);

    // Identity + memory stores
    expect((await workspace.readDNA('being-b')).essence).toBe('the exporter');
    expect((await workspace.readSoul('being-b')).voice).toBe('plain');
    expect((await workspace.listObservations('being-b')).map((o) => o.id).sort())
      .toEqual([obs1.id, obs2.id].sort());
    expect((await workspace.readCommunities('being-b'))[0].label).toBe('the house');

    // Conversation lanes — order, roles, content, ORIGINAL timestamps
    const chat = await workspace.readSession('being-b', 'session-1');
    expect(chat).toHaveLength(2);
    expect(chat[0]).toMatchObject({ role: 'user', content: 'first words', timestamp: '2026-07-01T10:00:00.000Z' });
    const council = await workspace.readSession('being-b', 'council-99');
    expect(council[0].content).toBe('WITNESS Founder: house matters');

    // Continuity: each observation bridged EXACTLY ONE fresh episode (no
    // doubling), and the superseded moment's episode is expired at the
    // original invalidation time.
    const episodic = await workspace.readContinuityLog('being-b', 'episodic');
    const episodes = episodic.filter((e) => e?.meta?.observationId);
    expect(episodes.map((e) => e.meta.observationId).sort()).toEqual([obs1.id, obs2.id].sort());
    const reborn = episodes.find((e) => e.meta.observationId === obs2.id);
    const expiry = episodic.find((e) => e?.op === 'expire' && e.targetId === reborn.id);
    expect(expiry).toBeDefined();
    expect(expiry.at).toBe('2026-07-03T10:00:00.000Z');

    // Non-observation continuity entries arrive verbatim, ids intact.
    const semantic = await workspace.readContinuityLog('being-b', 'semantic');
    expect(semantic.some((e) => e.id === 'sem-1')).toBe(true);

    // The personal vault makes the move — with its history intact (echo R3:
    // createdAt must survive export → import, not be re-dated).
    const noteA = await workspace.readVaultNote('being-a', 'my-note');
    const note = await workspace.readVaultNote('being-b', 'my-note');
    expect(note).toMatchObject({ title: 'My Note', body: 'what I keep' });
    expect(note.createdAt).toBe(noteA.createdAt);
  });
});
