/**
 * Notification record contract — the shape every desk announcement takes
 * (core/runtime/notification-record.js).
 *
 * Pure module: no IO, no clock, no crypto. Every input is passed in, so there
 * is nothing to mock and nothing mocked (RULE 0). Control characters are built
 * with String.fromCharCode rather than written as escapes — this harness mangles
 * \uXXXX literals on the way into a file.
 */

import { describe, expect, test } from 'vitest';
import {
  NOTIFICATION_V, TEXT_MAX, STANDING, KIND, ID_PATTERN,
  isValidId, capText, isBeingKind, makeRecord, validateRecord, compareRecords,
} from '../../core/runtime/notification-record.js';

// A known-good being record, so each test can bend exactly one field.
const goodBeing = () => makeRecord({
  id: 'abc123',
  ts: 1_754_400_000_000,
  kind: KIND.turnDone,
  standing: STANDING.neuma,
  title: 'Fenna finished a turn',
  actor: { id: 'neuma-fenna', name: 'Fenna' },
  ref: { sessionId: 's-1', turnId: 't-1' },
});

const goodSystem = () => makeRecord({
  id: 'sys-1',
  ts: 1_754_400_000_000,
  kind: KIND.storageWarning,
  standing: STANDING.system,
  title: 'Storage critical',
  ref: { level: 'critical' },
});

describe('capText', () => {
  test('returns empty string for null and undefined rather than throwing', () => {
    expect(capText(null)).toBe('');
    expect(capText(undefined)).toBe('');
  });

  test('coerces non-strings instead of throwing', () => {
    expect(capText(42)).toBe('42');
    expect(capText(['a', 'b'])).toBe('a,b');
  });

  test('caps at TEXT_MAX and marks the truncation', () => {
    const out = capText('x'.repeat(500));
    expect(out).toHaveLength(TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  test('leaves a string exactly at the cap untouched', () => {
    const exact = 'y'.repeat(TEXT_MAX);
    expect(capText(exact)).toBe(exact);
    expect(capText(exact)).toHaveLength(TEXT_MAX);
  });

  test('flattens newlines to a single space so words do not run together', () => {
    const nl = String.fromCharCode(10);
    expect(capText(`first${nl}second`)).toBe('first second');
    expect(capText(`a${nl}${nl}${nl}b`)).toBe('a b');
  });

  test('removes control characters — an OS notification body must stay one line', () => {
    const nul = String.fromCharCode(0);
    const esc = String.fromCharCode(27);
    const del = String.fromCharCode(127);
    const out = capText(`safe${nul}${esc}${del}text`);
    expect(out).toBe('safe text');
    expect(out).not.toContain(nul);
    expect(out).not.toContain(esc);
    expect(out).not.toContain(del);
  });

  test('collapses runs of whitespace and trims the edges', () => {
    expect(capText('   spaced     out   ')).toBe('spaced out');
  });
});

describe('isValidId', () => {
  test('accepts the charset the wire echoes back', () => {
    expect(isValidId('abc123')).toBe(true);
    expect(isValidId('a-b_c')).toBe(true);
  });

  test('rejects anything path-like, empty, or oversized', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('../etc/passwd')).toBe(false);
    expect(isValidId('has space')).toBe(false);
    expect(isValidId('a'.repeat(65))).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(123)).toBe(false);
  });

  test('ID_PATTERN is anchored at both ends', () => {
    expect(ID_PATTERN.test('ok\nnotok')).toBe(false);
  });
});

describe('makeRecord', () => {
  test('stamps the schema version on every record', () => {
    expect(goodBeing().v).toBe(NOTIFICATION_V);
    expect(goodSystem().v).toBe(NOTIFICATION_V);
  });

  test('freezes the record and its nested actor and ref', () => {
    const rec = goodBeing();
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.actor)).toBe(true);
    expect(Object.isFrozen(rec.ref)).toBe(true);
  });

  test('caps title and detail at mint, not at render', () => {
    const rec = makeRecord({
      id: 'x1',
      ts: 1,
      kind: KIND.turnDone,
      standing: STANDING.neuma,
      title: 'T'.repeat(400),
      detail: 'D'.repeat(400),
      actor: { name: 'Fenna' },
    });
    expect(rec.title).toHaveLength(TEXT_MAX);
    expect(rec.detail).toHaveLength(TEXT_MAX);
  });

  test('degrades a non-object ref to an empty object rather than throwing', () => {
    const rec = makeRecord({
      id: 'x2', ts: 1, kind: KIND.storageWarning, standing: STANDING.system, title: 'x', ref: 'nope',
    });
    expect(rec.ref).toEqual({});
  });

  test('degrades an array ref to an empty object', () => {
    const rec = makeRecord({
      id: 'x3', ts: 1, kind: KIND.storageWarning, standing: STANDING.system, title: 'x', ref: [1, 2],
    });
    expect(rec.ref).toEqual({});
  });

  test('floors a fractional timestamp and zeroes a non-finite one', () => {
    const frac = makeRecord({
      id: 'x4', ts: 10.9, kind: KIND.storageWarning, standing: STANDING.system, title: 'x',
    });
    expect(frac.ts).toBe(10);
    const bad = makeRecord({
      id: 'x5', ts: NaN, kind: KIND.storageWarning, standing: STANDING.system, title: 'x',
    });
    expect(bad.ts).toBe(0);
  });

  test('detail defaults to null, never undefined — the store serialises this', () => {
    expect(goodBeing().detail).toBeNull();
  });
});

