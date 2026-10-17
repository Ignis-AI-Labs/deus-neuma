/**
 * read_history — the ground's git history as a tool a resident can call.
 *
 * Born 2026-08-21: a resident reviewing the day's work reached for the only
 * road it could see — reading `.git/` raw — and was rightly denied (the
 * tool-sandbox seals git internals after a proven rename/inject attack).
 * The honest fix is a curated read: the platform runs a CLOSED set of
 * read-only git commands in the ground and returns the answer, never the
 * internals. Under test with a REAL repository and REAL commits on disk —
 * the real readers, the real handler, no mocks anywhere (RULE 0).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { fixtureGit } from '../helpers/harness-git-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { sendToolEvent } from '../../backend/services/witness-tool-events.js';
import { handleMapTool, mapToolsFor, isMapTool } from '../../backend/services/map-being-tools.js';
import { isSafeRef } from '../../backend/services/ground-git.js';

let root;
let connection;
let firstSha;
let portal;
const ports = { sendToolEvent };
const call = (args = {}) => handleMapTool(portal.ws, connection, { toolName: 'read_history' }, args, ports);

const git = (...args) => fixtureGit(root, args);

beforeAll(async () => {
  portal = await createHarnessTurnKit('harness-history-read-fixture');
  root = portal.ground;
  await fs.writeFile(path.join(root, 'a.js'), 'export const a = 1;\n');
  await fs.writeFile(path.join(root, 'b.js'), 'export const b = 1;\n');
  await git('init', '-b', 'fixture-main');
  await git('add', '.');
  await git('commit', '-m', 'the founding commit');
  await fs.writeFile(path.join(root, 'a.js'), 'export const a = 2;\n');
  await git('add', 'a.js');
  await git('commit', '-m', 'a grows up');
  firstSha = (await git('log', '--pretty=format:%h', '--reverse')).split('\n')[0];
  // An uncommitted change, so the bare call has something honest to report.
  await fs.writeFile(path.join(root, 'b.js'), 'export const b = 2;\n');
  connection = portal.connection;
  connection.toolWorkspace = root;
  // This file proves history content, not consent. Grant the exact fixture
  // capability; harness-git-consent proves the real default/card/revoke paths.
  await workspace.writeToolPolicy(portal.laneId, { map: { allowed: ['read_history'] } });
});

afterAll(async () => { await portal?.close(); });

describe('advertisement', () => {
  it('rides the map family — offered with a ground, absent without one', () => {
    expect(mapToolsFor(connection).map((t) => t.name)).toContain('read_history');
    expect(mapToolsFor({ companion: { neumaId: 'x' } })).toEqual([]);
  });

  it('is recognised in every call dialect', () => {
    expect(isMapTool({ toolName: 'read_history' })).toBe(true);
    expect(isMapTool({ tool: 'map/read_history' })).toBe(true);
  });
});

describe('the bare call — the review a resident actually wants', () => {
  let content;
  beforeAll(async () => { content = (await call()).content; });

  it('leads with the live branch state', () => {
    expect(content).toContain('branch:   fixture-main');
  });

  it('lists the commits newest first, with author and subject', () => {
    const growsUp = content.indexOf('a grows up');
    const founding = content.indexOf('the founding commit');
    expect(growsUp).toBeGreaterThan(-1);
    expect(founding).toBeGreaterThan(growsUp);
    expect(content).toContain('Fixture');
  });

  it('reports what is changed but not yet committed', () => {
    expect(content).toContain('CHANGED BUT NOT COMMITTED');
    expect(content).toContain('b.js');
  });

  it('never leaks a remote URL — the organ law holds here too', () => {
    expect(content).not.toMatch(/https?:\/\/|git@/);
  });
});

describe('narrowing', () => {
  it('a path narrows to the commits that touched it', async () => {
    const { content } = await call({ path: 'b.js' });
    expect(content).toContain('COMMITS TOUCHING b.js');
    expect(content).toContain('the founding commit');
    expect(content).not.toContain('a grows up');
  });

  it('a ref answers with that one commit — message and files touched', async () => {
    const { content } = await call({ ref: firstSha });
    expect(content).toContain('the founding commit');
    expect(content).toContain('a.js');
    expect(content).toContain('b.js');
  });
});

describe('refusals — every wrong road is a plain sentence, never a surprise', () => {
  it('a path outside the ground', async () => {
    const out = await call({ path: '../../../etc/passwd' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/outside the focused folder/);
  });

  it('a ref that names nothing', async () => {
    const out = await call({ ref: 'deadbeef999' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/Unknown commit/);
  });

  it('a flag-shaped ref never reaches git at all', async () => {
    expect(isSafeRef('--output=/tmp/evil')).toBe(false);
    expect(isSafeRef('-p')).toBe(false);
    expect(isSafeRef('HEAD~1')).toBe(true);
    const out = await call({ ref: '--all' });
    expect(out.status).toBe('error');
  });

  it('a ground that is not a repository answers honestly', async () => {
    const bare = path.join(portal.root, 'plain');
    await fs.mkdir(bare);
    connection.toolWorkspace = bare;
    try {
      const out = await call();
      expect(out.status).toBe('ok');
      expect(out.content).toMatch(/not a git repository/);
    } finally { connection.toolWorkspace = root; }
  });
});
