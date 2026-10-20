/**
 * THE VERDICT — the ledger taste is the residue of.
 *
 * `toReviewRecord` and the normalizers are pure. The append/read path runs
 * against a REAL temp file — no fs mock (RULE 0). The claim that matters here
 * is that two authors' judgments on the same image both survive to disk with
 * neither overwriting the other, and only a real file can prove that.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  toReviewRecord, recordReview, readReviews, reviewsFor, reviewLogPath,
  normalizeVerdict, normalizeMatches, VERDICTS, MATCHES, MAX_FIELD_CHARS, TAIL_BYTES, _resetEnsured,
} from '../../backend/services/image-forge/review-log.js';

let dir;
let env;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'forge-reviews-'));
  env = { COMFYUI_REVIEW_LOG_PATH: path.join(dir, 'reviews.jsonl') };
  _resetEnsured();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the normalizers — pure', () => {
  test('every declared verdict and match survives', () => {
    VERDICTS.forEach((v) => expect(normalizeVerdict(v)).toBe(v));
    MATCHES.forEach((m) => expect(normalizeMatches(m)).toBe(m));
  });

  test('case and surrounding space do not decide a verdict', () => {
    expect(normalizeVerdict('  KEEP ')).toBe('keep');
    expect(normalizeMatches('Partial')).toBe('partial');
  });

  test('an unknown word is null, never a silent pass-through', () => {
    // The tool and the route both refuse on null, so an invented verdict can
    // never reach the file and read as a real judgment later.
    expect(normalizeVerdict('maybe')).toBeNull();
    expect(normalizeVerdict('')).toBeNull();
    expect(normalizeVerdict(undefined)).toBeNull();
    expect(normalizeMatches('sort of')).toBeNull();
  });
});

describe('toReviewRecord — pure', () => {
  test('holds all three strata of a judgment', () => {
    const r = toReviewRecord({
      at: '2026-08-05T09:00:00.000Z',
      imageId: 'img-1', jobId: 'job-1', laneId: 'lane-1',
      by: 'being', author: 'Fenna',
      matches: 'partial',                      // adherence — objective
      missing: 'the third figure was not rendered',
      defects: 'left hand has six fingers',    // craft — intersubjective
      verdict: 'redo',
      note: 'the light is closer to what I meant than the last one', // preference
    });
    expect(r.matches).toBe('partial');
    expect(r.missing).toBe('the third figure was not rendered');
    expect(r.defects).toBe('left hand has six fingers');
    expect(r.verdict).toBe('redo');
    expect(r.note).toContain('closer to what I meant');
  });

  test('the prompt text is NOT copied — jobId is the link', () => {
    // One source of truth for what was asked: the attempt log. A copy here
    // could drift from the words that were actually sent.
    const r = toReviewRecord({ imageId: 'i', jobId: 'j', verdict: 'keep' });
    expect(r.jobId).toBe('j');
    expect(Object.keys(r)).not.toContain('positive');
    expect(Object.keys(r)).not.toContain('negative');
  });

  test('standing is one of exactly two, and defaults to the being', () => {
    expect(toReviewRecord({ by: 'operator' }).by).toBe('operator');
    expect(toReviewRecord({ by: 'being' }).by).toBe('being');
    // Anything else is a being — the operator standing is never granted by a
    // stray string reaching this function.
    expect(toReviewRecord({ by: 'admin' }).by).toBe('being');
    expect(toReviewRecord({}).by).toBe('being');
  });

  test('defaults every field rather than emitting undefined into JSON', () => {
    const r = toReviewRecord({});
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.verdict).toBeNull();
    expect(r.note).toBeNull();
  });

  test('a blank field and an absent one read the same', () => {
    expect(toReviewRecord({ note: '   ' }).note).toBeNull();
    expect(toReviewRecord({}).note).toBeNull();
  });

  test('free text is bounded', () => {
    const r = toReviewRecord({ note: 'x'.repeat(MAX_FIELD_CHARS + 500) });
    expect(r.note).toHaveLength(MAX_FIELD_CHARS);
  });
});

describe('the log — a real file', () => {
  test('a review written is a review read back', () => {
    recordReview(toReviewRecord({ imageId: 'img-1', verdict: 'keep', note: 'this one holds' }), env);
    const { entries, total } = readReviews(200, env);
    expect(total).toBe(1);
    expect(entries[0].note).toBe('this one holds');
  });

  test('BOTH standings survive on the same image, neither overwriting', () => {
    // The whole architecture in one assertion (ruling, 2026-08-05): his grade is
    // input the being weighs, not a correction applied over its judgment.
    recordReview(toReviewRecord({
      imageId: 'img-1', by: 'being', author: 'Fenna', matches: 'yes', verdict: 'keep',
      note: 'I think the composition works',
    }), env);
    recordReview(toReviewRecord({
      imageId: 'img-1', by: 'operator', author: '0xEli', verdict: 'redo',
      note: 'the crop cuts the subject badly',
    }), env);

    const rows = reviewsFor(readReviews(200, env).entries, 'img-1');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.by).sort()).toEqual(['being', 'operator']);
    // The being's own words are still there, unedited, after the operator graded.
    const being = rows.find((r) => r.by === 'being');
    expect(being.verdict).toBe('keep');
    expect(being.note).toBe('I think the composition works');
  });

  test('newest first, and other images do not bleed in', () => {
    recordReview(toReviewRecord({ imageId: 'img-1', verdict: 'keep', note: 'first' }), env);
    recordReview(toReviewRecord({ imageId: 'img-2', verdict: 'discard', note: 'other image' }), env);
    recordReview(toReviewRecord({ imageId: 'img-1', verdict: 'redo', note: 'second' }), env);
    const { entries } = readReviews(200, env);
    expect(entries[0].note).toBe('second');
    expect(reviewsFor(entries, 'img-1').map((r) => r.note)).toEqual(['second', 'first']);
  });

  test('a torn final line does not hide the good rows above it', () => {
    recordReview(toReviewRecord({ imageId: 'img-1', verdict: 'keep' }), env);
    const file = reviewLogPath(env);
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"imageId":"img-2","verd`);
    expect(readReviews(200, env).entries).toHaveLength(1);
  });

  test('no log yet is an empty ledger, not an error', () => {
    expect(readReviews(200, { COMFYUI_REVIEW_LOG_PATH: path.join(dir, 'nothing.jsonl') }))
      .toEqual({ entries: [], total: 0 });
  });

  test('a write failure never throws into a being\'s turn — and SAYS SO', () => {
    // A file where a directory should be ⇒ ENOTDIR, instantly.
    // Raised in review: returning undefined either way let both callers report
    // "recorded" over a refused append. The turn still survives; the boolean is
    // how the reviewer gets told the truth.
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    _resetEnsured();
    let landed;
    expect(() => {
      landed = recordReview(
        toReviewRecord({ imageId: 'i', verdict: 'keep' }),
        { COMFYUI_REVIEW_LOG_PATH: path.join(blocker, 'reviews.jsonl') },
      );
    }).not.toThrow();
    expect(landed).toBe(false);
  });

  test('reviewsFor scopes by LANE when the caller knows it', () => {
    // Raised in review: the route proves the IMAGE belongs to the lane, not
    // that every row carrying its id does. The lane is already in hand.
    const rows = [
      { imageId: 'img-1', laneId: 'mine', by: 'being', verdict: 'keep' },
      { imageId: 'img-1', laneId: 'theirs', by: 'being', verdict: 'discard' },
    ];
    expect(reviewsFor(rows, 'img-1', 'mine')).toHaveLength(1);
    expect(reviewsFor(rows, 'img-1', 'mine')[0].verdict).toBe('keep');
    // Omitting the lane keeps the old behaviour for callers that have none.
    expect(reviewsFor(rows, 'img-1')).toHaveLength(2);
  });

  test('a successful write says so', () => {
    expect(recordReview(toReviewRecord({ imageId: 'i', verdict: 'keep' }), env)).toBe(true);
  });

  test('the read is bounded by BYTES, so an old ledger costs a turn nothing', () => {
    // The residue rides the prompt EVERY TURN, so a whole-file read would grow
    // the cost of every turn for the life of the machine. Only the tail window
    // is pulled off the disk — and a window landing mid-record must never yield
    // half a JSON object as a review.
    const fat = 'x'.repeat(1000);
    for (let i = 0; i < 400; i += 1) {
      recordReview(toReviewRecord({ imageId: `img-${i}`, verdict: 'keep', note: fat }), env);
    }
    expect(statSync(reviewLogPath(env)).size).toBeGreaterThan(TAIL_BYTES);
    const { entries } = readReviews(200, env);
    expect(entries.length).toBeGreaterThan(0);
    // The newest row is present and whole; nothing torn came back.
    expect(entries[0].imageId).toBe('img-399');
    entries.forEach((e) => expect(typeof e.imageId).toBe('string'));
  });
});
