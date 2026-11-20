/**
 * A SUB-CHAT IS FILED UNDER THE CHAT IT WAS SPAWNED FROM — Design note, 2026-11-16: […]
 *
 * Rule 0: a real lane on tmp disk; the real record, read back through the real fold.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { noteSubChat, readThreads, foldThreads } from '../../backend/services/chat-threads.js';

const PRIOR = getWorkspacesRoot();
let root;
const [P, C1, C2] = ['session-1794000000001', 'session-1794000000002', 'session-1794000000003'];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-chat-threads-'));
  setWorkspacesRoot(root);
  await workspace.create('firepos');
});
afterAll(async () => { setWorkspacesRoot(PRIOR); await fs.rm(root, { recursive: true, force: true }); });

describe('chat threads', () => {
  test('a being with no sub-chat has none; each one written is read back under its parent', async () => {
    expect(await readThreads('firepos')).toEqual({});
    expect(await noteSubChat('firepos', { child: C1, parent: P, kind: 'clone', title: 'Clone 1: read the docs' })).toBe(true);
    expect(await noteSubChat('firepos', { child: C2, parent: P, kind: 'clone', title: 'Clone 2: check prices' })).toBe(true);
    const threads = await readThreads('firepos');
    expect(Object.keys(threads)).toEqual([C1, C2]);
    expect(threads[C1]).toMatchObject({ parent: P, kind: 'clone', title: 'Clone 1: read the docs' });
    // The record sits in the lane, beside the sessions, never among them.
    expect((await fs.readdir(path.join(workspace.pathFor('firepos')))).includes('chat-threads.jsonl')).toBe(true);
    expect((await workspace.listSessions('firepos')).some((s) => /thread/.test(s))).toBe(false);
  });

  test('a link that names no real chat, or a chat as its own parent, is never kept; the first link for a chat stands', async () => {
    expect(await noteSubChat('firepos', { child: C1, parent: null, kind: 'clone' })).toBe(false);
    expect(await noteSubChat('firepos', { child: P, parent: P, kind: 'clone' })).toBe(false);
    expect(await noteSubChat('firepos', { child: '../etc', parent: P, kind: 'clone' })).toBe(false);
    expect(foldThreads([{ child: C1, parent: P }, { child: C1, parent: C2 }, { child: 'x', parent: P }, null])).toEqual({ [C1]: { parent: P, kind: 'sub', title: '', at: null } });
  });
});
