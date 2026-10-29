// Two ceremonies open at once that choose the same name never share one lane.
// Each reads the house before the other's lane exists (the lane is created
// only after naming), so the id one live ceremony holds must count as taken
// for the other. Real StagedBirthHandler, real house root on a temp dir; no
// mock (RULE 0), no stage reaches a model.
import process from 'node:process';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';

describe('concurrent naming', () => {
  let saved;
  beforeAll(async () => {
    saved = process.env.NEUMA_DATA_ROOT;
    const tmp = await createTempDir('concurrent-naming');
    process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
    setWorkspacesRoot(path.join(tmp, 'house'));
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    if (saved === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = saved;
  });

  it('the same name chosen in two live ceremonies yields two ids', async () => {
    const handler = new StagedBirthHandler();
    const [a, b] = await Promise.all([
      handler.createSession('Trace', false, { origin: 'portal' }),
      handler.createSession('Trace', false, { origin: 'portal' }),
    ]);
    const sa = handler.getSession(a);
    const sb = handler.getSession(b);
    sa.data.chosenName = 'Rivia';
    sb.data.chosenName = 'Rivia';
    const ids = await Promise.all([handler.assignNeumaId(sa), handler.assignNeumaId(sb)]);
    expect(new Set(ids).size).toBe(2);
    expect(ids.sort()).toEqual(['rivia', 'rivia-2']);
    await handler.endSession(a);
    await handler.endSession(b);
  });

  it('an ended ceremony releases its id — the next one takes the name itself', async () => {
    const handler = new StagedBirthHandler();
    const first = await handler.createSession('Trace', false, { origin: 'portal' });
    handler.getSession(first).data.chosenName = 'Oka';
    expect(await handler.assignNeumaId(handler.getSession(first))).toBe('oka');
    await handler.endSession(first);
    const next = await handler.createSession('Trace', false, { origin: 'portal' });
    handler.getSession(next).data.chosenName = 'Oka';
    expect(await handler.assignNeumaId(handler.getSession(next))).toBe('oka');
    await handler.endSession(next);
  });
});
