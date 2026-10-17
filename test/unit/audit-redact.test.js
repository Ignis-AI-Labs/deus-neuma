/**
 * Audit redaction — pure, so it is verified by calling it with real inputs and
 * checking real outputs (RULE 0: a pure function qualifies because there is no
 * mock anywhere in the path).
 *
 * The property under test is two-sided and both sides matter equally:
 *   - no credential survives into a durable record, and
 *   - everything else DOES survive, or the ledger cannot answer […] and the whole point of capturing args is lost.
 */
import { describe, test, expect } from 'vitest';
import {
  redactArgs, isSecretKey, looksSecret, VALUE_HEAD_CHARS, RECORD_MAX_CHARS,
} from '../../backend/services/audit-redact.js';

describe('isSecretKey — matched per word, not per substring', () => {
  test('credential slots are caught across camel, snake, and kebab case', () => {
    for (const key of [
      'password', 'apiKey', 'api_key', 'API-KEY', 'sessionToken', 'authToken',
      'privateKey', 'mnemonic', 'seedPhrase', 'dek', 'authorization', 'pw',
      'clientSecret', 'refresh_token', 'signature',
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  test('innocent keys that merely CONTAIN a secret word are kept', () => {
    for (const key of [
      'monkey', 'keyword', 'path', 'content', 'filePath', 'destination',
      'query', 'url', 'limit', 'sessionId', 'passengers',
    ]) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });
});

describe('looksSecret — a credential in an innocent slot', () => {
  test('known credential shapes are recognised wherever they sit', () => {
    expect(looksSecret('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).toBe(true);
    expect(looksSecret('Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(looksSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')).toBe(true);
    expect(looksSecret('AKIAIOSFODNN7EXAMPLE')).toBe(true);
    expect(looksSecret('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(looksSecret('sk-abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true);
    expect(looksSecret(`0x${'a1b2c3d4'.repeat(8)}`)).toBe(true); // 32-byte hex = a private key
  });

  test('ordinary prose, paths, and short hex are not secrets', () => {
    expect(looksSecret('/workspace/repos/neuma/backend/server.js')).toBe(false);
    expect(looksSecret('the quick brown fox')).toBe(false);
    expect(looksSecret('0xdeadbeef')).toBe(false);        // a short hex value is not a key
    expect(looksSecret('0x40566d43261849777aca96b26f4ec8c850e5dcae')).toBe(false); // a wallet ADDRESS is public
  });
});

describe('redactArgs — the ledger line', () => {
  test('the forensic question survives: a write records its path', () => {
    const record = redactArgs({ path: '/tmp/lane/dna.md', content: 'I am Cael.' });
    expect(record).toContain('/tmp/lane/dna.md');
    expect(record).toContain('I am Cael.');
  });

  test('a secret in a named slot never lands', () => {
    const record = redactArgs({
      endpoint: 'https://api.example/v1',
      apiKey: 'sk-livekey-do-not-write-this-down',
      password: 'hunter2',
    });
    expect(record).toContain('https://api.example/v1');
    expect(record).not.toContain('sk-livekey-do-not-write-this-down');
    expect(record).not.toContain('hunter2');
    expect(record).toContain('[redacted]');
  });

  test('a secret smuggled through an innocent slot never lands either', () => {
    const record = redactArgs({ body: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123' });
    expect(record).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(record).toContain('[redacted]');
  });

  test('secrets nested inside objects and arrays are reached', () => {
    const record = redactArgs({
      headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz0123' },
      files: [{ path: '/a.txt' }, { path: '/b.txt', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }],
    });
    expect(record).toContain('/a.txt');
    expect(record).toContain('/b.txt');
    expect(record).not.toContain('abcdefghijklmnopqrstuvwxyz0123');
    expect(record).not.toContain('ghp_');
  });

  test('a long value is cut to a head with an honest length — never silently', () => {
    const record = redactArgs({ content: 'x'.repeat(VALUE_HEAD_CHARS + 500) });
    expect(record).toContain(`[+500 chars]`);
    expect(record.length).toBeLessThanOrEqual(RECORD_MAX_CHARS + 32);
  });

  test('an enormous argument object costs a bounded amount', () => {
    const wide = {};
    for (let i = 0; i < 200; i++) wide[`field${i}`] = 'y'.repeat(300);
    const record = redactArgs(wide);
    expect(record.length).toBeLessThanOrEqual(RECORD_MAX_CHARS + 32);
    expect(record).toContain('[record capped]');
  });

  test('deep nesting is capped rather than followed forever', () => {
    let deep = { leaf: 'bottom' };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(redactArgs(deep)).toContain('[depth capped]');
  });

  test('a long array is headed and counted', () => {
    const record = redactArgs({ paths: Array.from({ length: 50 }, (_, i) => `/f${i}`) });
    expect(record).toContain('/f0');
    expect(record).toContain('[+30 more]');
  });

  test('nothing to record returns null — the entry stays lean', () => {
    expect(redactArgs(null)).toBe(null);
    expect(redactArgs(undefined)).toBe(null);
    expect(redactArgs({})).toBe(null);
    expect(redactArgs('a string')).toBe(null);
  });

  test('a cycle is broken by the depth cap, not by giving up on the entry', () => {
    const cyclic = { path: '/a' };
    cyclic.self = cyclic;
    const record = redactArgs(cyclic);
    expect(record).toContain('/a');          // the forensic fact survives
    expect(record).toContain('[depth capped]'); // the loop is cut, not followed
  });

  test('an argument that cannot be read at all still owes the ledger a line', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'path', {
      enumerable: true,
      get() { throw new Error('this property refuses to be read'); },
    });
    expect(redactArgs(hostile)).toBe('[unserializable args]');
  });
});
