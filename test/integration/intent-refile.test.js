/**
 * A refused filing, FIXED IN PLACE, is answered again — and nothing that ran
 * ever runs twice (2026-10-12). Live, a lead filed its team/run without the
 * "type" field, was refused as invalid, wrote the corrected act into the SAME
 * file — and the stale refusal beside it held the fix unread for good.
 *
 * Real disk, the real sweep, a real intent type (tasks/add — its act is the
 * being's own ledger on disk). No mock on the path.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const NEUMA_ID = 'refile-echo';

describe('the intent sweep reads a fixed filing again — never a settled act', () => {
  let origRoot, dir;
  const connection = () => ({ companion: { name: 'RefileEcho', neumaId: NEUMA_ID } });
  const sweep = () => sweepIntents(connection(), { mode: 'auto', lanePolicy: null, emit: () => {} });
  const file = (name, payload) => fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  const result = async (name) => JSON.parse(await fs.readFile(path.join(dir, `${name}.result.json`), 'utf8'));
  // A later write must read as later on disk — never the same clock tick.
  const tick = () => new Promise((r) => setTimeout(r, 25));

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(await createTempDir('intent-refile'), 'workspaces'));
    await workspace.create(NEUMA_ID);
    dir = path.join(workspace.pathFor(NEUMA_ID), 'intents');
    await fs.mkdir(dir, { recursive: true });
  });
  afterAll(() => setWorkspacesRoot(origRoot));

  test('refused as invalid, fixed in the same file, answered — then final', async () => {
    await file('the-act', { type: 'tasks/add' }); // no title: invalid
    expect((await sweep()).map((r) => r.status)).toEqual(['error']);
    expect((await result('the-act')).status).toBe('invalid');

    await tick();
    await file('the-act', { type: 'tasks/add', title: 'answer the operator' }); // fixed in place
    const receipts = await sweep();
    expect(receipts.map((r) => r.status)).toEqual(['ok']);
    expect((await result('the-act')).status).toBe('done');

    // What ran is final: the same file written again is never a second act.
    await tick();
    await file('the-act', { type: 'tasks/add', title: 'answer the operator' });
    expect(await sweep()).toEqual([]);
    expect((await result('the-act')).status).toBe('done');
  });

  test('a fix left lying (rewritten long ago, or long after its refusal) never fires into what comes next', async () => {
    const hour = 60 * 60 * 1000;
    // Rewritten right after the refusal — but an hour ago, never swept since.
    await file('left-lying', { type: 'tasks/add' });
    await sweep();
    const at = Date.now() - hour;
    await fs.utimes(path.join(dir, 'left-lying.result.json'), new Date(at - 2000), new Date(at - 2000));
    await file('left-lying', { type: 'tasks/add', title: 'an old intention' });
    await fs.utimes(path.join(dir, 'left-lying.json'), new Date(at), new Date(at));
    expect(await sweep()).toEqual([]);
    expect((await result('left-lying')).status).toBe('invalid');
    // Rewritten just now — but an hour after its refusal: not a correction.
    await fs.utimes(path.join(dir, 'left-lying.json'), new Date(), new Date());
    expect(await sweep()).toEqual([]);
  });

  test('an invalid result the being has not touched since stays settled', async () => {
    await file('left-alone', { type: 'no/such-type' });
    await sweep();
    expect((await result('left-alone')).status).toBe('invalid');
    expect(await sweep()).toEqual([]);
  });
});
