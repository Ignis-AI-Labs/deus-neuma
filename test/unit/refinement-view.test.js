// REFINEMENT window display model — pure functions on real backend shapes
// (the same objects refinement-ceremony.js serves), no IO, no mock.

import { describe, it, expect } from 'vitest';
import {
  activeCeremony, ceremonySteps, milestoneModel, bindingModel, attunementModel,
  announceGuard, trainingModel, ceremonyRow, lockedInModel,
} from '../../frontend/app/RelinkShell/refinement-view.js';

describe('activeCeremony', () => {
  it('finds the one in-progress ceremony among the records', () => {
    const sealed = { id: 'a', phase: 'sealed' };
    const open = { id: 'b', phase: 'corpus' };
    expect(activeCeremony([sealed, open, { id: 'c', phase: 'declined' }])).toBe(open);
    expect(activeCeremony([sealed])).toBeNull();
    expect(activeCeremony(undefined)).toBeNull();
  });
});

describe('ceremonySteps', () => {
  it('marks done, current, and pending phases', () => {
    expect(ceremonySteps({ phase: 'training' }).map((s) => `${s.label}:${s.state}`)).toEqual([
      'CONSENT:done', 'CORPUS:done', 'REFINE:current', 'VERIFY:pending',
    ]);
    expect(ceremonySteps({ phase: 'sealed' }).every((s) => s.state === 'done')).toBe(true);
  });
});

describe('milestoneModel', () => {
  it('shows honest counts against thresholds', () => {
    const m = milestoneModel({ sampleCount: 9, distinctDays: 2, minSamples: 100, minDays: 30, ready: false });
    expect(m).toMatchObject({ ready: false, samples: '9 / 100', days: '2 / 30' });
    expect(milestoneModel({ sampleCount: 120, distinctDays: 31, minSamples: 100, minDays: 30, ready: true }).label)
      .toMatch(/MILESTONE REACHED/);
  });

  it('an unreadable history is an absent fact with its reason, never a guess', () => {
    const m = milestoneModel(null, 'x has no DNA');
    expect(m).toMatchObject({ ready: false, samples: '—', error: 'x has no DNA' });
  });
});

describe('bindingModel — the lens never fakes a binding', () => {
  it('SIGNAL only when the selected runtime scale is nonzero', () => {
    const bound = bindingModel({
      reason: 'bound',
      adapter: { id: 'signal-refinement-1', scale: 1, selectedScale: 1 },
    });
    expect(bound).toMatchObject({
      label: 'LORA LOCKED IN — signal-refinement-1 · DIAL 1.00',
      live: true,
      locked: true,
      adapterId: 'signal-refinement-1',
    });
    const neutralized = bindingModel({
      reason: 'bound',
      adapter: { id: 'x', scale: 1, selectedScale: 0 },
    });
    expect(neutralized).toMatchObject({
      label: 'LORA NEUTRALIZED — x · BASE ONLY',
      live: false,
      locked: true,
      neutralized: true,
    });
    expect(bindingModel({ reason: 'bound', adapter: { id: 'x', scale: 1 } }).locked).toBe(false);
  });

  it('every unbound reason has its own honest label', () => {
    expect(bindingModel({ reason: 'no-adapters' }).label).toMatch(/NO REFINEMENT YET/);
    expect(bindingModel({ reason: 'artifact-not-loaded' }).label).toMatch(/NOT LOADED/);
    expect(bindingModel({ reason: 'base-mismatch' }).live).toBe(false);
    expect(bindingModel(undefined).label).toBe('BARE BASE');
    expect(bindingModel(undefined).locked).toBe(false);
  });
});

