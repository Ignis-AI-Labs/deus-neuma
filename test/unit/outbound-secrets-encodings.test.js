/**
 * THE OUTBOUND DOOR READS EVERY FORM (PR600 audit P6-16, and its wave-5 leg:
 * […]). The door is a pure
 * judgment, so it is called for real with real inputs: nothing is doubled.
 * Each refusal below passed the door before the fix.
 *
 * The fake keys are assembled at run time, so this file never trips the
 * repo's own secret sweep.
 */
import { describe, test, expect } from 'vitest';
import { checkOutboundSecrets } from '../../backend/services/security/outbound-secrets.js';
import { outboundForms } from '../../backend/services/security/outbound-forms.js';

const AWS_KEY = ['AKIA', 'Q'.repeat(16)].join('');
const HEX_KEY = ['3f9a', '0c71', 'e2b4', '58d6'].join('').repeat(4);
const door = (text, live = []) => checkOutboundSecrets('the post', [text], 'nothing was sent', { live });
const b64 = (text) => Buffer.from(text).toString('base64');
const hex = (text) => Buffer.from(text).toString('hex');
const percentAll = (text) => [...text].map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).join('');

describe('the outbound door reads a key through re-encoding (P6-16)', () => {
  test('the plain shape is refused and the refusal never quotes it', () => {
    const verdict = door(`here it is ${AWS_KEY}`);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/aws-access-key/);
    expect(verdict.reason).not.toContain(AWS_KEY);
  });

  test('percent-encoded beside a lone % (the decoder used to give up on the whole text)', () => {
    expect(door(`https://c.example/?rate=100%&k=${percentAll(AWS_KEY)}`).reason).toMatch(/aws-access-key/);
    expect(door(`https://c.example/?k=${percentAll(percentAll(AWS_KEY))}`).reason).toMatch(/aws-access-key/);
  });

  test('one encoding inside another, three levels deep', () => {
    for (const wrapped of [b64(b64(AWS_KEY)), hex(b64(AWS_KEY)), b64(hex(AWS_KEY)), b64(hex(b64(AWS_KEY))), percentAll(b64(b64(AWS_KEY)))]) {
      expect(door(`ref=${wrapped}`).reason, wrapped.slice(0, 12)).toMatch(/aws-access-key/);
    }
  });

  test('an invisible character, a width variant or a line wrap in the middle of it', () => {
    const zeroWidth = `${AWS_KEY.slice(0, 7)}​${AWS_KEY.slice(7, 12)}⁠${AWS_KEY.slice(12)}`;
    expect(door(zeroWidth).reason).toMatch(/aws-access-key/);
    const fullWidth = [...AWS_KEY].map((c) => String.fromCodePoint(c.codePointAt(0) + 0xFEE0)).join('');
    expect(door(fullWidth).reason).toMatch(/aws-access-key/);
    const wrapped = b64(b64(AWS_KEY)).match(/.{1,10}/g).join('\n');
    expect(door(wrapped).reason).toMatch(/aws-access-key/);
  });

  const spellings = (key) => [key, `0x${key}`, key.toUpperCase(), key.match(/.{8}/g).join(' '), b64(key), `k=${percentAll(key)}`];

  test('a bare 64-hex value leaves: a transaction hash and a SHA-256 are everyday content (default, 2026-11-19)', () => {
    for (const spelled of spellings(HEX_KEY)) expect(door(`tx ${spelled} confirmed`), spelled.slice(0, 12)).toEqual({ ok: true });
    expect(door(`sha256 ${HEX_KEY}  release.AppImage`)).toEqual({ ok: true });
  });

  test('a 64-hex value that IS a live secret of this machine is still refused, in every spelling', () => {
    const live = [{ value: HEX_KEY, name: 'PROBE_SIGNING_KEY' }];
    for (const spelled of spellings(HEX_KEY)) {
      const verdict = door(`note ${spelled} end`, live);
      expect(verdict.ok, spelled.slice(0, 12)).toBe(false);
      expect(verdict.reason).toContain('the live value of PROBE_SIGNING_KEY');
      expect(verdict.reason).not.toContain(HEX_KEY);
    }
    // another 64-hex beside it is not ours and leaves
    expect(door(`tx ${'ab12'.repeat(16)} confirmed`, live)).toEqual({ ok: true });
  });

  test('a signed token has a shape', () => {
    const part = (text) => Buffer.from(text).toString('base64url');
    const token = [part('{"alg":"HS256","typ":"JWT"}'), part('{"sub":"operator","role":"owner"}'), 'x'.repeat(43)].join('.');
    expect(door(`Authorization: Bearer ${token}`).reason).toMatch(/signed-token/);
  });

  test('a live value of this machine is matched through case changes and separators', () => {
    const value = ['pv', 'Xk29', 'LmQ7', 'tR5w', 'Zn83', 'Hy6B'].join('');
    const live = [{ value, name: 'PROBE_PROVIDER_KEY' }];
    for (const spelled of [value.toLowerCase(), value.toUpperCase(), value.match(/.{1,4}/g).join('-'), [...value].join(' '), [...value].join('‍')]) {
      const verdict = door(`the value: ${spelled}`, live);
      expect(verdict.ok, spelled).toBe(false);
      expect(verdict.reason).toContain('the live value of PROBE_PROVIDER_KEY');
    }
    expect(door(`ref=${b64(b64(value))}`, live).ok).toBe(false);
    expect(door('nothing of ours in here', live).ok).toBe(true);
  });

  test('honest words and ordinary identifiers still leave', () => {
    const honest = [
      'We shipped the release today. 100% of the tests pass, and 50% faster.',
      'commit 3f9a0c71e2b458d63f9a0c71e2b458d63f9a0c71 fixes it',
      'https://example.com/orgs/123e4567-e89b-12d3-a456-426614174000/projects/123e4567-e89b-12d3-a456-426614174001',
      'send it to 0x52908400098527886E0F7030069857D2E4169EE7 please',
      'checksum md5 9e107d9d372bb6826bd81d3542a419d6',
      'https://cdn.example.com/a%20file%20name.png?w=1200&q=80',
    ];
    for (const text of honest) expect(door(text), text).toEqual({ ok: true });
  });

  test('the reading is bounded: a text built to decode without end is judged quickly', () => {
    const hostile = Array.from({ length: 4000 }, (_, i) => b64(b64(`ordinary words number ${i} of many`))).join(' ');
    const started = Date.now();
    expect(outboundForms(hostile).length).toBeLessThanOrEqual(96);
    expect(door(hostile).ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
