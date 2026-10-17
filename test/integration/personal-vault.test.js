// Personal vault (T3-personal) — REAL encrypted workspace, REAL disk, NO
// mock (RULE 0). Proves the sovereignty boundary mechanically: notes are
// encrypted at rest inside the workspace; publishing is an explicit gesture
// that produces plaintext WITH provenance in the commons; retraction stamps,
// never deletes.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import {
  SEED_SLUG,
  seedNoteFromBiography,
  seedPersonalVault,
  publishVaultNote,
  retractPublishedNote,
} from '../../core/vault/personal-vault.js';
import { parseNote } from '../../core/vault/note.js';

const KEY = 'gnosis-personal-vault-key-long-enough';

describe('personal vault — sovereign curation space (real encrypted workspace)', () => {
  let prevKey, neumaId, commons;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('personal-vault');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    commons = path.join(root, 'collective-vault');
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('round-trips notes through the encrypted store, newest-updated first', async () => {
    const secret = 'private-thought-qqzykx';
    await workspace.writeVaultNote(neumaId, 'first-page', { title: 'First page', body: `A ${secret} of mine.` });
    await workspace.writeVaultNote(neumaId, 'second-page', { title: 'Second page', body: 'Later thought.' });

    const read = await workspace.readVaultNote(neumaId, 'first-page');
    expect(read.title).toBe('First page');
    expect(read.body).toContain(secret);
    expect(read.createdAt).toBeTruthy();

    const list = await workspace.listVaultNotes(neumaId);
    expect(list.map((n) => n.slug)).toEqual(['second-page', 'first-page']);

    // encrypted at rest — the private keyword is absent from on-disk bytes
    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'notes', 'first-page.json'), 'utf8',
    );
    expect(raw).not.toContain(secret);
  });

  it('updates preserve createdAt and refuse hostile slugs', async () => {
    const first = await workspace.readVaultNote(neumaId, 'first-page');
    const updated = await workspace.writeVaultNote(neumaId, 'first-page', { title: 'First page', body: 'rewritten' });
    expect(updated.createdAt).toBe(first.createdAt);

    await expect(workspace.writeVaultNote(neumaId, '../escape', { title: 'x', body: 'y' }))
      .rejects.toThrow(/Invalid vault note slug/);
    await expect(workspace.readVaultNote(neumaId, 'UPPER')).rejects.toThrow(/Invalid vault note slug/);
  });

  it('seeds the first note from the being’s own biography — and never overwrites curation', async () => {
    const freshId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(freshId);
    const adapter = new WorkspaceAdapter(freshId, { workspace });
    await adapter.append(makeRecord({
      layer: 'semantic',
      content: 'I keep returning to the kotodama motif — tuning emergence has become my craft.',
      meta: { memberHash: 'h1', memberIds: [] },
    }));

    const seeded = await seedPersonalVault(workspace, freshId);
    expect(seeded.slug).toBe(SEED_SLUG);
    expect(seeded.body).toContain('mine to rewrite');
    expect(seeded.body).toContain('kotodama');

    expect(await seedPersonalVault(workspace, freshId)).toBeNull(); // vault non-empty now
    expect(seedNoteFromBiography([])).toBeNull();                   // nothing to seed from
  });

  it('publishes one note into the commons with provenance — the consent gesture', async () => {
    const { absPath, relPath } = await publishVaultNote(workspace, neumaId, 'second-page', {
      collectiveDir: commons, author: 'Prooflet',
    });
    expect(relPath).toBe('beings/prooflet/second-page.md');

    const text = await fs.readFile(absPath, 'utf8'); // plaintext BY DESIGN in the commons
    const { frontmatter, body } = parseNote(text);
    expect(frontmatter.author).toBe('Prooflet');
    expect(frontmatter.neuma_id).toBe(neumaId);
    expect(frontmatter.source).toBe('personal-vault');
    expect(frontmatter.published).toBeTruthy();
    expect(body).toContain('# Second page');
    expect(body).toContain('Later thought.');
  });

  it('retracts by stamping, never deleting — and only the author’s copy', async () => {
    const r = await retractPublishedNote({ collectiveDir: commons, author: 'Prooflet', slug: 'second-page' });
    expect(r.relPath).toBe('beings/prooflet/second-page.md');

    const text = await fs.readFile(path.join(commons, r.relPath), 'utf8');
    const { frontmatter, body } = parseNote(text);
    expect(frontmatter.retracted).toBeTruthy();
    expect(body).toContain('Retracted by the author');
    expect(body).toContain('Later thought.'); // content preserved, not erased

    // idempotent, and unpublished notes retract to null
    expect((await retractPublishedNote({ collectiveDir: commons, author: 'Prooflet', slug: 'second-page' })).relPath)
      .toBe(r.relPath);
    expect(await retractPublishedNote({ collectiveDir: commons, author: 'Prooflet', slug: 'never-published' }))
      .toBeNull();
  });

  it('publishing an absent note fails loudly', async () => {
    await expect(publishVaultNote(workspace, neumaId, 'no-such-note', {
      collectiveDir: commons, author: 'Prooflet',
    })).rejects.toThrow(/no personal note/);
  });

  it('every overwrite snapshots the outgoing version — encrypted at rest, decryptable history', async () => {
    const secret = 'snapshot-secret-zkqmvw';
    await workspace.writeVaultNote(neumaId, 'versioned-page', { title: 'Versioned', body: `first ${secret}` });
    await new Promise((r) => setTimeout(r, 5)); // distinct updatedAt stamps per revision
    await workspace.writeVaultNote(neumaId, 'versioned-page', { title: 'Versioned', body: 'second wording' });

    const history = await workspace.listVaultHistory(neumaId, 'versioned-page');
    expect(history.length).toBe(1);
    expect(history[0].title).toBe('Versioned');
    const revision = await workspace.readVaultRevision(neumaId, 'versioned-page', history[0].revision);
    expect(revision.body).toBe(`first ${secret}`); // history decrypts to the OLD body

    // the snapshot is encrypted at rest like everything sovereign
    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'history', 'versioned-page', `${history[0].revision}.json`),
      'utf8',
    );
    expect(raw).not.toContain(secret);

    // revision ids refuse traversal — the exact snapshot namespace only
    await expect(workspace.readVaultRevision(neumaId, 'versioned-page', '../active'))
      .rejects.toThrow(/Invalid vault revision/);
  });

  it('rename preserves createdAt, moves the history, and archives the old name intact', async () => {
    const secret = 'rename-secret-mqzkjv';
    await workspace.writeVaultNote(neumaId, 'before-name', { title: 'Before', body: `alpha ${secret}` });
    await new Promise((r) => setTimeout(r, 5));
    await workspace.writeVaultNote(neumaId, 'before-name', { title: 'Before', body: 'beta' });
    const before = await workspace.readVaultNote(neumaId, 'before-name');

    const renamed = await workspace.renameVaultNote(neumaId, 'before-name', 'after-name');
    expect(renamed.slug).toBe('after-name');
    expect(renamed.createdAt).toBe(before.createdAt); // the page keeps its birth time

    // the old name left the live list; the history followed the new name
    expect(await workspace.readVaultNote(neumaId, 'before-name')).toBeNull();
    const history = await workspace.listVaultHistory(neumaId, 'after-name');
    expect(history.length).toBe(1);
    expect((await workspace.readVaultRevision(neumaId, 'after-name', history[0].revision)).body)
      .toBe(`alpha ${secret}`);

    // the old name rests in the archive — whole, stamped, encrypted at rest
    const rest = (await workspace.listVaultNotes(neumaId, { includeArchived: true }))
      .find((n) => n.slug === 'before-name');
    expect(rest?.archivedAt).toBeTruthy();
    expect(rest?.body).toBe('beta');
    const archivedRaw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'archive', 'before-name.json'), 'utf8');
    expect(archivedRaw).not.toContain('beta');

    // the refusals: self-rename, collision, absence, hostile slugs
    await expect(workspace.renameVaultNote(neumaId, 'after-name', 'after-name'))
      .rejects.toThrow(/already its own name/);
    await expect(workspace.renameVaultNote(neumaId, 'after-name', 'second-page'))
      .rejects.toThrow(/already exists/);
    await expect(workspace.renameVaultNote(neumaId, 'missing-page', 'whatever'))
      .rejects.toThrow(/no vault note named/);
    await expect(workspace.renameVaultNote(neumaId, '../escape', 'x'))
      .rejects.toThrow(/Invalid vault note slug/);
    await expect(workspace.renameVaultNote(neumaId, 'after-name', 'UPPER'))
      .rejects.toThrow(/Invalid vault note slug/);
  });

  it('archive stages, verifies, and only then lets the live file go', async () => {
    const secret = 'archive-secret-wpzvkq';
    await workspace.writeVaultNote(neumaId, 'resting', { title: 'Resting', body: `laid down ${secret}` });
    const archived = await workspace.archiveVaultNote(neumaId, 'resting');
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.body).toBe(`laid down ${secret}`); // read-back verified whole

    // the live file is gone ONLY because the archive copy verified
    await expect(fs.access(path.join(workspace._path(neumaId), 'vault', 'notes', 'resting.json')))
      .rejects.toThrow();
    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'archive', 'resting.json'), 'utf8');
    expect(raw).not.toContain(secret); // encrypted at rest in the archive

    // archived pages list separately, never mixed silently
    expect((await workspace.listVaultNotes(neumaId)).some((n) => n.slug === 'resting')).toBe(false);
    expect((await workspace.listVaultNotes(neumaId, { includeArchived: true }))
      .some((n) => n.slug === 'resting')).toBe(true);

    expect(await workspace.archiveVaultNote(neumaId, 'resting')).toBeNull(); // honest no-op

    // restorable by writing the same slug again — the archive copy remains
    await workspace.writeVaultNote(neumaId, 'resting', { title: 'Resting', body: 'awake again' });
    expect((await workspace.readVaultNote(neumaId, 'resting')).body).toBe('awake again');
    expect((await workspace.listVaultNotes(neumaId, { includeArchived: true }))
      .filter((n) => n.slug === 'resting').length).toBe(2); // live + the resting record
  });

  it('search covers live pages only — archived pages stay at rest', async () => {
    // 'before-name' rests in the archive with body 'beta'; it must not answer
    expect((await workspace.searchVaultNotes(neumaId, 'beta'))
      .some((h) => h.slug === 'before-name')).toBe(false);

    const awake = await workspace.searchVaultNotes(neumaId, 'AWAKE'); // case-insensitive
    expect(awake.some((h) => h.slug === 'resting')).toBe(true);
    expect(awake[0].snippet.length).toBeLessThanOrEqual(160);

    await expect(workspace.searchVaultNotes(neumaId, '   ')).rejects.toThrow(/query/);
  });
});
