/**
 * THE DISPATCH DRAWER (unit, RULE 0: real disk, no mock) — the charge
 * lifecycle the Optio office owns: pure shape law, exclusive-create ids,
 * one-way status transitions, summaries without bodies, and delivery state
 * read from a real house inbox.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makePost, appendPost, readNewPosts, saveCursor } from '../../backend/services/house-post.js';
import {
  makeCharge, fileDispatch, readDispatch, updateDispatch, listDispatches,
  recordStatusCheck, deliveryOf,
} from '../../backend/services/staff/dispatch-store.js';

let root;
let previousRoot;

const charge = (over = {}) => makeCharge({
  from: 'optio-lane',
  to: 'scribe-lane',
  title: 'Draft the ledger report',
  body: 'Done looks like: the report filed in the house repo.',
  filedAt: '2026-09-15T04:00:00.000Z',
  by: `0x${'a'.repeat(40)}`,
  ...over,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-store-'));
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  await neumaWorkspace.create('optio-lane');
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('makeCharge — the pure shape law', () => {
  test('a lawful charge carries its lifecycle defaults', () => {
    const c = charge();
    expect(c.v).toBe(1);
    expect(c.status).toBe('dispatched');
    expect(c.ackAt).toBeNull();
    expect(c.doneAt).toBeNull();
    expect(c.dueAt).toBeNull();
    expect(c.id).toBe('2026-09-15T04-00-00-000Z');
  });

  test('it refuses an unlawful shape instead of normalizing silently', () => {
    expect(() => charge({ from: 'optio-lane', to: 'optio-lane' })).toThrow(/note/);
    expect(() => charge({ from: 'BAD LANE' })).toThrow(/lawful lane id/);
    expect(() => charge({ title: '   ' })).toThrow(/title/);
    expect(() => charge({ body: '' })).toThrow(/body/);
    expect(() => charge({ body: 'x'.repeat(2001) })).toThrow(/2000/);
    expect(() => charge({ dueAt: '2026-09-14T00:00:00.000Z' })).toThrow(/after filedAt/);
    expect(() => charge({ by: '' })).toThrow(/operator wallet/);
    expect(() => charge({ filedAt: 'not a time' })).toThrow(/filedAt/);
  });
});

describe('the drawer lifecycle', () => {
  test('file → read round-trips the record', async () => {
    const landed = await fileDispatch('optio-lane', charge());
    const read = await readDispatch('optio-lane', landed.id);
    expect(read.title).toBe('Draft the ledger report');
    expect(read.postId).toBeNull();
  });

  test('a same-instant collision gets an ordinal — nothing overwrites', async () => {
    const first = await fileDispatch('optio-lane', charge());
    const second = await fileDispatch('optio-lane', charge({ title: 'Second charge' }));
    expect(second.id).not.toBe(first.id);
    expect(second.id).toMatch(/-2$/);
    expect((await listDispatches('optio-lane')).length).toBe(2);
  });

  test('updateDispatch moves an open charge and stamps the closure', async () => {
    const { id } = await fileDispatch('optio-lane', charge());
    const done = await updateDispatch('optio-lane', id, { status: 'done', note: 'report filed' });
    expect(done.status).toBe('done');
    expect(done.doneAt).toBeTruthy();
    expect(done.note).toBe('report filed');
    await expect(updateDispatch('optio-lane', id, { status: 'dispatched' })).rejects.toThrow(/closed charge does not move/);
  });

  test('updateDispatch refuses an unknown status and a missing charge', async () => {
    const { id } = await fileDispatch('optio-lane', charge());
    await expect(updateDispatch('optio-lane', id, { status: 'vibes' })).rejects.toThrow(/not a charge status/);
    await expect(updateDispatch('optio-lane', 'nope', { note: 'x' })).rejects.toThrow(/no record/);
  });

  test('recordStatusCheck stamps the ask without touching status', async () => {
    const { id } = await fileDispatch('optio-lane', charge());
    const stamped = await recordStatusCheck('optio-lane', id, '2026-09-16T04:00:00.000Z');
    expect(stamped.status).toBe('dispatched');
    expect(stamped.lastCheckedAt).toBe('2026-09-16T04:00:00.000Z');
  });

  test('listDispatches summarizes newest-first and carries no bodies', async () => {
    await fileDispatch('optio-lane', charge());
    await fileDispatch('optio-lane', charge({ filedAt: '2026-09-15T05:00:00.000Z', title: 'Newer charge' }));
    const list = await listDispatches('optio-lane');
    expect(list.map((d) => d.title)).toEqual(['Newer charge', 'Draft the ledger report']);
    expect(list[0].body).toBeUndefined();
    expect(list[0].status).toBe('dispatched');
  });

  test('an empty drawer is the ordinary case, not an error', async () => {
    expect(await listDispatches('optio-lane')).toEqual([]);
  });
});

describe('deliveryOf — the read-only inbox fact', () => {
  test('no postId reads as unsent — we cannot prove a delivery we cannot name', async () => {
    const ground = path.join(root, 'ground');
    await fs.mkdir(ground, { recursive: true });
    expect(await deliveryOf(ground, { to: 'scribe-lane', postId: null })).toBe('unsent');
  });

  test('an appended post waits unread until the seat collects it', async () => {
    const ground = path.join(root, 'ground');
    await fs.mkdir(ground, { recursive: true });
    const post = makePost({ from: 'optio-lane', to: 'scribe-lane', body: 'the charge', re: 'The charge', now: '2026-09-15T04:00:00.000Z' });
    await appendPost(ground, post);
    expect(await deliveryOf(ground, { to: 'scribe-lane', postId: post.id })).toBe('waiting-unread');
    await saveCursor(ground, 'scribe-lane', 1);
    expect(await deliveryOf(ground, { to: 'scribe-lane', postId: post.id })).toBe('collected');
    expect((await readNewPosts(ground, 'scribe-lane')).messages.length).toBe(0);
  });
});
