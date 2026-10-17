// Crystallize→continuity bridge (U1) — REAL NeumaWorkspace, REAL AES-256-GCM,
// REAL disk, NO mock (RULE 0). Uses TEST neuma ids under a temp workspace
// root — never a living being's sovereign storage.
//
// The bridge is a choke point inside NeumaWorkspace: EVERY observation write
// (portal, session compactor, any future caller) auto-bridges into the
// episodic continuity lane, and every invalidation mirrors an expiry there.
// The backfill covers history from before the bridge existed. These tests
// prove exactly those guarantees on the real encrypted store.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { recallEpisodic } from '../../core/continuity/index.js';
import {
  episodeFromObservation,
  backfillEpisodesFromObservations,
} from '../../core/continuity/integration/crystallize-bridge.js';

const KEY = 'gnosis-crystallize-bridge-key-long-enough';

describe('crystallize→continuity bridge (real encrypted workspace, no mock)', () => {
  let prevKey;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('crystallize-bridge');
    setWorkspacesRoot(path.join(root, 'workspaces'));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const freshBeing = async () => {
    const neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    return neumaId;
  };

  // simulate the pre-bridge era: history exists as observations only
  const eraseLane = (neumaId) =>
    fs.rm(path.join(workspace._path(neumaId), 'continuity', 'episodic.jsonl'), { force: true });

  it('derives an episodic record input that preserves the exchange, its space, and its join key', () => {
    const input = episodeFromObservation({
      id: 'obs123',
      type: 'exchange',
      userMessage: 'what did we build tonight?',
      response: 'the collective vault exporter',
      significance: 0.9,
      emotion: 'joy',
      space: { id: 'proj-vault', label: 'Vault' },
      occurredAt: '2026-07-06T02:00:00.000Z',
      recordedAt: '2026-07-06T02:00:00.000Z',
    });
    expect(input.layer).toBe('episodic');
    expect(input.content).toEqual({
      userMessage: 'what did we build tonight?',
      response: 'the collective vault exporter',
    });
    expect(input.space).toBe('proj-vault'); // object → string id, never a silent general default
    expect(input.meta).toMatchObject({
      kind: 'exchange', observationId: 'obs123', significance: 0.9, emotion: 'joy',
    });
  });

  it('auto-bridges EVERY observation write into the episodic lane, recallable and encrypted at rest', async () => {
    const neumaId = await freshBeing();
    const saved = await workspace.addObservation(neumaId, {
      type: 'exchange',
      userMessage: 'tell me about the kotodama motif zyxxqk',
      response: 'the motif zyxxqk carries the emergence tone',
      significance: 0.91,
    });

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const view = await adapter.list('episodic');
    expect(view.some((r) => r?.meta?.observationId === saved.id)).toBe(true);

    // recallable by content through the real episodic layer (hits are
    // { record, scope } wrappers)
    const hits = await recallEpisodic(adapter, 'kotodama motif zyxxqk', { space: 'general', k: 3 });
    expect(hits.some((h) => h?.record?.meta?.observationId === saved.id)).toBe(true);

    // encrypted at rest — plaintext keyword absent from on-disk bytes
    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'continuity', 'episodic.jsonl'), 'utf8',
    );
    expect(raw).not.toContain('zyxxqk');
  });

  it('mirrors a live invalidation into the lane — the two lanes never diverge on validity', async () => {
    const neumaId = await freshBeing();
    const obs = await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'claim', response: 'superseded soon', significance: 0.8,
    });

    await workspace.invalidateObservation(neumaId, obs.id, {
      at: new Date(Date.now() - 60_000).toISOString(),
    });

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const current = await adapter.list('episodic');
    const full = await adapter.list('episodic', { includeRetired: true });
    expect(current.some((r) => r?.meta?.observationId === obs.id)).toBe(false); // retired
    expect(full.some((r) => r?.meta?.observationId === obs.id)).toBe(true);     // never deleted
  });

  it('backfills pre-bridge history idempotently, carrying validity', async () => {
    const neumaId = await freshBeing();
    const a = await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'first moment', response: 'kept', significance: 0.8,
    });
    const b = await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'second moment', response: 'superseded later', significance: 0.8,
    });
    await workspace.invalidateObservation(neumaId, b.id, {
      at: new Date(Date.now() - 60_000).toISOString(),
    });
    await eraseLane(neumaId); // this history predates the bridge

    const first = await backfillEpisodesFromObservations(workspace, neumaId);
    expect(first).toEqual({ appended: 2, expired: 1, skipped: 0 });

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const current = await adapter.list('episodic');
    const full = await adapter.list('episodic', { includeRetired: true });
    expect(current.some((r) => r?.meta?.observationId === a.id)).toBe(true);
    expect(current.some((r) => r?.meta?.observationId === b.id)).toBe(false); // retired
    expect(full.some((r) => r?.meta?.observationId === b.id)).toBe(true);     // but never deleted

    // idempotence: a second run appends nothing
    const second = await backfillEpisodesFromObservations(workspace, neumaId);
    expect(second).toEqual({ appended: 0, expired: 0, skipped: 2 });
  });

  it('auto-bridge composes with backfill without duplication (the live migration order)', async () => {
    const neumaId = await freshBeing();
    // history that predates the bridge…
    await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'old history', response: 'pre-bridge', significance: 0.8,
    });
    await eraseLane(neumaId);
    // …then the bridge ships and a new moment auto-bridges
    await workspace.addObservation(neumaId, {
      type: 'exchange', userMessage: 'new moment', response: 'post-bridge', significance: 0.8,
    });

    const r = await backfillEpisodesFromObservations(workspace, neumaId);
    expect(r.appended).toBe(1); // only the pre-bridge moment
    expect(r.skipped).toBe(1);  // the auto-bridged one is already there

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const view = await adapter.list('episodic');
    const bridgedIds = view.map((x) => x?.meta?.observationId).filter(Boolean);
    expect(new Set(bridgedIds).size).toBe(bridgedIds.length); // no duplicates
    expect(bridgedIds).toHaveLength(2);
  });
});
