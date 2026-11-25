/* global setImmediate */
// THE MACHINE LANE — while a clip renders, every other process waits; nothing heavy runs on top
// of anything else. The real line, real promises, real leases: a heavy job drains the line, runs alone, and the house resumes after it.
// No mocks (RULE 0). The park path (stopping and relighting a real mind) is NOT exercised here —
// it needs a real supervised server; this file asks for a GPU need the card always covers.
import { describe, expect, it } from 'vitest';
import { createSubstrateLine, nextAdmission } from '../../backend/services/substrate-line.js';
import { parkDecision, withMachine, whenMachineFree } from '../../backend/services/machine-lease.js';
import { substrateLine, withLease, linePlace } from '../../backend/services/substrate-lease.js';

const tick = () => new Promise((r) => setImmediate(r));
const r = (kind, more = {}) => ({ kind, ...more });

describe('nextAdmission — the machine kind', () => {
  // BETWEEN ROUNDS, NOT AFTER TURNS (Design note, 2026-11-20: an image […] behind a clone's hour-long turn):
  // the job waits for every answer in flight, never for whole turns.
  it('a waiting machine job waits while any answer is in flight; nothing new is admitted meanwhile', () => {
    expect(nextAdmission({ capacity: 4, running: [r('turn', { busy: 1 })], waiting: [r('machine'), r('turn')] })).toBe(-1);
    expect(nextAdmission({ capacity: 4, running: [r('turn', { busy: 1 })], waiting: [r('turn'), r('machine')] })).toBe(-1);
    // A single request's own place is an answer in flight for as long as it runs.
    expect(nextAdmission({ capacity: 4, running: [r('background', { request: true })], waiting: [r('machine')] })).toBe(-1);
  });

  it('it goes in the moment no answer is in flight — beside routes resting between rounds — ahead of earlier people', () => {
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('turn'), r('machine')] })).toBe(1);
    expect(nextAdmission({ capacity: 4, running: [r('turn', { busy: 0 }), r('member')], waiting: [r('turn'), r('machine')] })).toBe(1);
  });

  it('while it runs, nothing else is admitted — not even with slots free', () => {
    expect(nextAdmission({ capacity: 4, running: [r('machine')], waiting: [r('turn')] })).toBe(-1);
    expect(nextAdmission({ capacity: 4, running: [r('machine')], waiting: [r('machine')] })).toBe(-1);
  });

  it('no machine lease in line: the old law, unchanged', () => {
    expect(nextAdmission({ capacity: 2, running: [r('turn')], waiting: [r('turn')] })).toBe(0);
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('background'), r('turn')] })).toBe(1);
  });
});

describe('the line with a heavy job in it', () => {
  it('the job goes in between rounds: answers in flight finish, the next rounds pause, the job runs alone, they carry on', async () => {
    const line = createSubstrateLine({ capacity: () => 3 });
    const a = await line.acquire({ kind: 'turn', label: 'chat A' });
    const b = await line.acquire({ kind: 'member', label: 'Clone 2' });
    const answeringA = await line.pass({ id: a.id }); // chat A's round is being answered
    let jobIn = false;
    const job = line.acquire({ kind: 'machine', label: 'Image Forge — image' }).then((l) => { jobIn = true; return l; });
    let seen = null;
    let lateIn = false;
    const late = line.acquire({ kind: 'turn', label: 'chat C', onWait: (p) => { seen = p; } }).then((l) => { lateIn = true; return l; });
    // The clone's next round asks while the job waits: it pauses, its place kept.
    let cloneRound = null;
    const nextOfB = line.pass({ id: b.id }).then((p) => { cloneRound = p; return p; });
    await tick();
    expect(jobIn).toBe(false); // chat A's answer is still being read
    expect(lateIn).toBe(false); // a free slot, but the job is ahead
    expect(cloneRound).toBe(null);
    expect(line.snapshot().paused).toBe(1);
    expect(seen.ahead.map((x) => x.label)).toContain('Image Forge — image');
    answeringA.release();
    await tick();
    expect(jobIn).toBe(true); // the card is the job's alone — both routes still hold their places
    expect(line.snapshot().running.map((x) => x.label)).toEqual(['chat A', 'Clone 2', 'Image Forge — image']);
    expect(cloneRound).toBe(null);
    (await job).release();
    await tick();
    expect(cloneRound).not.toBe(null); // the clone carries on
    expect(lateIn).toBe(true);
    (await nextOfB).release();
    for (const l of [a, b, await late]) l.release();
    expect(line.snapshot()).toMatchObject({ running: [], waiting: [], paused: 0 });
  });

  it('a route that does not ask meanwhile is never held; one that stepped out gets a pass that counts nothing', async () => {
    const line = createSubstrateLine({ capacity: () => 2 });
    const a = await line.acquire({ kind: 'turn', label: 'chat A' });
    const job = await line.acquire({ kind: 'machine', label: 'Image Forge — image' }); // A rests between rounds
    expect(line.snapshot().running.map((x) => x.kind)).toEqual(['turn', 'machine']);
    job.release();
    a.release();
    const gone = await line.pass({ id: a.id });
    expect(() => gone.release()).not.toThrow();
  });
});

describe('parkDecision — does the mind stay or step aside?', () => {
  it('stays when the job fits beside it, parks when it does not, nothing to move when none serves', () => {
    expect(parkDecision({ mindServing: true, engineGB: 42.8, needGB: 7 })).toBe('beside');
    expect(parkDecision({ mindServing: true, engineGB: 4.7, needGB: 7 })).toBe('park');
    expect(parkDecision({ mindServing: true, engineGB: null, needGB: 7 })).toBe('park');
    expect(parkDecision({ mindServing: false, engineGB: null, needGB: 7 })).toBe('clear');
  });
});

describe('withMachine — on the process line', () => {
  it('a turn that files a heavy job steps out, the job runs alone, the turn steps back in', async () => {
    let ranAlone = null;
    let backIn = null;
    await withLease({ kind: 'turn', label: 'a being filing a render' }, async () => {
      await withMachine({ label: 'Image Forge — test', needGB: 0.1 }, async () => {
        const snap = substrateLine.snapshot();
        ranAlone = snap.running.length === 1 && snap.running[0].kind === 'machine';
      });
      backIn = linePlace().away() === false;
    });
    expect(ranAlone).toBe(true);
    expect(backIn).toBe(true);
    await expect(whenMachineFree()).resolves.toBeUndefined();
    expect(substrateLine.snapshot().running).toEqual([]);
  });

  it('the job\'s own failure still gives the machine back', async () => {
    await expect(withMachine({ label: 'Image Forge — failing', needGB: 0.1 }, async () => {
      throw new Error('engine fell over');
    })).rejects.toThrow('engine fell over');
    expect(substrateLine.snapshot().running).toEqual([]);
    expect(substrateLine.snapshot().waiting).toEqual([]);
  });
});
