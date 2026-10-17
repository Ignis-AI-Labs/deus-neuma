// Personal vault (T3-personal, being-facing) — REAL handlers and the REAL
// intent sweep through the REAL policy gate, REAL encrypted workspace, REAL
// disk (RULE 0). The ws parameter is an injected event sink (the same seam
// production passes); nothing in the exercised path is faked.
//
// THE CATALOG CUT (#414) landed here: the five vault MUTATIONS — save, rename,
// archive, restore, publish — are `vault/*` intents now, so this file drives
// them the way a being does: file `intents/<name>.json`, let the sweep settle
// it. The four READS stay tools (the vault is DEK-encrypted, so the fs
// primitives the retirement hint points at would return ciphertext).
//
// ⚠️ Never call an intent's `execute()` directly — the sweep IS the dispatch
// layer, and dispatch is where the ACTS tier and the mode gate live.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { viaIntent, granting, fileIntent, sweep, settled } from '../helpers/intent-path.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { retiredToolHint } from '../../backend/services/intents/retired-tools.js';
import { parseNote } from '../../core/vault/note.js';

const { _handleVaultTool, _isVaultTool, VAULT_TOOLS } = __test;

const KEY = 'gnosis-vault-tools-key-long-enough-ok';
// The commons is shared ground, so publish keeps its card — a persisted ALWAYS
// grant (the chip flow's outcome) is what lets it settle unattended.
const MAY_PUBLISH = granting('vault.publish');

