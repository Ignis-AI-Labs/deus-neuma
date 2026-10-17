/**
 * THE SIZE LAW — the pure judge behind scripts/check-file-size.mjs.
 *
 * Every verdict the law can render, proven with real inputs and no mock
 * anywhere (RULE 0: a pure function is verified by calling it): the 500 cap,
 * the declared exception up to 1,000, the hard cap past it, the generated
 * exemption, and the shrink-only ratchet on baselined offenders.
 */
import { describe, expect, it } from 'vitest';
import {
  CAP, EXCEPTION_CAP, countLines, describeVerdict, isBound, isViolation, judgeFile,
} from '../../scripts/check-file-size.mjs';

const judge = (lines, header = '', baseline = {}) =>
  judgeFile({ file: 'backend/services/example.js', lines, header }, baseline);

describe('the cap', () => {
  it('a file at or under 500 lines is lawful', () => {
    expect(judge(CAP).verdict).toBe('ok');
    expect(judge(1).verdict).toBe('ok');
  });

  it('over 500 with no declaration is a violation', () => {
    const j = judge(CAP + 1);
    expect(j.verdict).toBe('over-cap');
    expect(isViolation(j.verdict)).toBe(true);
  });

  it('500–1,000 passes only with a SIZE EXCEPTION declared in the header', () => {
    const j = judge(750, '/** SIZE EXCEPTION: single wire-format table the protocol reads as one unit */');
    expect(j.verdict).toBe('declared-exception');
    expect(isViolation(j.verdict)).toBe(false);
  });

  it('over 1,000 is forbidden even with a declared exception', () => {
    const j = judge(EXCEPTION_CAP + 1, '/** SIZE EXCEPTION: none survives the hard cap */');
    expect(j.verdict).toBe('over-hard-cap');
    expect(isViolation(j.verdict)).toBe(true);
  });
});

describe('exemptions', () => {
  it('a generated artifact is outside the law regardless of size', () => {
    expect(judge(6000, '/** GENERATED FILE — do not edit by hand. */').verdict).toBe('exempt-generated');
  });

  it('the law binds source extensions and leaves archive and markdown alone', () => {
    expect(isBound('backend/services/portal-stream.js')).toBe(true);
    expect(isBound('frontend/app/RelinkShell/ChatApp.jsx')).toBe(true);
    expect(isBound('scripts/check-file-size.mjs')).toBe(true);
    expect(isBound('archive/old-ui/js/portal.js')).toBe(false);
    expect(isBound('docs/work/size-law.md')).toBe(false);
    expect(isBound('scripts/file-size-baseline.json')).toBe(false);
    expect(isBound('frontend/sounds-baked/sprite.json')).toBe(false);
  });
});

describe('the ratchet — shrink-only', () => {
  const baseline = { 'backend/services/example.js': 9092 };

  it('a frozen offender holding its size is tolerated, not endorsed', () => {
    expect(judge(9092, '', baseline).verdict).toBe('frozen');
  });

  it('growth past the frozen size is a violation', () => {
    const j = judge(9093, '', baseline);
    expect(j.verdict).toBe('grew-past-baseline');
    expect(j.frozen).toBe(9092);
    expect(isViolation(j.verdict)).toBe(true);
  });

  it('shrinking earns a ratchet-down, never a violation', () => {
    const j = judge(8500, '', baseline);
    expect(j.verdict).toBe('shrunk');
    expect(isViolation(j.verdict)).toBe(false);
  });

  it('a baselined file is judged by its freeze, not the cap — until cured', () => {
    expect(judge(600, '', baseline).verdict).toBe('shrunk');
  });
});

describe('line counting', () => {
  it('counts the way wc -l reads a POSIX file', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one\n')).toBe(1);
    expect(countLines('one\ntwo\n')).toBe(2);
    expect(countLines('one\ntwo')).toBe(2);
  });
});

describe('verdict speech', () => {
  it('names the frozen size when the ratchet is broken', () => {
    const text = describeVerdict(judge(9093, '', { 'backend/services/example.js': 9092 }));
    expect(text).toContain('9093');
    expect(text).toContain('9092');
    expect(text).toContain('shrink-only');
  });
});
