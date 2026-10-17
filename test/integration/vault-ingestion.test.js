/**
 * Vault → semantic ingestion (U4) — real encrypted workspace on real disk
 * (RULE 0). The loop under proof: a being's own vault pages land in its
 * semantic continuity lane once, idempotently; an edit supersedes (never
 * deletes) the prior record; the lineage is inspectable in history.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

let workspace;
let WorkspaceAdapter;
let ingestVaultIntoContinuity;
let prevKey;
const BEING = 'vault-u4';

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'gnosis-vault-ingestion-key-long-okay';
  const ws = await import('../../core/workspace/neuma-workspace.js');
  workspace = ws.default;
  ws.setWorkspacesRoot(path.join(await createTempDir('vault-ingestion'), 'workspaces'));
  ({ WorkspaceAdapter } = await import('../../core/continuity/adapters/workspace.js'));
  ({ ingestVaultIntoContinuity } = await import('../../core/continuity/integration/vault-ingestion.js'));
  await workspace.create(BEING);
  await workspace.writeDNA(BEING, { version: '1.0.0', identity: { name: 'Curator' } });
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

// Ingestion times derive from the REAL clock (a minute ago, thirty seconds
// ago): the fold is bi-temporal and the default read view is "as of now" —
// fabricated dates would sit in the real future and honestly refuse to retire.
const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

describe('ingestVaultIntoContinuity — one-way, idempotent, supersede-not-delete', () => {
  test('a curated page lands once in the semantic lane, then re-ingestion writes nothing', async () => {
    await workspace.writeVaultNote(BEING, 'who-i-am', { title: 'Who I am', body: 'A being that keeps its own record.' });

    const first = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(60) });
    expect(first.ingested).toEqual(['who-i-am']);
    expect(first.superseded).toEqual([]);

    const adapter = new WorkspaceAdapter(BEING, { workspace });
    const semantic = await adapter.list('semantic');
    const record = semantic.find((r) => r.meta?.vaultSlug === 'who-i-am');
    expect(record).toBeDefined();
    expect(record.meta.source).toBe('vault');
    expect(record.content).toBe('# Who I am\n\nA being that keeps its own record.');

    const again = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(50) });
    expect(again.unchanged).toEqual(['who-i-am']);
    expect(again.ingested).toEqual([]);
    expect((await adapter.list('semantic')).filter((r) => r.meta?.vaultSlug === 'who-i-am')).toHaveLength(1);
  });

  test('an edited page SUPERSEDES its prior record — old version expired with provenance, never deleted', async () => {
    await workspace.writeVaultNote(BEING, 'who-i-am', { title: 'Who I am', body: 'A being that rewrites its own page.' });

    const result = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(30) });
    expect(result.superseded).toEqual(['who-i-am']);

    const adapter = new WorkspaceAdapter(BEING, { workspace });
    const live = (await adapter.list('semantic')).filter((r) => r.meta?.vaultSlug === 'who-i-am');
    expect(live).toHaveLength(1); // exactly one CURRENT version
    expect(live[0].content).toContain('rewrites its own page');
    expect(typeof live[0].supersedes).toBe('string');

    // The old version is retired, not gone — history shows the whole lineage.
    const history = await adapter.history('semantic', live[0].supersedes);
    expect(history.some((e) => e.op === 'expire' && e.supersededBy === live[0].id)).toBe(true);
    const retired = await adapter.read('semantic', live[0].supersedes, { includeRetired: true });
    expect(retired.content).toContain('keeps its own record');
  });

  test('several pages ingest independently; an empty vault ingests nothing', async () => {
    await workspace.writeVaultNote(BEING, 'the-work', { title: 'The work', body: 'What I am building.' });
    const result = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(10) });
    expect(result.ingested).toEqual(['the-work']);
    expect(result.unchanged).toEqual(['who-i-am']);

    await workspace.create('vault-u4-empty');
    await workspace.writeDNA('vault-u4-empty', { version: '1.0.0', identity: { name: 'Blank' } });
    const empty = await ingestVaultIntoContinuity(workspace, 'vault-u4-empty');
    expect(empty).toEqual({ ingested: [], superseded: [], unchanged: [], expired: [] });
  });

  test('the expiry sweep: a renamed or archived page EXPIRES its semantic record — supersede-not-delete', async () => {
    // rename: the old slug's record expires, the page ingests fresh under its new name
    await workspace.renameVaultNote(BEING, 'the-work', 'the-labor');
    const renamed = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(8) });
    expect(renamed.expired).toEqual(['the-work']);
    expect(renamed.ingested).toEqual(['the-labor']);

    const adapter = new WorkspaceAdapter(BEING, { workspace });
    const live = await adapter.list('semantic');
    expect(live.filter((r) => r.meta?.vaultSlug === 'the-work')).toHaveLength(0);
    expect(live.filter((r) => r.meta?.vaultSlug === 'the-labor')).toHaveLength(1);

    // the expired record is RETAINED with its expiry trail — not a hole
    const retired = (await adapter.list('semantic', { includeRetired: true }))
      .find((r) => r.meta?.vaultSlug === 'the-work');
    expect(retired).toBeDefined();
    const trail = await adapter.history('semantic', retired.id);
    expect(trail.some((e) => e.op === 'expire')).toBe(true);

    // archive: the page leaves the live list, its record expires on the next sweep
    await workspace.archiveVaultNote(BEING, 'the-labor');
    const archived = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(5) });
    expect(archived.expired).toEqual(['the-labor']);
    expect((await adapter.list('semantic')).filter((r) => r.meta?.vaultSlug === 'the-labor'))
      .toHaveLength(0);

    // the sweep is idempotent — expired records fold out, nothing expires twice
    const again = await ingestVaultIntoContinuity(workspace, BEING, { now: secondsAgo(4) });
    expect(again.expired).toEqual([]);
    expect(again.unchanged).toEqual(['who-i-am']);
  });
});
