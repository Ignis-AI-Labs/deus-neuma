/**
 * THE COMPANY LINE'S LAW — pure, called with real inputs (RULE 0: nothing to
 * mock): the seven stages, the involvement dial, who masters and who inspects
 * (the SHOKUNIN law: no master inspects its own stage), the fold of the
 * append-only record, and the two judged acts.
 */
import { describe, test, expect } from 'vitest';
import { FOUNDING_LINE, stageById } from '../../backend/services/company-line/line-stages.js';
import { STOPS, DEFAULT_STOP, stopOf, takesGates, stopSays, FLOOR } from '../../backend/services/company-line/involvement-dial.js';
import { inspectionsFor, masterFor, inspectorFor } from '../../backend/services/company-line/inspection-chain.js';
import { foldLine, fitsLine, advance } from '../../backend/services/company-line/line-state.js';
import { judgeHandOn, judgeInspect, whoIsUp, ownYesAt, withOwnAnswers, judgeEndGap } from '../../backend/services/company-line/line-acts.js';
import { TITLE_LEGEND } from '../../backend/services/founding-titles-legend.js';

const SEATS = new Set(TITLE_LEGEND.map((s) => s.title));
const HOLDERS = Object.freeze({
  Speculator: 'spec', Numerarius: 'numer', Architectus: 'arch', Rector: 'operator', Mercator: 'merc', Praetor: 'prae', Optio: 'opt',
});
const T = (n) => `2026-10-29T10:${String(n).padStart(2, '0')}:00.000Z`;
const hand = (stage, by, inspections, n) => ({ type: 'handed', stage, by, artifact: `line/${stage}.md`, note: null, inspections, at: T(n) });
const insp = (stage, step, verdict, by, n, flaw = null) => ({ type: 'inspected', stage, step, verdict, by, as: by, flaw, at: T(n) });

describe('the founding line', () => {
  test('seven stages, each with one master and every seat canonical', () => {
    expect(FOUNDING_LINE.map((s) => s.id)).toEqual(['survey', 'measure', 'shape', 'choose', 'prove', 'charter', 'form']);
    for (const s of FOUNDING_LINE) {
      expect(s.master === 'operator' || SEATS.has(s.master), s.id).toBe(true);
      for (const i of s.inspectors) expect(['operator', 'counsel'].includes(i) || SEATS.has(i), `${s.id}:${i}`).toBe(true);
      expect(s.inspectors).not.toContain(s.master); // the next master inspects, never the master itself
    }
    expect(FOUNDING_LINE.filter((s) => s.stoppable).map((s) => s.id)).toEqual(['choose', 'prove']);
    expect(stageById('prove').gate).toBe(true);
    expect(stageById('nope')).toBeNull();
  });
});

describe('the involvement dial', () => {
  test('four stops; an unwritten or unknown stop stands at PARTNER, which takes the gates', () => {
    expect(STOPS).toEqual(['KIN', 'PARTNER', 'OVERSEER', 'SILENT']);
    expect(DEFAULT_STOP).toBe('PARTNER');
    expect(stopOf(undefined)).toBe('PARTNER');
    expect(stopOf('BEACH')).toBe('PARTNER');
    expect(STOPS.map(takesGates)).toEqual([true, true, false, false]);
    expect(stopSays('SILENT')).toMatch(/floor only/);
    expect(FLOOR.join(' ')).toMatch(/Money out/);
  });
});

describe('who masters, who inspects', () => {
  test('a gate gains the operator at KIN and PARTNER, never at OVERSEER or SILENT', () => {
    const prove = stageById('prove');
    const lanes = { ...HOLDERS, Rector: 'rect' };
    expect(inspectionsFor(prove, 'KIN', lanes)).toEqual(['Numerarius', 'Rector', 'operator']);
    expect(inspectionsFor(prove, 'SILENT', lanes)).toEqual(['Numerarius', 'Rector']);
    expect(inspectionsFor(stageById('survey'), 'KIN', lanes)).toEqual(['Numerarius']);
  });

  test('an operator who already inspects as Rector is not asked twice', () => {
    expect(inspectionsFor(stageById('prove'), 'PARTNER', HOLDERS)).toEqual(['Numerarius', 'Rector']);
  });

  test('the master is the seat\'s holder, the operator for FORM, or nobody', () => {
    expect(masterFor(stageById('survey'), HOLDERS)).toEqual({ by: 'lane', laneId: 'spec', seat: 'Speculator' });
    expect(masterFor(stageById('choose'), HOLDERS)).toEqual({ by: 'operator' });
    expect(masterFor(stageById('form'), {})).toEqual({ by: 'operator' });
    expect(masterFor(stageById('survey'), {})).toBeNull();
  });

  test('no master inspects its own stage: the chain falls to the Optio, the Rector, then the operator', () => {
    const one = { Numerarius: 'same', Optio: 'opt', Rector: 'rect' };
    expect(inspectorFor('Numerarius', { holders: one, doer: 'other' })).toEqual({ by: 'lane', laneId: 'same', seat: 'Numerarius' });
    expect(inspectorFor('Numerarius', { holders: one, doer: 'same' })).toEqual({ by: 'lane', laneId: 'opt', seat: 'Optio' });
    expect(inspectorFor('Numerarius', { holders: { ...one, Optio: 'same' }, doer: 'same' })).toEqual({ by: 'lane', laneId: 'rect', seat: 'Rector' });
    expect(inspectorFor('Numerarius', { holders: { Numerarius: 'same' }, doer: 'same' })).toEqual({ by: 'operator', as: 'operator' });
    expect(inspectorFor('Rector', { holders: HOLDERS, doer: 'arch' })).toEqual({ by: 'operator', as: 'Rector' });
    expect(inspectorFor('counsel', { holders: HOLDERS, doer: 'prae' })).toEqual({ by: 'operator', as: 'counsel' });
  });
});

