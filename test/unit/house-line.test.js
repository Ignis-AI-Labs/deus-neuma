// THE LINE in front of the local model server (Design note, 2026-10-12: […]).
// The real line, real promises, real AbortSignals — the admission law and the waiting it tells.
import { describe, expect, it } from 'vitest';
import { createSubstrateLine, nextAdmission } from '../../backend/services/substrate-line.js';

const tick = () => new Promise((r) => setImmediate(r));
const settled = async (p) => {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  await tick();
  return done;
};

describe('nextAdmission — the law', () => {
  const r = (kind) => ({ kind });
  it('nothing runs past the slot count', () => {
    expect(nextAdmission({ capacity: 2, running: [r('turn'), r('turn')], waiting: [r('turn')] })).toBe(-1);
  });
  it('first come, first served among people', () => {
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('member'), r('turn')] })).toBe(0);
  });
  it('background waits while any person waits', () => {
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('background'), r('turn')] })).toBe(1);
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('background')] })).toBe(0);
  });
  it('a team never takes the last slot — the operator\'s turn goes past a member held back', () => {
    const running = [r('member'), r('member'), r('member')];
    expect(nextAdmission({ capacity: 4, running, waiting: [r('member'), r('turn')] })).toBe(1);
    expect(nextAdmission({ capacity: 4, running, waiting: [r('member')] })).toBe(-1);
  });
  it('a single-slot server shares its one slot', () => {
    expect(nextAdmission({ capacity: 1, running: [], waiting: [r('member')] })).toBe(0);
  });
  it('a house wake is a person in line, and never takes the operator\'s last slot — members and wakes share the house\'s room', () => {
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('background'), r('wake')] })).toBe(1);
    const running = [r('member'), r('member'), r('wake')];
    expect(nextAdmission({ capacity: 4, running, waiting: [r('wake'), r('turn')] })).toBe(1);
    expect(nextAdmission({ capacity: 4, running, waiting: [r('wake')] })).toBe(-1);
    expect(nextAdmission({ capacity: 4, running: [r('wake'), r('wake')], waiting: [r('member')] })).toBe(0);
  });
});

describe('the line', () => {
  it('a route keeps its slot until it releases, and the next in line runs then — not before', async () => {
    const line = createSubstrateLine({ capacity: () => 1 });
    const first = await line.acquire({ kind: 'turn', label: 'Metidar' });
    const second = line.acquire({ kind: 'turn', label: 'Zezebur' });
    expect(await settled(second)).toBe(false); // nothing gets in between
    first.release();
    const lease = await second;
    expect(line.snapshot().running.map((x) => x.label)).toEqual(['Zezebur']);
    lease.release();
    expect(line.snapshot()).toMatchObject({ running: [], waiting: [] });
  });

  it('a waiter is told its place and who is ahead, every time the line moves', async () => {
    const line = createSubstrateLine({ capacity: () => 1 });
    const a = await line.acquire({ kind: 'turn', label: 'Metidar' });
    const seenB = [];
    const seenC = [];
    const b = line.acquire({ kind: 'member', label: 'Kisonam (team)', onWait: (p) => seenB.push(p) });
    line.acquire({ kind: 'turn', label: 'Zezebur', onWait: (p) => seenC.push(p) });
    await tick();
    expect(seenC.at(-1).position).toBe(2);
    expect(seenC.at(-1).ahead.map((x) => x.label)).toEqual(['Metidar', 'Kisonam (team)']);
    a.release();
    await b;
    expect(seenC.at(-1).position).toBe(1);
    expect(seenC.at(-1).ahead.map((x) => x.label)).toEqual(['Kisonam (team)']);
    expect(seenB.length).toBeGreaterThan(0);
  });

  it('leaving the line (an interrupt) frees the place and moves everyone up', async () => {
    const line = createSubstrateLine({ capacity: () => 1 });
    const a = await line.acquire({ kind: 'turn', label: 'A' });
    const ctl = new AbortController();
    const b = line.acquire({ kind: 'turn', label: 'B', signal: ctl.signal });
    const c = line.acquire({ kind: 'turn', label: 'C' });
    ctl.abort(new Error('the operator interrupted'));
    await expect(b).rejects.toThrow('the operator interrupted');
    a.release();
    const lease = await c;
    expect(line.snapshot().running.map((x) => x.label)).toEqual(['C']);
    lease.release();
  });

  it('a release twice is a release once — it never frees a slot it does not hold', async () => {
    const line = createSubstrateLine({ capacity: () => 1 });
    const a = await line.acquire({ kind: 'turn' });
    const b = line.acquire({ kind: 'turn' });
    const c = line.acquire({ kind: 'turn' });
    a.release();
    a.release();
    await b;
    expect(await settled(c)).toBe(false);
    expect(line.snapshot().running).toHaveLength(1);
  });

  it('the desk can watch the line move', async () => {
    const line = createSubstrateLine({ capacity: () => 2 });
    const seen = [];
    const stop = line.watch((snap) => seen.push(snap.running.length));
    const a = await line.acquire({ kind: 'turn' });
    a.release();
    stop();
    expect(seen).toEqual([1, 0]);
  });
});
