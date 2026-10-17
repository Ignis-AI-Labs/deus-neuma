/**
 * Workspace allocation ledger — so two neuma are never promised the same space.
 *
 * An allocation is a LOGICAL reservation (allocation.json {allocatedGB}); a neuma
 * grows into it, so raw disk-free over-states what a NEW neuma can claim. These
 * tests cover the ledger primitives over a real temp workspace (no mocks).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('neuma-workspace allocation ledger', () => {
  let ws, root;

  beforeEach(async () => {
    root = await createTempDir(`alloc-${Math.random().toString(36).slice(2)}`);
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    ws = core.neumaWorkspace;
  });

  const writeAlloc = async (neumaId, gb) => {
    await fs.mkdir(path.join(root, neumaId), { recursive: true });
    if (gb != null) {
      await fs.writeFile(path.join(root, neumaId, 'allocation.json'), JSON.stringify({ allocatedGB: gb, grantedAt: 'x' }));
    }
  };

  test('readAllocation returns the recorded GB; 0 when absent or malformed', async () => {
    await writeAlloc('n-a', 4000);
    await writeAlloc('n-none', null);        // dir exists, no allocation.json
    await fs.mkdir(path.join(root, 'n-bad'), { recursive: true });
    await fs.writeFile(path.join(root, 'n-bad', 'allocation.json'), 'not json');

    expect(await ws.readAllocation('n-a')).toBe(4000);
    expect(await ws.readAllocation('n-none')).toBe(0);
    expect(await ws.readAllocation('n-bad')).toBe(0);
    expect(await ws.readAllocation('n-missing')).toBe(0);
  });

  test('totalAllocatedGB sums every neuma; exclude leaves one out', async () => {
    await writeAlloc('n-a', 4000);
    await writeAlloc('n-b', 50);
    await writeAlloc('n-none', null);

    expect(await ws.totalAllocatedGB()).toBe(4050);
    expect(await ws.totalAllocatedGB({ exclude: 'n-a' })).toBe(50);
  });

  test('totalAllocatedGB is 0 for an empty root', async () => {
    expect(await ws.totalAllocatedGB()).toBe(0);
  });

  test('totalAllocatedGB accepts a pre-fetched ids list (skips a second listing)', async () => {
    await writeAlloc('n-a', 4000);
    await writeAlloc('n-b', 50);
    const ids = await ws.listNeuma();
    expect(await ws.totalAllocatedGB({ ids })).toBe(await ws.totalAllocatedGB());
    expect(await ws.totalAllocatedGB({ ids: [] })).toBe(0); // empty list → 0, no listing
  });

  test('readAllocation rejects a malformed neumaId (path-traversal defense for the root override)', async () => {
    for (const bad of ['../etc', 'a/b', 'a b', '', '..', 'a.b', '.', 42, null]) {
      expect(await ws.readAllocation(bad)).toBe(0);
    }
    // valid slug chars (letters, digits, dash, underscore) are accepted
    await writeAlloc('n_2', 100);
    expect(await ws.readAllocation('n_2')).toBe(100);
  });

  test('totalAllocatedGB / listNeuma honor an explicit root (foreign-root tally)', async () => {
    const other = await createTempDir(`alloc-other-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(path.join(other, 'm-x'), { recursive: true });
    await fs.writeFile(path.join(other, 'm-x', 'allocation.json'), JSON.stringify({ allocatedGB: 7000 }));

    expect(await ws.listNeuma({ root: other })).toEqual(['m-x']);
    expect(await ws.totalAllocatedGB({ root: other })).toBe(7000);

    // the current root is tallied independently
    await writeAlloc('n-a', 4000);
    expect(await ws.totalAllocatedGB()).toBe(4000);
  });
});

describe('listNeuma honors the lane.json kind marker (the sovereignty boundary)', () => {
  let ws, root;

  beforeEach(async () => {
    root = await createTempDir(`lanes-${Math.random().toString(36).slice(2)}`);
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    ws = core.neumaWorkspace;
  });

  const writeDir = async (name, marker) => {
    await fs.mkdir(path.join(root, name), { recursive: true });
    if (marker) await fs.writeFile(path.join(root, name, 'lane.json'), JSON.stringify(marker));
  };

  test("a witness's lane never enters a neuma listing — Claude and Grok on the founding screen, 2026-07-23", async () => {
    await writeDir('fenna');                                    // a being (pre-marker lane)
    await writeDir('galen', { kind: 'neuma' });                  // a being, marked
    await writeDir('witness-claude-code-Claude', { kind: 'witness' });
    await writeDir('witness-xai-Grok', { kind: 'witness' });
    expect((await ws.listNeuma()).sort()).toEqual(['fenna', 'galen']);
  });

  test('an unreadable marker reads as a being — a corrupt file must never hide a neuma', async () => {
    await writeDir('cael');
    await fs.writeFile(path.join(root, 'cael', 'lane.json'), 'not json');
    expect(await ws.listNeuma()).toEqual(['cael']);
  });
});