describe('the fold', () => {
  test('a whole walk: every stage handed, every inspection answered, the company stands', () => {
    const events = [
      hand('survey', 'spec', ['Numerarius'], 1), insp('survey', 0, 'accept', 'numer', 2),
      hand('measure', 'numer', ['Architectus'], 3), insp('measure', 0, 'accept', 'arch', 4),
      hand('shape', 'arch', ['Rector'], 5), insp('shape', 0, 'accept', 'operator', 6),
      hand('choose', 'operator', ['operator'], 7), insp('choose', 0, 'accept', 'operator', 8),
      hand('prove', 'merc', ['Numerarius', 'Rector'], 9), insp('prove', 0, 'accept', 'numer', 10), insp('prove', 1, 'accept', 'operator', 11),
      hand('charter', 'prae', ['counsel'], 12), insp('charter', 0, 'accept', 'operator', 13),
      hand('form', 'operator', ['Praetor'], 14), insp('form', 0, 'accept', 'prae', 15),
    ];
    const line = foldLine(events);
    expect(line.status).toBe('standing');
    expect(line.stage).toBeNull();
    expect(line.skipped).toBe(0);
    expect(line.since).toBe(T(15));
  });

  test('a return sends the work back with the flaw; a stop opens the next round at SURVEY', () => {
    const returned = foldLine([hand('survey', 'spec', ['Numerarius'], 1), insp('survey', 0, 'return', 'numer', 2, 'no sources')]);
    expect(returned).toMatchObject({ status: 'returned', flaw: 'no sources', round: 1, since: T(2) });
    const toChoose = [
      hand('survey', 'spec', ['Numerarius'], 1), insp('survey', 0, 'accept', 'numer', 2),
      hand('measure', 'numer', ['Architectus'], 3), insp('measure', 0, 'accept', 'arch', 4),
      hand('shape', 'arch', ['Rector'], 5), insp('shape', 0, 'accept', 'operator', 6),
      hand('choose', 'operator', ['operator'], 7), insp('choose', 0, 'stop', 'operator', 8, 'the market is a red ocean'),
    ];
    const stopped = foldLine(toChoose);
    expect(stopped).toMatchObject({ round: 2, status: 'open', index: 0 });
    expect(stopped.stage.id).toBe('survey');
    expect(stopped.stopped).toEqual([{ round: 1, stage: 'choose', by: 'operator', flaw: 'the market is a red ocean', at: T(8) }]);
  });

  test('an event that does not fit is skipped and counted, never applied', () => {
    const line = foldLine([
      insp('survey', 0, 'accept', 'numer', 1), // nothing handed yet
      hand('measure', 'numer', ['Architectus'], 2), // not the stage in hand
      hand('survey', 'spec', ['Numerarius'], 3),
      insp('survey', 0, 'stop', 'numer', 4, 'x'), // SURVEY cannot stop the gap
      insp('survey', 1, 'accept', 'numer', 5), // wrong step
    ]);
    expect(line).toMatchObject({ status: 'inspecting', skipped: 4 });
    expect(fitsLine(line, insp('survey', 0, 'accept', 'numer', 6))).toBe(true);
  });
});