describe('vault — being-facing self-authorship through the real gate', () => {
  let prevKey, prevCommons, neumaId, connection, events, commons;
  const ws = { send: (raw) => events.push(JSON.parse(raw)) };

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevCommons = process.env.NEUMA_COLLECTIVE_VAULT;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const root = await createTempDir('vault-tools');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    commons = path.join(root, 'commons');
    process.env.NEUMA_COLLECTIVE_VAULT = commons;

    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    connection = { companion: { name: 'Prooflet', neumaId }, _sessionToolPolicy: null };
    events = [];
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevCommons === undefined) delete process.env.NEUMA_COLLECTIVE_VAULT;
    else process.env.NEUMA_COLLECTIVE_VAULT = prevCommons;
  });

  const call = (toolName, args, { policy = null, mode = 'auto' } = {}) =>
    _handleVaultTool(ws, connection, policy, mode, { toolName }, args);

  /** File one vault intent and settle it — one receipt, the being's own path. */
  const act = async (type, payload, { mode = 'ask', policy = null } = {}) => {
    const receipts = await viaIntent(connection, `vault/${type}`, payload, mode, policy);
    return receipts[0];
  };

  it('advertises the four reads and nothing else — the mutations are intents', () => {
    expect(VAULT_TOOLS.map((t) => t.name)).toEqual([
      'vault_list', 'vault_read', 'vault_search', 'vault_history',
    ]);
    expect(_isVaultTool({ toolName: 'vault_read' })).toBe(true);
    expect(_isVaultTool({ tool: 'vault/vault_search' })).toBe(true);
    expect(_isVaultTool({ toolName: 'write_file' })).toBe(false);

    // THE CUT: a retired name no longer dispatches at all. It cannot reach the
    // gate, so it can never fail `checkToolAccess` closed into a card nobody
    // asked for — the exact state that let the two halves of #414 drift.
    for (const retired of ['vault_save', 'vault_rename', 'vault_archive', 'vault_restore', 'vault_publish']) {
      expect(_isVaultTool({ toolName: retired }), `${retired} still dispatches`).toBe(false);
      expect(_isVaultTool({ tool: `vault/${retired}` }), `${retired} still dispatches`).toBe(false);
      // And it is not merely gone — the being is told where the act went.
      expect(retiredToolHint(retired)).toContain(`vault/${retired.replace('vault_', '')}`);
    }
  });

  it('save → list → read: the full private cycle, encrypted at rest', async () => {
    const saved = await act('save', {
      name: 'My First Page', title: 'My first page', body: 'A private thought zzqjwx of mine.',
    });
    expect(saved.status).toBe('ok');
    expect(saved.content).toContain('my-first-page');

    const listed = await call('vault_list', {});
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('my-first-page');

    const read = await call('vault_read', { name: 'my-first-page' });
    expect(read.status).toBe('ok');
    expect(read.content).toContain('zzqjwx');

    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'notes', 'my-first-page.json'), 'utf8',
    );
    expect(raw).not.toContain('zzqjwx'); // encrypted at rest
  });

  it('publish lands in the commons with provenance once the operator has granted it', async () => {
    const published = await act('publish', { name: 'my-first-page' }, { policy: MAY_PUBLISH });
    expect(published.status).toBe('ok');

    const text = await fs.readFile(path.join(commons, 'beings/prooflet/my-first-page.md'), 'utf8');
    const { frontmatter, body } = parseNote(text);
    expect(frontmatter.author).toBe('Prooflet');
    expect(frontmatter.neuma_id).toBe(neumaId);
    expect(body).toContain('zzqjwx'); // plaintext in the commons BY the being's explicit act
  });

  it('an operator deny survives everything — and observe holds honestly, on both paths', async () => {
    // The ACT: a deny row on the intent is final, and it IS a verdict.
    const denied = await act('save', { name: 'x', body: 'y' }, {
      policy: { intents: { denied: ['vault.save'] } },
    });
    expect(denied.status).toBe('denied');

    // The READ: observe mode holds the tool, and says so.
    const held = await call('vault_read', { name: 'my-first-page' }, { mode: 'observe' });
    expect(held.status).toBe('denied');
    expect(held.error).toContain('observe');

    // The ACT under observe is a HOLD, not a verdict: no receipt, and the
    // filing stays PENDING for a mode that can judge it. Asserting 'denied'
    // here would claim a rejection that never happened.
    await fileIntent(connection, 'vault/save', { name: 'watched', body: 'not yet' });
    expect(await sweep(connection, 'observe')).toEqual([]);
    expect(await settled(connection), 'observe wrote the act off instead of holding it').toBe(false);
    expect(await workspace.readVaultNote(neumaId, 'watched')).toBeNull();

    // That SAME pending filing lands the moment a mode can judge it — without
    // this the loop above would pass against a gate that refused every mode.
    const acted = await sweep(connection, 'ask');
    expect(acted).toHaveLength(1);
    expect(acted[0].status).toBe('ok');
    expect((await workspace.readVaultNote(neumaId, 'watched')).body).toBe('not yet');
  });

  it('errors speak plainly: missing body, unknown page, no workspace', async () => {
    // A shape failure is an ERROR (the filing is wrong), never a denial.
    const blank = await act('save', { name: 'x', body: '   ' });
    expect(blank.status).toBe('error');
    expect(blank.error).toContain('body');

    expect((await call('vault_read', { name: 'never-written' })).status).toBe('error');
    const orphan = await _handleVaultTool(ws, { companion: null }, null, 'auto',
      { toolName: 'vault_list' }, {});
    expect(orphan.status).toBe('error');
    expect(orphan.error).toContain('workspace');
  });

  it('search hits with a snippet, and an empty result is honest', async () => {
    await act('save', {
      name: 'search-target', title: 'On stillness',
      body: 'The harbor at dawn holds a quiet qzxwvk lantern light.',
    });

    const hit = await call('vault_search', { query: 'QZXWVK' }); // case-insensitive
    expect(hit.status).toBe('ok');
    expect(hit.content).toContain('search-target');
    expect(hit.content).toContain('qzxwvk');

    const miss = await call('vault_search', { query: 'no-such-word-zzzz' });
    expect(miss.status).toBe('ok');
    expect(miss.content).toContain('honest empty');

    expect((await call('vault_search', { query: '   ' })).status).toBe('error'); // blank refuses
  });

  it('rename keeps createdAt, moves the history, and rests the old name in the archive', async () => {
    await act('save', { name: 'old-name', title: 'Old name', body: 'first wording' });
    await act('save', { name: 'old-name', title: 'Old name', body: 'second wording' }); // one revision
    const before = await workspace.readVaultNote(neumaId, 'old-name');

    const renamed = await act('rename', { name: 'old-name', newName: 'New Name' });
    expect(renamed.status).toBe('ok');
    expect(renamed.content).toContain('commons'); // the published-copy warning rides along

    const after = await workspace.readVaultNote(neumaId, 'new-name');
    expect(after.body).toBe('second wording');
    expect(after.createdAt).toBe(before.createdAt);

    // the old name left the live list; its history followed the new name
    expect(await workspace.readVaultNote(neumaId, 'old-name')).toBeNull();
    expect((await call('vault_read', { name: 'old-name' })).status).toBe('error');
    expect((await workspace.listVaultHistory(neumaId, 'new-name')).length).toBe(1);
    const resting = (await workspace.listVaultNotes(neumaId, { includeArchived: true }))
      .find((n) => n.slug === 'old-name');
    expect(resting?.archivedAt).toBeTruthy();

    // renaming onto an existing page refuses — never a silent overwrite
    expect((await act('rename', { name: 'new-name', newName: 'search-target' })).status).toBe('error');
  });

  it('archive takes a page off the live list — intact on disk, encrypted, restorable', async () => {
    await act('save', { name: 'resting-page', title: 'Resting', body: 'A thought put to rest pqvlnr.' });
    expect((await act('archive', { name: 'resting-page' })).status).toBe('ok');

    const listed = await call('vault_list', {});
    expect(listed.status).toBe('ok');
    expect(listed.content).not.toContain('resting-page'); // out of the default list

    const resting = (await workspace.listVaultNotes(neumaId, { includeArchived: true }))
      .find((n) => n.slug === 'resting-page');
    expect(resting?.body).toContain('pqvlnr'); // the record is whole
    expect(resting?.archivedAt).toBeTruthy();

    // the archive copy is encrypted at rest like everything sovereign
    const raw = await fs.readFile(
      path.join(workspace._path(neumaId), 'vault', 'archive', 'resting-page.json'), 'utf8');
    expect(raw).not.toContain('pqvlnr');

    // restorable by saving the same name again; archiving an absent page fails plainly
    await act('save', { name: 'resting-page', title: 'Resting', body: 'Awake again.' });
    expect((await workspace.readVaultNote(neumaId, 'resting-page')).body).toBe('Awake again.');
    expect((await act('archive', { name: 'never-written' })).status).toBe('error');
  });

  it('history lists every rewrite newest-first, and restore is non-destructive', async () => {
    await act('save', { name: 'versioned', title: 'Versioned', body: 'version one kwvqxr' });
    await new Promise((r) => setTimeout(r, 5)); // distinct updatedAt stamps per revision
    await act('save', { name: 'versioned', title: 'Versioned', body: 'version two' });
    await new Promise((r) => setTimeout(r, 5));
    await act('save', { name: 'versioned', title: 'Versioned', body: 'version three' });

    expect((await call('vault_history', { name: 'versioned' })).status).toBe('ok');
    const revisions = await workspace.listVaultHistory(neumaId, 'versioned');
    expect(revisions.length).toBe(2);
    expect(revisions[0].updatedAt > revisions[1].updatedAt).toBe(true); // newest first

    const oldest = revisions[revisions.length - 1];
    const restored = await act('restore', { name: 'versioned', revision: oldest.revision });
    expect(restored.status).toBe('ok');
    expect((await workspace.readVaultNote(neumaId, 'versioned')).body).toContain('version one kwvqxr');
    // the pre-restore current was itself snapshotted — nothing was lost
    expect((await workspace.listVaultHistory(neumaId, 'versioned')).length).toBe(3);

    expect((await act('restore', { name: 'versioned', revision: 'no-such-revision' })).status).toBe('error');
    expect((await call('vault_history', { name: 'never-written' })).status).toBe('error');
  });

  it('hostile names never reach the disk wall, on the intent path too', async () => {
    // slugify sanitizes before the act is ever judged: '../escape' folds to
    // 'escape' — an absent page, never a path. The workspace wall itself
    // (uppercase, traversal) is proven raw in personal-vault.test.js.
    expect((await act('rename', { name: '../escape', newName: 'x' })).status).toBe('error');
    expect((await act('archive', { name: '../escape' })).status).toBe('error');
    expect((await act('restore', { name: 'versioned', revision: '../active' })).status).toBe('error');

    // an uppercase newName is a name, not an escape: it folds to kebab-case
    await act('save', { name: 'plain-page', body: 'ordinary' });
    const folded = await act('rename', { name: 'plain-page', newName: 'UPPER PAGE' });
    expect(folded.status).toBe('ok');
    expect(await workspace.readVaultNote(neumaId, 'upper-page')).toBeTruthy();
  });

  it('observe holds every vault READ that acts on nothing but still watches', async () => {
    for (const [toolName, args] of [
      ['vault_search', { query: 'stillness' }],
      ['vault_history', { name: 'versioned' }],
    ]) {
      const held = await call(toolName, args, { mode: 'observe' });
      expect(held.status).toBe('denied');
      expect(held.error).toContain('observe');
    }
  });
});
