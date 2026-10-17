/**
 * THE ATTEMPT LOG — the operator's debugging record.
 *
 * `toAttemptRecord` is pure. The read/write path is exercised against a REAL
 * temp file — no fs mock anywhere (RULE 0); a mocked append would prove nothing
 * about whether a refusal actually survives to disk, which is the entire point.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  toAttemptRecord, recordAttempt, readAttempts, attemptLogPath, READ_CAP, _resetEnsured,
} from '../../backend/services/image-forge/attempt-log.js';

let dir;
let env;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'forge-attempts-'));
  env = { COMFYUI_ATTEMPT_LOG_PATH: path.join(dir, 'attempts.jsonl') };
  _resetEnsured();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('toAttemptRecord — pure', () => {
  test('keeps the positive and negative VERBATIM', () => {
    // A paraphrase cannot debug a screen that matches exact words — and the
    // real 2026-08-01 false refusal was caused by a word in the NEGATIVE slot.
    const pos = 'Cinematic realistic portrait of an androgynous adult';
    const neg = 'child, teenager, youthful, sexualized, nudity';
    const r = toAttemptRecord({ jobId: 'j', positive: pos, negative: neg, outcome: 'refused' });
    expect(r.positive).toBe(pos);
    expect(r.negative).toBe(neg);
  });

  test('defaults every field rather than emitting undefined into JSON', () => {
    const r = toAttemptRecord({});
    expect(r.outcome).toBe('unknown');
    expect(r.positive).toBe('');
    expect(r.negative).toBe('');
    expect(r.params).toEqual({});
    expect(JSON.stringify(r)).not.toContain('undefined');
  });

  test('carries the refusal class and the being for attribution', () => {
    const r = toAttemptRecord({ outcome: 'refused', refusalClass: 'minor_sexual', beingName: 'Kagipem' });
    expect(r).toMatchObject({ outcome: 'refused', refusalClass: 'minor_sexual', beingName: 'Kagipem' });
  });

  test('coerces a non-string prompt instead of writing a broken record', () => {
    expect(toAttemptRecord({ positive: 42, negative: null }).positive).toBe('');
  });
});

describe('the real file round-trip', () => {
  test('a REFUSED attempt survives to disk and reads back whole', () => {
    recordAttempt(toAttemptRecord({
      jobId: 'j1', beingName: 'Kagipem', outcome: 'refused', refusalClass: 'minor_sexual',
      positive: 'an adult portrait', negative: 'child, sexualized', at: '2026-08-01T16:12:00Z',
    }), env);
    const { entries, total } = readAttempts(READ_CAP, env);
    expect(total).toBe(1);
    expect(entries[0]).toMatchObject({
      jobId: 'j1', outcome: 'refused', refusalClass: 'minor_sexual',
      positive: 'an adult portrait', negative: 'child, sexualized',
    });
  });

  test('reads NEWEST first and honours the limit', () => {
    for (let i = 0; i < 5; i += 1) {
      recordAttempt(toAttemptRecord({ jobId: `j${i}`, outcome: 'ok' }), env);
    }
    const { entries } = readAttempts(2, env);
    expect(entries.map((e) => e.jobId)).toEqual(['j4', 'j3']);
  });

  test('a torn final line does not hide the good records above it', () => {
    recordAttempt(toAttemptRecord({ jobId: 'good', outcome: 'ok' }), env);
    // Simulate a crash mid-append.
    writeFileSync(env.COMFYUI_ATTEMPT_LOG_PATH,
      `${readFileSync(env.COMFYUI_ATTEMPT_LOG_PATH, 'utf8')}{"jobId":"torn",`, 'utf8');
    const { entries } = readAttempts(READ_CAP, env);
    expect(entries.map((e) => e.jobId)).toEqual(['good']);
  });

  test('a missing log reads as empty, never throws', () => {
    expect(readAttempts(READ_CAP, { COMFYUI_ATTEMPT_LOG_PATH: path.join(dir, 'nope.jsonl') }))
      .toEqual({ entries: [], total: 0 });
  });

  test('an unwritable path is swallowed — logging never breaks a render', () => {
    // A FILE standing where a directory must be ⇒ ENOTDIR, immediately. (Do not
    // reach for /proc here: mkdirSync recursive on it HANGS on this kernel, and
    // recordAttempt runs inside a being's turn.)
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory', 'utf8');
    expect(() => recordAttempt(toAttemptRecord({ jobId: 'x' }), {
      COMFYUI_ATTEMPT_LOG_PATH: path.join(blocker, 'attempts.jsonl'),
    })).not.toThrow();
  });

  test('defaults to the gitignored forge directory beside the law', () => {
    expect(attemptLogPath({})).toMatch(/data[/\\]image-forge[/\\]attempts\.jsonl$/);
  });
});