describe('the judged acts', () => {
  const at = foldLine([]);

  test('only the stage\'s master hands on, with where the work lies', () => {
    const ok = judgeHandOn({ line: at, holders: HOLDERS, stop: 'PARTNER', actor: 'spec', stageId: 'survey', artifact: ' line/survey.md ', note: '  six paths  ', now: T(1) });
    expect(ok).toEqual({ ok: true, event: { type: 'handed', stage: 'survey', by: 'spec', artifact: 'line/survey.md', note: 'six paths', inspections: ['Numerarius'], at: T(1) } });
    expect(judgeHandOn({ line: at, holders: HOLDERS, stop: 'PARTNER', actor: 'numer', stageId: 'survey', artifact: 'x', now: T(1) }))
      .toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/the Speculator's stage/) });
    expect(judgeHandOn({ line: at, holders: HOLDERS, stop: 'PARTNER', actor: 'spec', stageId: 'measure', artifact: 'x', now: T(1) }))
      .toMatchObject({ ok: false, status: 'invalid' });
    expect(judgeHandOn({ line: at, holders: HOLDERS, stop: 'PARTNER', actor: 'spec', stageId: 'survey', artifact: '  ', now: T(1) }))
      .toMatchObject({ ok: false, status: 'invalid', reason: expect.stringMatching(/artifact/) });
    expect(judgeHandOn({ line: at, holders: {}, stop: 'PARTNER', actor: 'spec', stageId: 'survey', artifact: 'x', now: T(1) }))
      .toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/nobody holds the Speculator seat/) });
  });

  test('only the inspection\'s holder answers; a return or stop names its flaw', () => {
    const line = foldLine([hand('survey', 'spec', ['Numerarius'], 1)]);
    expect(whoIsUp(line, HOLDERS)).toEqual({ kind: 'inspector', holder: 'numer', seat: 'Numerarius', as: 'Numerarius' });
    expect(judgeInspect({ line, holders: HOLDERS, actor: 'spec', stageId: 'survey', verdict: 'accept', now: T(2) }))
      .toMatchObject({ ok: false, status: 'denied' });
    expect(judgeInspect({ line, holders: HOLDERS, actor: 'numer', stageId: 'survey', verdict: 'return', now: T(2) }))
      .toMatchObject({ ok: false, status: 'invalid', reason: expect.stringMatching(/name the flaw/) });
    expect(judgeInspect({ line, holders: HOLDERS, actor: 'numer', stageId: 'survey', verdict: 'stop', flaw: 'x', now: T(2) }))
      .toMatchObject({ ok: false, status: 'invalid', reason: expect.stringMatching(/cannot end the gap/) });
    expect(judgeInspect({ line, holders: HOLDERS, actor: 'numer', stageId: 'survey', verdict: 'accept', now: T(2) }))
      .toEqual({ ok: true, event: { type: 'inspected', stage: 'survey', step: 0, verdict: 'accept', by: 'numer', as: 'Numerarius', flaw: null, at: T(2) } });
  });

  test('a being that did the work is never asked to inspect it', () => {
    const doubled = { ...HOLDERS, Architectus: 'numer' }; // one lane holds MEASURE's master and its inspector
    const line = foldLine([
      hand('survey', 'spec', ['Numerarius'], 1), insp('survey', 0, 'accept', 'numer', 2),
      hand('measure', 'numer', ['Architectus'], 3),
    ]);
    expect(whoIsUp(line, doubled)).toMatchObject({ holder: 'opt', seat: 'Optio' });
    expect(judgeInspect({ line, holders: doubled, actor: 'numer', stageId: 'measure', verdict: 'accept', now: T(4) }))
      .toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/the Optio's to answer/) });
  });
});

