/**
 * safe-url — pure, so it is verified by calling it with real inputs (RULE 0;
 * no mock exists anywhere in this path).
 *
 * This guard decides whether text authored by a stranger's web page becomes an
 * `href` inside the desk's own origin. The witness clicking it has every reason
 * to trust it — the desk put it there — so the interesting cases are the ones
 * that LOOK like links and are not.
 */
import { describe, test, expect } from 'vitest';
import { safeHttpUrl, hostOf } from '../../frontend/app/RelinkShell/safe-url.js';

// Built from char codes: a literal control byte in a source file is exactly
// what the guard exists to reject, and it must not be smuggled into the repo.
const ch = (code) => String.fromCharCode(code);

describe('safeHttpUrl — the allowlist holds', () => {
  test('ordinary research links pass and come back normalized', () => {
    expect(safeHttpUrl('https://arxiv.org/abs/2401.00001')).toBe('https://arxiv.org/abs/2401.00001');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('  https://example.com/a?b=c#d  ')).toBe('https://example.com/a?b=c#d');
  });

  test('javascript: never becomes an href, in any spelling', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBe(null);
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBe(null);
    expect(safeHttpUrl('  javascript:alert(1)')).toBe(null);
    // A scheme split by a control character — the classic blocklist bypass.
    expect(safeHttpUrl(`java${ch(9)}script:alert(1)`)).toBe(null);
    expect(safeHttpUrl(`java${ch(10)}script:alert(1)`)).toBe(null);
    expect(safeHttpUrl(`java${ch(0)}script:alert(1)`)).toBe(null);
  });

  test('other executable or exfiltrating schemes are refused', () => {
    for (const url of [
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'blob:https://example.com/uuid',
      'about:blank',
      'chrome://settings',
    ]) {
      expect(safeHttpUrl(url), url).toBe(null);
    }
  });

  test('a credentialed url is refused — that shape is phishing, not research', () => {
    expect(safeHttpUrl('https://trusted.example.com@evil.tld/path')).toBe(null);
    expect(safeHttpUrl('https://user:pw@evil.tld')).toBe(null);
  });

  test('a control character anywhere refuses the whole url', () => {
    expect(safeHttpUrl(`https://example.com/${ch(0)}`)).toBe(null);
    expect(safeHttpUrl(`https://example.com/${ch(31)}x`)).toBe(null);
    expect(safeHttpUrl(`https://example.com/${ch(127)}`)).toBe(null);
  });

  test('non-strings and unparseable text are not links', () => {
    for (const bad of [null, undefined, 42, {}, [], '', '   ', 'not a url', '/relative/path', '//protocol-relative']) {
      expect(safeHttpUrl(bad), String(bad)).toBe(null);
    }
  });

  test('a punycode/unicode host is allowed — it is a real site, judged by its host', () => {
    // Refusing these would drop legitimate non-ASCII sources; the witness sees
    // the host and decides. The guard's job is the SCHEME, not taste.
    expect(safeHttpUrl('https://xn--80ak6aa92e.com/')).toBe('https://xn--80ak6aa92e.com/');
  });
});

describe('hostOf — what the witness scans', () => {
  test('gives the hostname for a real link', () => {
    expect(hostOf('https://arxiv.org/abs/1')).toBe('arxiv.org');
    expect(hostOf('https://sub.domain.co.uk:8443/x')).toBe('sub.domain.co.uk');
  });

  test('never throws on junk', () => {
    expect(hostOf('nonsense')).toBe('');
    expect(hostOf('')).toBe('');
  });
});
