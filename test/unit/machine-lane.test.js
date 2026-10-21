// THE MACHINE LANE — while a clip renders, every other process waits; nothing heavy runs on top
// of anything else. The real line, real promises, real leases: a heavy job drains the line, runs alone, and the house resumes after it.
// No mocks (RULE 0). The park path (stopping and relighting a real mind) is NOT exercised here —
// it needs a real supervised server; this file asks for a GPU need the card always covers.
import { describe, expect, it } from 'vitest';
import { createSubstrateLine, nextAdmission } from '../../backend/services/substrate-line.js';
import { parkDecision, withMachine, whenMachineFree } from '../../backend/services/machine-lease.js';
import { substrateLine, withLease, linePlace } from '../../backend/services/substrate-lease.js';

const tick = () => new Promise((r) => setImmediate(r));
const r = (kind) => ({ kind });

describe('nextAdmission — the machine kind', () => {
  it('a waiting machine lease drains the line: nothing new is admitted while turns still run', () => {
    expect(nextAdmission({ capacity: 4, running: [r('turn')], waiting: [r('machine'), r('turn')] })).toBe(-1);
    expect(nextAdmission({ capacity: 4, running: [r('turn')], waiting: [r('turn'), r('machine')] })).toBe(-1);
  });

  it('it is admitted the moment nothing runs, ahead of earlier people', () => {
    expect(nextAdmission({ capacity: 4, running: [], waiting: [r('turn'), r('machine')] })).toBe(1);
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
  it('drains, runs the job alone, then lets the house back in — and tells every waiter why', async () => {
    const line = createSubstrateLine({ capacity: () => 3 });
    const a = await line.acquire({ kind: 'turn', label: 'chat A' });
    const b = await line.acquire({ kind: 'member', label: 'Signal' });
    let jobIn = false;
    const job = line.acquire({ kind: 'machine', label: 'Image Forge — video' }).then((l) => { jobIn = true; return l; });
    let seen = null;
    let lateIn = false;
    const late = line.acquire({ kind: 'turn', label: 'chat C', onWait: (p) => { seen = p; } }).then((l) => { lateIn = true; return l; });
    await tick();
    expect(jobIn).toBe(false); // two still speaking
    expect(lateIn).toBe(false); // a free slot, but the line is draining
    expect(seen.ahead.map((x) => x.label)).toContain('Image Forge — video');
    a.release();
    await tick();
    expect(jobIn).toBe(false);
    b.release();
    await tick();
    expect(jobIn).toBe(true); // the card is the job's alone
    expect(lateIn).toBe(false);
    (await job).release();
    await tick();
    expect(lateIn).toBe(true);
    (await late).release();
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