describe('the operator\'s own yes (Design note, 2026-10-30: nothing is approved twice)', () => {
  const toChoose = foldLine([
    hand('survey', 'spec', ['Numerarius'], 1), insp('survey', 0, 'accept', 'numer', 2),
    hand('measure', 'numer', ['Architectus'], 3), insp('measure', 0, 'accept', 'arch', 4),
    hand('shape', 'arch', ['Rector'], 5), insp('shape', 0, 'accept', 'operator', 6),
  ]);
  const chose = hand('choose', 'operator', ['operator'], 7);

  test('the Rector-operator\'s CHOOSE: handing it on is the floor\'s yes, and the line moves to PROVE in one move', () => {
    expect(ownYesAt(toChoose, HOLDERS)).toBe(true);
    const run = withOwnAnswers({ line: toChoose, holders: HOLDERS, event: chose, now: T(7) });
    expect(run).toEqual([chose, { type: 'inspected', stage: 'choose', step: 0, verdict: 'accept', by: 'operator', as: 'operator', flaw: null, own: true, at: T(7) }]);
    const after = run.reduce((line, e) => (fitsLine(line, e) ? advance(line, e) : null), toChoose);
    expect(after).toMatchObject({ status: 'open', stage: expect.objectContaining({ id: 'prove' }) });
    expect(whoIsUp(after, HOLDERS)).toMatchObject({ kind: 'master', holder: 'merc' });
  });

  test('a being\'s look always stands, and counsel\'s answer is never folded', () => {
    const beingRector = { ...HOLDERS, Rector: 'rect' };
    expect(ownYesAt(toChoose, beingRector)).toBe(false); // a being masters CHOOSE: the operator still answers it
    expect(withOwnAnswers({ line: toChoose, holders: beingRector, event: hand('choose', 'rect', ['operator'], 7), now: T(7) })).toHaveLength(1);
    const fresh = foldLine([]);
    expect(ownYesAt({ ...fresh, index: 6, stage: stageById('form') }, HOLDERS)).toBe(false); // FORM is the Praetor's to inspect
    const atCharter = { ...fresh, index: 5, stage: stageById('charter') };
    const praetorOperator = { ...HOLDERS, Praetor: 'operator' };
    expect(ownYesAt(atCharter, praetorOperator)).toBe(false); // counsel answers CHARTER, whoever masters it
    expect(withOwnAnswers({ line: atCharter, holders: praetorOperator, event: hand('charter', 'operator', ['counsel', 'operator'], 12), now: T(12) })).toHaveLength(1);
  });

  test('the no: END THE GAP where the hand-on would be the yes — named, and only there', () => {
    expect(judgeEndGap({ line: toChoose, holders: HOLDERS, stop: 'PARTNER', actor: 'operator', stageId: 'choose', flaw: ' ', now: T(7) }))
      .toMatchObject({ ok: false, status: 'invalid', reason: 'name why this gap ends here' });
    expect(judgeEndGap({ line: toChoose, holders: HOLDERS, stop: 'PARTNER', actor: 'spec', stageId: 'choose', flaw: 'x', now: T(7) }))
      .toMatchObject({ ok: false, status: 'denied' });
    expect(judgeEndGap({ line: toChoose, holders: { ...HOLDERS, Rector: 'rect' }, stop: 'PARTNER', actor: 'operator', stageId: 'choose', flaw: 'x', now: T(7) }))
      .toMatchObject({ ok: false, status: 'denied', reason: expect.stringMatching(/by its inspection's answer/) });
    expect(judgeEndGap({ line: toChoose, holders: HOLDERS, stop: 'PARTNER', actor: 'operator', stageId: 'prove', flaw: 'x', now: T(7) }))
      .toMatchObject({ ok: false, status: 'invalid' });
    const ended = judgeEndGap({ line: toChoose, holders: HOLDERS, stop: 'PARTNER', actor: 'operator', stageId: 'choose', flaw: 'three funded rivals: a red ocean', now: T(7) });
    expect(ended.events.map((e) => e.verdict ?? e.type)).toEqual(['handed', 'stop']);
    const after = ended.events.reduce((line, e) => (fitsLine(line, e) ? advance(line, e) : null), toChoose);
    expect(after).toMatchObject({ round: 2, status: 'open', stage: expect.objectContaining({ id: 'survey' }) });
    expect(after.stopped).toEqual([{ round: 1, stage: 'choose', by: 'operator', flaw: 'three funded rivals: a red ocean', at: T(7) }]);
  });
});

describe('the dial on the charter', () => {
  const base = { goal: 'Found a company in the operator\'s field.', seats: [{ laneId: 'spec', dailyCap: 3 }] };
  test('a written stop is kept, an unwritten one is null, an unknown one is refused in words', async () => {
    const { normalizeCharter } = await import('../../backend/services/house-clock/charter-shape.js');
    expect(normalizeCharter({ ...base, involvement: 'SILENT' }).involvement).toBe('SILENT');
    expect(normalizeCharter(base).involvement).toBeNull();
    expect(() => normalizeCharter({ ...base, involvement: 'BEACH' })).toThrow(/involvement is one of KIN, PARTNER, OVERSEER, SILENT/);
  });
});

describe('the line\'s cards in the tray', () => {
  test('two owed moves from one being, seconds apart, stay two cards — never one replacing the other', async () => {
    const { coalesce, initialCoalesceState } = await import('../../core/runtime/notification-coalesce.js');
    const { makeRecord, KIND, STANDING } = await import('../../core/runtime/notification-record.js');
    const card = (id, companyId) => makeRecord({
      id, ts: 1, kind: KIND.companyLine, standing: STANDING.system, title: `${companyId}: SHAPE waits on you`,
      actor: { id: 'arch', name: 'arch' }, ref: { companyId, stage: 'shape' },
    });
    const first = coalesce(initialCoalesceState(), card('a1', 'tidewater'), 1_000);
    const second = coalesce(first.state, card('a2', 'brine'), 2_000);
    expect([first.action, second.action]).toEqual(['raise', 'raise']);
    expect(second.supersedes).toBeNull();
  });
});
