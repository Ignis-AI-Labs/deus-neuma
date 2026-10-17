/**
 * A chat born under an active project joins it — proven on the REAL store.
 *
 * No mocks: `_pinSessionToProject` writes through the real user-projects
 * service into a real projects.json on a temp realm root. This is the durable
 * truth behind […] — the frontend stamps the project
 * as the turn's space, the stream stamps it onto the new session at mint, and
 * the pin lands here.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createProject, readProjectStore } from '../../backend/services/user-projects.js';
import { normalizeSpace } from '../../core/memory/space.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { _pinSessionToProject } = __test;

const WALLET = '0x1111111111111111111111111111111111111111';

// The connection shape as the stream builds it: walletAddress + companion +
// the normalized project space (exactly what portal-routes sets from the
// turn's `message.space`).
const projectConn = (project, companion) => ({
  walletAddress: WALLET,
  companion,
  space: normalizeSpace({ id: project.id, kind: 'project', label: project.name }),
});

describe('a new chat pins to the active project (real store)', () => {
  let project;
  let companion;

  beforeEach(async () => {
    setRealmRoot(await createTempDir('project-chat-pin'));
    const folder = await createTempDir('proj-folder');
    project = await createProject(WALLET, { name: 'Voice Layer', folder });
    companion = { neumaId: 'cael', name: 'Cael' };
  });

  test('a fresh session lands in the project with a thought-derived label', async () => {
    await _pinSessionToProject(projectConn(project, companion), companion, 'session-100', 'help me refine the lip-sync');
    const stored = (await readProjectStore(WALLET)).projects[0];
    expect(stored.pinnedChats).toHaveLength(1);
    expect(stored.pinnedChats[0]).toMatchObject({
      neumaId: 'cael', companionName: 'Cael', sessionId: 'session-100', label: 'help me refine the lip-sync',
    });
  });

  test('the label is collapsed and capped at 60 chars; an empty thought falls back to the session id', async () => {
    const conn = projectConn(project, companion);
    await _pinSessionToProject(conn, companion, 'session-long', `  spread   over\nmany   lines ${'x'.repeat(80)}`);
    await _pinSessionToProject(conn, companion, 'session-empty', '   ');
    const chats = (await readProjectStore(WALLET)).projects[0].pinnedChats;
    const long = chats.find((c) => c.sessionId === 'session-long');
    const empty = chats.find((c) => c.sessionId === 'session-empty');
    expect(long.label.length).toBe(60);
    expect(long.label.startsWith('spread over many lines')).toBe(true); // whitespace runs collapsed
    expect(empty.label).toBe('session-empty'); // no words → the id stands in
  });

  test('pinning is idempotent — the same session never doubles', async () => {
    const conn = projectConn(project, companion);
    await _pinSessionToProject(conn, companion, 'session-1', 'first');
    await _pinSessionToProject(conn, companion, 'session-1', 'first again');
    expect((await readProjectStore(WALLET)).projects[0].pinnedChats).toHaveLength(1);
  });

  test('a chat with no active project (general space) is not pinned anywhere', async () => {
    const conn = { walletAddress: WALLET, companion, space: normalizeSpace(null) }; // general
    await _pinSessionToProject(conn, companion, 'session-x', 'a thought');
    expect((await readProjectStore(WALLET)).projects[0].pinnedChats).toHaveLength(0);
  });

  test('a deleted project mid-session is a safe no-op — the turn never fails', async () => {
    // A project space whose id matches nothing in the store (deleted, or a
    // stale client) must not throw out of the turn.
    const ghost = { walletAddress: WALLET, companion, space: normalizeSpace({ id: 'deadbeefdeadbeef', kind: 'project', label: 'Gone' }) };
    await expect(_pinSessionToProject(ghost, companion, 'session-ghost', 'still talking')).resolves.toBeUndefined();
    expect((await readProjectStore(WALLET)).projects[0].pinnedChats).toHaveLength(0);
  });
});
