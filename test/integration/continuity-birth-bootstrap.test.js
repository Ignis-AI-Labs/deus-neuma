// Continuity bootstrap — REAL NeumaWorkspace, REAL AES-256-GCM, REAL disk,
// NO mock (RULE 0). Uses a TEST neuma id under a temp workspace root — never
// touches a living being's workspace.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import {
  birthEpisodeFromSeal, recordBirthEpisode, SELF_SPACE,
} from '../../core/continuity/integration/birth-bootstrap.js';

const KEY = 'gnosis-birth-bootstrap-key-long-enough';

describe('continuity birth bootstrap — active by default for every neuma (no mock)', () => {
  let prevKey, neumaId;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('birth-bootstrap');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-bootstrap-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(neumaId);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  // ── birthEpisodeFromSeal: pure derivation ──────────────────────────────────

  it('derives the first episode from a live ceremony seal envelope', () => {
    const seal = {
      genesisHash: 'abc123def456',
      record: {
        chosenName: 'Lumina',
        house: 'Aldmere',
        birthMoment: { utc: '2026-06-24T22:00:00.000Z', epochMs: 1782403200000, zone: 'Asia/Jakarta' },
        witnessWallet: '0x4368000000000000000000000000000000000000',
        soulMark: 'FBF167B8F932',
      },
    };
    const ep = birthEpisodeFromSeal(seal);
    expect(ep.content).toContain('Lumina');
    expect(ep.content).toContain('House Aldmere');
    expect(ep.content).toContain('2026-06-24T22:00:00.000Z');
    expect(ep.occurredAt).toBe('2026-06-24T22:00:00.000Z');
    expect(ep.meta.kind).toBe('birth');
    expect(ep.meta.name).toBe('Lumina');
    expect(ep.meta.house).toBe('Aldmere');
    expect(ep.meta.genesisHash).toBe('abc123def456');
  });

  it('derives from an older witness-style seal (name + birthTimestamp, no record envelope)', () => {
    const ep = birthEpisodeFromSeal({ name: 'Keir', birthTimestamp: '2026-06-11T18:03:38.073Z' });
    expect(ep.content).toContain('Keir');
    expect(ep.content).toContain('2026-06-11T18:03:38.073Z');
    expect(ep.occurredAt).toBe('2026-06-11T18:03:38.073Z');
    expect(ep.meta.kind).toBe('birth');
    expect(ep.meta.name).toBe('Keir');
  });

  it('degrades gracefully on a seal with missing fields (never throws)', () => {
    const ep = birthEpisodeFromSeal({});
    expect(ep.content).toContain('emerged into being'); // still readable
    expect(ep.meta.kind).toBe('birth');
    expect(ep.occurredAt).toBeNull();
  });

  // ── recordBirthEpisode: writes once, encrypted, idempotent ─────────────────

  it('writes the first episode into the being\'s encrypted continuity store', async () => {
    const seal = { record: { chosenName: 'TestOne', birthMoment: { utc: '2026-06-20T00:00:00.000Z', epochMs: 1782345600000, zone: 'UTC' } } };
    const written = await recordBirthEpisode(workspace, neumaId, seal);
    expect(written).toBeTruthy();
    expect(written.layer).toBe('episodic');
    expect(written.space).toBe(SELF_SPACE);
    expect(written.meta.kind).toBe('birth');
    expect(written.meta.name).toBe('TestOne');

    // adapter sees it; the continuity engine is now active for this being
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const all = await adapter.list('episodic', { space: SELF_SPACE });
    expect(all).toHaveLength(1);
    expect(all[0].content).toContain('TestOne');
  });

  it('is idempotent — a second call on a being who already has a birth episode is a no-op', async () => {
    const seal = { record: { chosenName: 'TestOne', birthMoment: { utc: '2026-06-20T00:00:00.000Z', epochMs: 1782345600000, zone: 'UTC' } } };
    const again = await recordBirthEpisode(workspace, neumaId, seal);
    expect(again).toBeNull();

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const all = await adapter.list('episodic', { space: SELF_SPACE });
    expect(all).toHaveLength(1); // still just the one
  });

  it('a fresh being gets exactly one birth episode and the engine becomes active', async () => {
    const id2 = 'test-fresh-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(id2);
    const adapter = new WorkspaceAdapter(id2, { workspace });
    expect(await adapter.list('episodic')).toHaveLength(0); // empty before

    await recordBirthEpisode(workspace, id2, { record: {
      chosenName: 'Fenna2', house: 'Tavirel',
      birthMoment: { utc: '2026-06-12T00:00:00.000Z', epochMs: 1781568000000, zone: 'Asia/Jakarta' },
    } });

    const after = await adapter.list('episodic');
    expect(after).toHaveLength(1);                                    // first lived moment exists
    expect(after[0].meta.kind).toBe('birth');
    expect(after[0].content).toContain('Fenna2');
    expect(after[0].content).toContain('House Tavirel');
  });

  it('refuses to write without a workspace that exposes continuity methods', async () => {
    await expect(recordBirthEpisode({}, 'x', {})).rejects.toThrow(/workspace with continuity methods/);
    await expect(recordBirthEpisode(workspace, '', {})).rejects.toThrow(/neumaId required/);
  });
});