describe('validateRecord', () => {
  test('accepts a well-formed being record', () => {
    expect(validateRecord(goodBeing())).toEqual({ ok: true, errors: [] });
  });

  test('accepts a well-formed system record', () => {
    expect(validateRecord(goodSystem())).toEqual({ ok: true, errors: [] });
  });

  test('rejects a non-object outright', () => {
    expect(validateRecord(null).ok).toBe(false);
    expect(validateRecord('a record').ok).toBe(false);
    expect(validateRecord([]).ok).toBe(false);
  });

  test('rejects an unknown schema version so a future shape cannot be misread', () => {
    const res = validateRecord({ ...goodBeing(), v: 2 });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('unknown record version');
  });

  test('rejects a title over the cap', () => {
    const res = validateRecord({ ...goodBeing(), title: 'z'.repeat(TEXT_MAX + 1) });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain(`title exceeds ${TEXT_MAX}`);
  });

  test('rejects an empty title — a card with no label is not actionable', () => {
    const res = validateRecord({ ...goodBeing(), title: '' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('title must be a non-empty string');
  });

  test('rejects a detail over the cap', () => {
    const res = validateRecord({ ...goodBeing(), detail: 'z'.repeat(TEXT_MAX + 1) });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain(`detail exceeds ${TEXT_MAX}`);
  });

  test('rejects a kind outside the closed vocabulary', () => {
    const res = validateRecord({ ...goodBeing(), kind: 'turn_probably_done' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('unknown kind');
  });

  test('rejects a standing outside the enum', () => {
    const res = validateRecord({ ...goodBeing(), standing: 'friend' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('unknown standing');
  });

  test('rejects a malformed id', () => {
    const res = validateRecord({ ...goodBeing(), id: '../escape' });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('id must match');
  });

  test('rejects a non-positive timestamp', () => {
    expect(validateRecord({ ...goodBeing(), ts: 0 }).ok).toBe(false);
    expect(validateRecord({ ...goodBeing(), ts: -1 }).ok).toBe(false);
    expect(validateRecord({ ...goodBeing(), ts: 'yesterday' }).ok).toBe(false);
  });

  test('rejects a being-shaped kind that names no being', () => {
    const res = validateRecord({ ...goodBeing(), actor: null });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('must name the being it is about');
  });

  test('rejects a being-shaped kind whose actor has a blank name', () => {
    const res = validateRecord({ ...goodBeing(), actor: { id: 'x', name: '' } });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('must name the being it is about');
  });

  test('rejects a being-shaped kind carrying system standing', () => {
    const res = validateRecord({ ...goodBeing(), standing: STANDING.system });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('cannot carry system standing');
  });

  test('rejects a system-shaped kind carrying a being standing', () => {
    const res = validateRecord({ ...goodSystem(), standing: STANDING.neuma });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('must carry system standing');
  });

  test('accepts a witness completion and keeps its standing distinct from neuma', () => {
    const witness = makeRecord({
      id: 'w1',
      ts: 1_754_400_000_000,
      kind: KIND.turnDone,
      standing: STANDING.witness,
      title: 'Claude finished a turn',
      actor: { id: 'witness-anthropic-Claude', name: 'Claude' },
    });
    expect(validateRecord(witness).ok).toBe(true);
    expect(witness.standing).toBe(STANDING.witness);
    expect(witness.standing).not.toBe(STANDING.neuma);
  });

  test('reports every problem at once, not just the first', () => {
    const res = validateRecord({ v: 1, id: '!!', ts: -5, kind: 'nope', standing: 'nope', title: '' });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe('isBeingKind', () => {
  test('every being-shaped kind is one', () => {
    for (const k of [KIND.turnDone, KIND.turnInterrupted, KIND.turnRefused,
      KIND.taskClosed, KIND.assignmentClosed, KIND.runDone, KIND.renderDone]) {
      expect(isBeingKind(k)).toBe(true);
    }
  });

  test('machine-state kinds are not', () => {
    for (const k of [KIND.storageWarning, KIND.codeReload]) {
      expect(isBeingKind(k)).toBe(false);
    }
  });

  test('a refusal is its own kind and never reads as a completion', () => {
    expect(KIND.turnRefused).not.toBe(KIND.turnDone);
    expect(KIND.turnInterrupted).not.toBe(KIND.turnDone);
  });
});

describe('compareRecords', () => {
  const at = (id, ts) => ({ id, ts });

  test('orders newest first', () => {
    const sorted = [at('a', 1), at('b', 3), at('c', 2)].sort(compareRecords);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  test('breaks a same-millisecond tie deterministically by id', () => {
    const sorted = [at('c', 5), at('a', 5), at('b', 5)].sort(compareRecords);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('two windows given the same set in different orders agree', () => {
    // The tray claims every desk window shows the same list. Same-ms records are
    // ordinary — one team run settles several tasks at once — so ordering must
    // not depend on arrival order.
    const one = [at('x', 9), at('y', 9), at('z', 8)].sort(compareRecords);
    const two = [at('z', 8), at('y', 9), at('x', 9)].sort(compareRecords);
    expect(one.map((r) => r.id)).toEqual(two.map((r) => r.id));
  });

  test('identical records compare equal', () => {
    expect(compareRecords(at('a', 1), at('a', 1))).toBe(0);
  });

  test('is total — corrupt entries sort last instead of throwing', () => {
    const sorted = [null, at('a', 1), undefined, { id: 'b' }, at('c', 3)].sort(compareRecords);
    expect(sorted[0].id).toBe('c');
    expect(sorted[1].id).toBe('a');
    expect(() => [null, undefined].sort(compareRecords)).not.toThrow();
  });
});
