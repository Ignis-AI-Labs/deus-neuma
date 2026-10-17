/**
 * CHAT WATCHES (RULE 0) — a chat keeps a lens on something long and is told
 * when it ends (Design note, 2026-10-15: […]).
 * The real registry on a real temp data root, and a real deliverer function
 * standing where the portal's sits: armed per conversation, fired by the
 * producer with its report, handed to the deliverer, claimed exactly once,
 * held for a chat that is not open and offered again when it opens, and kept
 * on disk across a restart.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  armWatch, fireWatches, pendingFor, armedWatches, claimWatch, offerPending, setWatchDeliverer, __resetWatches,
} from '../../backend/services/chat-watch.js';

const before = process.env.NEUMA_DATA_ROOT;
const W = '0xABCDEF0000000000000000000000000000000001';
const chat = { wallet: W, laneId: 'harness-1234abcd', sessionId: 'session-1' };
let offered;

beforeEach(() => {
  process.env.NEUMA_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-watch-'));
  __resetWatches();
  offered = [];
  setWatchDeliverer((watch) => { offered.push(watch); });
});
afterAll(() => {
  setWatchDeliverer(null);
  if (before === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = before;
});

describe('a chat sets a watch; the watched thing ends; the chat is told', () => {
  test('armed once per conversation and thing — a second arm is the same watch', async () => {
    const one = await armWatch({ ...chat, kind: 'bench', ref: 'desk-1', label: 'The benchmark you launched (smoke)' });
    const two = await armWatch({ ...chat, kind: 'bench', ref: 'desk-1', label: 'again' });
    expect(two.id).toBe(one.id);
    expect(one.wallet).toBe(W.toLowerCase());
    expect(await armedWatches()).toHaveLength(1);
    // no session to be told in → no watch
    expect(await armWatch({ ...chat, sessionId: null, kind: 'bench', ref: 'desk-2' })).toBeNull();
  });

  test('fired with the report, handed to the deliverer, claimed exactly once', async () => {
    await armWatch({ ...chat, kind: 'bench', ref: 'desk-1', label: 'The benchmark you launched (smoke)' });
    await armWatch({ ...chat, sessionId: 'session-2', kind: 'bench', ref: 'desk-1', label: 'x' });
    expect(await fireWatches('bench', 'desk-1', 'Benchmark smoke finished: bare ✓ 0.8 · harness ✓ 1')).toBe(2);
    expect(offered.map((w) => w.sessionId).sort()).toEqual(['session-1', 'session-2']);
    expect(offered[0].report).toContain('bare ✓ 0.8');
    expect(claimWatch(offered[0].id)).toBe(true);
    expect(claimWatch(offered[0].id)).toBe(false); // never a second turn for one watch
    // another thing settling fires nothing here
    expect(await fireWatches('bench', 'desk-9', 'other')).toBe(0);
  });

  test('a chat not open holds its fired watch; opening it offers the watch again', async () => {
    const watch = await armWatch({ ...chat, kind: 'bench', ref: 'desk-1', label: 'L' });
    await fireWatches('bench', 'desk-1', 'R');
    expect((await pendingFor(chat)).map((w) => w.id)).toEqual([watch.id]); // the deliverer found no open chat: still pending
    offered = [];
    await offerPending(chat);
    expect(offered.map((w) => w.id)).toEqual([watch.id]);
    claimWatch(watch.id);
    expect(await pendingFor(chat)).toEqual([]);
    // another wallet's chat with the same ids is never offered this watch
    expect(await pendingFor({ ...chat, wallet: '0x0000000000000000000000000000000000000002' })).toEqual([]);
  });

  test('the registry is kept on disk — a desk restart still knows what it watches', async () => {
    await armWatch({ ...chat, kind: 'bench', ref: 'desk-1', label: 'L' });
    __resetWatches(); // the restart
    expect((await armedWatches()).map((w) => w.ref)).toEqual(['desk-1']);
    const file = path.join(process.env.NEUMA_DATA_ROOT, 'watches', 'watches.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).watches).toHaveLength(1);
  });
});