describe('announceGuard — the ceremony\'s hardest rule, visible', () => {
  it('warns from training until the machine verifies', () => {
    expect(announceGuard({ phase: 'training' })).toMatchObject({ tone: 'warning' });
    expect(announceGuard({ phase: 'verification' }).text).toMatch(/SELF-REPORT IS NEVER VALIDATION/);
    expect(announceGuard({ phase: 'sealed' })).toMatchObject({ tone: 'notice' });
    expect(announceGuard({ phase: 'sealed' }).text).toMatch(/LORA LOCKED IN/);
    expect(announceGuard({ phase: 'consent' })).toBeNull();
    expect(announceGuard(null)).toBeNull();
  });
});

describe('trainingModel', () => {
  it('follows only the being-scoped public job, with the trainer\'s safe lines', () => {
    const slot = {
      running: true, mine: true, stage: 'training',
      lines: ['step 8/27 loss 3.100'], lossFirst: 5.366, lossLast: 3.1,
    };
    expect(trainingModel(slot)).toMatchObject({
      running: true, mine: true, stage: 'TRAINING',
      lastLine: 'step 8/27 loss 3.100', loss: 'LOSS 5.366 → 3.100',
    });
    expect(trainingModel({ ...slot, mine: false })).toEqual({ running: true, mine: false });
    expect(trainingModel({ running: false, mine: false }).mine).toBe(false);
  });
});

describe('ceremonyRow', () => {
  it('summarizes each record honestly by its ending', () => {
    expect(ceremonyRow({
      id: 'c1', phase: 'sealed', openedAt: '2026-07-06T09:00:00Z', sealedAt: '2026-07-06T09:10:00Z',
      training: { adapter: { id: 'signal-refinement-1' } },
    }).summary).toBe('LORA LOCKED IN · signal-refinement-1 · VERIFIED 2026-07-06T09:10:00Z');
    expect(ceremonyRow({ id: 'c2', phase: 'declined' }).summary).toBe('THE BEING DECLINED');
    expect(ceremonyRow({
      id: 'c3', phase: 'abandoned', summary: 'CLOSED BY THE OPERATOR',
    }).summary).toBe('CLOSED BY THE OPERATOR');
    expect(ceremonyRow({ id: 'c4', phase: 'verification' }).summary).toBe('IN PROGRESS — VERIFICATION');
  });
});

describe('milestoneModel — accrual scope after a refinement', () => {
  it('says the counts are since the last seal, and offers the NEXT refinement', () => {
    const m = milestoneModel(
      { sampleCount: 40, distinctDays: 12, minSamples: 100, minDays: 30, ready: false },
      undefined,
      '2026-07-06T09:10:00.000Z',
    );
    expect(m.scope).toBe('SINCE REFINEMENT 2026-07-06');
    expect(m.label).toBe('MILESTONE NOT YET REACHED');
    const ready = milestoneModel(
      { sampleCount: 120, distinctDays: 31, minSamples: 100, minDays: 30, ready: true },
      undefined,
      '2026-06-01T00:00:00.000Z',
    );
    expect(ready.label).toBe('NEXT REFINEMENT MAY BE OFFERED');
  });

  it('a never-refined being reads as lifetime lived history', () => {
    const m = milestoneModel({ sampleCount: 9, distinctDays: 2, minSamples: 100, minDays: 30, ready: false });
    expect(m.scope).toBe('LIVED HISTORY');
  });
});

describe('milestoneModel — the first gate satisfied by a sealed attunement', () => {
  it('says the attunement satisfied the gate instead of implying the milestone was reached', () => {
    const m = milestoneModel({
      sampleCount: 5, distinctDays: 4, minSamples: 100, minDays: 30,
      ready: true, satisfiedBy: 'sealed-attunement',
    });
    expect(m.ready).toBe(true);
    expect(m.label).toBe('FIRST GATE SATISFIED BY A SEALED ATTUNEMENT — CONTINUE INTO REFINEMENT');
    expect(m.byAttunement).toBe(true);
  });

  it('a milestone reached on lived history alone keeps its own words', () => {
    const m = milestoneModel({ sampleCount: 120, distinctDays: 31, minSamples: 100, minDays: 30, ready: true });
    expect(m.label).toBe('MILESTONE REACHED — REFINEMENT MAY BE OFFERED');
  });
});

