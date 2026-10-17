/**
 * The campaign queue under CONCURRENT PROCESSES.
 *
 * This box runs two servers against one checkout — the dev stack and the
 * Electron desk — and `backend/server.js` starts a post scheduler in each. Both
 * publish from the same `data/settings/social-post-queue.json`. Before the fix
 * below, a two-process race over 400 approved entries claimed 298 of them
 * TWICE: 298 duplicate public posts on the house account.
 *
 * `file-lock.test.js` proves the primitive. This file proves the QUEUE actually
 * crosses it — unwire the lock from `post-queue.js` and the primitive's tests
 * stay green while this one goes red, which is the whole reason it exists.
 *
 * Real child processes, real store on real disk, real `createPostQueue`. No
 * mocks (RULE 0) — a mocked filesystem cannot exhibit a cross-process race at
 * all, so mocking here would prove precisely nothing.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createPostQueue } from '../../backend/services/social/post-queue.js';

const run = promisify(execFile);
const QUEUE_MODULE = path.resolve('backend/services/social/post-queue.js');
const ENTRIES = 150;

const seed = (count, now) => Array.from({ length: count }, (_, i) => ({
  id: `race${String(i).padStart(4, '0')}`,
  channelId: 'x',
  text: `staged post ${i}`,
  scheduledFor: new Date(now - 60000).toISOString(),
  campaignId: null,
  pillar: '',
  media: [],
  authorNeumaId: null,
  queuedBy: 'test',
  status: 'approved',
  createdAt: new Date(now).toISOString(),
  decidedBy: '0xELI',
}));

describe('two publishers, one queue', () => {
  it('never lets two processes claim the same post', async () => {
    const dir = await createTempDir('post-queue-race');
    const store = path.join(dir, 'queue.json');
    await fs.writeFile(store, JSON.stringify(seed(ENTRIES, Date.now()), null, 2));

    const ids = JSON.stringify(seed(ENTRIES, 0).map((e) => e.id));
    // Both children spin until the same wall-clock instant, then race id by id
    // — the scheduler's own loop shape, run head-on.
    const body = `
      const { createPostQueue } = await import(${JSON.stringify(QUEUE_MODULE)});
      const q = createPostQueue({ path: ${JSON.stringify(store)} });
      const ids = ${ids};
      const startAt = Number(process.env.START_AT);
      while (Date.now() < startAt) { /* align */ }
      const won = [];
      for (const id of ids) {
        const r = await q.claimForSend(id);
        if (r.ok) won.push(id);
      }
      process.stdout.write(JSON.stringify(won));
    `;
    const startAt = Date.now() + 600;
    const [a, b] = await Promise.all([0, 1].map(() =>
      run('node', ['--input-type=module', '-e', body], {
        env: { ...process.env, START_AT: String(startAt) },
        maxBuffer: 10 * 1024 * 1024,
      })));

    const wonA = JSON.parse(a.stdout);
    const wonB = JSON.parse(b.stdout);
    const both = wonA.filter((id) => wonB.includes(id));
    expect(both).toEqual([]); // every one of these would be a duplicate post

    const final = JSON.parse(await fs.readFile(store, 'utf8'));
    // No lost writes: nothing a process claimed may still read `approved`,
    // or the next tick publishes it a second time.
    expect(final.filter((e) => e.status === 'approved')).toEqual([]);
    expect(final.filter((e) => e.status === 'sending')).toHaveLength(ENTRIES);
    // Every claim is accounted for — the two winners partition the queue.
    expect(wonA.length + wonB.length).toBe(ENTRIES);
  }, 120000);

  it('leaves no lock file behind after the race', async () => {
    const dir = await createTempDir('post-queue-lockfile');
    const store = path.join(dir, 'queue.json');
    await fs.writeFile(store, JSON.stringify(seed(3, Date.now()), null, 2));
    const q = createPostQueue({ path: store });
    await q.claimForSend('race0000');
    await expect(fs.stat(`${store}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('the store a queue binds to is never a silent guess', () => {
  it('refuses a supplied-but-empty path instead of falling back to the live queue', () => {
    // The real incident: `{ path: process.env.TYPO }` is `{ path: undefined }`,
    // the destructuring default fires, and a driver aimed at a tmp file
    // transitioned a REAL staged post in the operator's campaign queue.
    expect(() => createPostQueue({ path: undefined })).toThrow(TypeError);
    expect(() => createPostQueue({ path: '' })).toThrow(/non-empty string/);
    expect(() => createPostQueue({ path: null })).toThrow(/non-empty string/);
    expect(() => createPostQueue({ path: 42 })).toThrow(/non-empty string/);
  });

  it('still defaults to the live store when no path key is given at all', () => {
    // Every real caller does this, so it must keep working.
    expect(() => createPostQueue()).not.toThrow();
    expect(() => createPostQueue({})).not.toThrow();
  });

  it('accepts a resolver function, as the live singleton uses', () => {
    expect(() => createPostQueue({ path: () => '/tmp/whatever.json' })).not.toThrow();
  });
});