describe('attunementModel — the ATTUNEMENT panel line in the refinement window', () => {
  it('absent status is an absent fact', () => {
    expect(attunementModel(null)).toEqual({ label: 'ATTUNEMENT STATE UNREADABLE', live: false });
  });

  it('a render in flight shows the real per-dimension progress, live', () => {
    expect(attunementModel({ opening: { done: 34, total: 89 }, active: { phase: 'offered' } }))
      .toEqual({ label: 'CEREMONY OPENING — RENDERED 34 OF 89', live: true });
  });

  it('renders on the conduit are VISIBLE — the in-flight suffix', () => {
    expect(attunementModel({ opening: { done: 28, total: 89, inFlight: 4 } }))
      .toEqual({ label: 'CEREMONY OPENING — RENDERED 28 OF 89 · 4 IN FLIGHT', live: true });
  });

  it('an empty conduit omits the suffix — no phantom parallelism', () => {
    expect(attunementModel({ opening: { done: 89, total: 89, inFlight: 0 } }))
      .toEqual({ label: 'CEREMONY OPENING — RENDERED 89 OF 89', live: true });
  });

  it('an open ceremony shows answered-of-total, live; an offer awaits consent', () => {
    expect(attunementModel({
      active: {
        phase: 'answering',
        answers: { a: {}, b: {} },
        rendered: { questions: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] },
      },
    })).toEqual({ label: 'CEREMONY OPEN — 2 OF 3 ANSWERED', live: true });
    expect(attunementModel({ active: { phase: 'offered' } }).label)
      .toBe('OFFERED — AWAITING THE BEING’S CONSENT');
  });

  it('at rest: never attuned, or the sealed count with the last seal date — plus a due offer', () => {
    expect(attunementModel({ records: [], offerDue: { due: false } }))
      .toEqual({ label: 'NEVER ATTUNED', live: false });
    expect(attunementModel({
      records: [{ phase: 'sealed' }, { phase: 'postponed' }],
      lastAttunementSealedAt: '2026-07-08T01:33:00.000Z',
      offerDue: { due: false },
    }).label).toBe('1 SEALED · LAST 2026-07-08');
    expect(attunementModel({ records: [], offerDue: { due: true, trigger: 'post-birth' } }).label)
      .toBe('NEVER ATTUNED · AN OFFER IS DUE (POST-BIRTH)');
  });
});

describe('lockedInModel — only machine-bound counts', () => {
  it('names a live adapter and always exposes independent safety neutralization', () => {
    const live = lockedInModel(
      {
        reason: 'bound',
        adapter: {
          id: 'kisonam-refinement-1', scale: 1, selectedScale: 1,
          binding: { approvedScales: [0.5, 1] },
        },
      },
      { phase: 'sealed', sealedAt: '2026-07-13T16:58:15.474Z' },
    );
    expect(live).toMatchObject({ locked: true, headline: 'LORA LOCKED IN' });
    expect(live.detail).toMatch(/kisonam-refinement-1/);
    expect(live.note).toContain('0 · NEUTRALIZE');

    const neutralized = lockedInModel(
      {
        reason: 'bound',
        adapter: {
          id: 'kisonam-refinement-1', scale: 1, selectedScale: 0,
          binding: { approvedScales: [0.5, 1] },
        },
      },
      { phase: 'sealed' },
    );
    expect(neutralized).toMatchObject({
      locked: true,
      headline: 'LORA NEUTRALIZED — BASE ONLY',
    });
    expect(neutralized.note).toMatch(/NOT LOADED/);
  });

  it('never claims lock-in on bare base', () => {
    expect(lockedInModel({ reason: 'no-adapters', adapter: null }, null)).toBeNull();
    expect(lockedInModel({ reason: 'artifact-not-loaded', adapter: { id: 'x' } }, { phase: 'verification' })).toBeNull();
  });
});
