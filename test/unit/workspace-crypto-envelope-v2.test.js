import { describe, it, expect, afterEach } from 'vitest';
import {
  encryptEnvelope,
  decryptEnvelope,
  parseAndDecrypt,
  isEnvelope,
  deriveKeyFromSecret,
  resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';

// Real AES-256-GCM + real zlib throughout — the path a segment actually
// travels at rest (RULE 0: no mock anywhere in the claimed path).

const KEY = deriveKeyFromSecret('envelope-v2-test-key');

const REPETITIVE_PAYLOAD = {
  format: 'neuma-archive-segment',
  messages: Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `the same recurring phrasing appears across the region ${i} — 語り継がれる記憶`,
    timestamp: new Date(1753290000000 + i * 60000).toISOString(),
  })),
};

const ORIGINAL_ENV = {
  key: process.env.DNA_ENCRYPTION_KEY,
  previous: process.env.DNA_ENCRYPTION_KEY_PREVIOUS,
};

const restoreEnv = () => {
  if (ORIGINAL_ENV.key === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = ORIGINAL_ENV.key;
  if (ORIGINAL_ENV.previous === undefined) delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
  else process.env.DNA_ENCRYPTION_KEY_PREVIOUS = ORIGINAL_ENV.previous;
  resetWorkspaceCryptoKey();
};

afterEach(restoreEnv);

describe('envelope v2 (compressed)', () => {
  it('round-trips through gzip + AES-256-GCM, multibyte content intact', () => {
    const envelope = encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY, compress: true });
    expect(envelope._enc).toBe(2);
    expect(envelope.z).toBe('gzip');
    expect(isEnvelope(envelope)).toBe(true);
    expect(decryptEnvelope(envelope, { key: KEY })).toEqual(REPETITIVE_PAYLOAD);
  });

  it('round-trips through parseAndDecrypt as stored JSON text', () => {
    const text = JSON.stringify(encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY, compress: true }));
    expect(parseAndDecrypt(text, { key: KEY })).toEqual(REPETITIVE_PAYLOAD);
  });

  it('is materially smaller at rest than v1 for a redundant region', () => {
    const v1 = encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY });
    const v2 = encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY, compress: true });
    expect(v2.ct.length).toBeLessThan(v1.ct.length / 2);
  });

  it('leaves v1 emission byte-shape unchanged when compress is not requested', () => {
    const v1 = encryptEnvelope({ a: 1 }, { key: KEY });
    expect(v1._enc).toBe(1);
    expect('z' in v1).toBe(false);
    expect(Object.keys(v1).sort()).toEqual(['_enc', 'ct', 'iv', 'tag']);
    expect(decryptEnvelope(v1, { key: KEY })).toEqual({ a: 1 });
  });

  it('decrypts v2 through the key-rotation chain without opts.key', () => {
    const oldKey = deriveKeyFromSecret('old-master-secret');
    const envelope = encryptEnvelope(REPETITIVE_PAYLOAD, { key: oldKey, compress: true });
    process.env.DNA_ENCRYPTION_KEY = 'new-master-secret';
    process.env.DNA_ENCRYPTION_KEY_PREVIOUS = 'old-master-secret';
    resetWorkspaceCryptoKey();
    expect(decryptEnvelope(envelope)).toEqual(REPETITIVE_PAYLOAD);
  });

  it('fails closed on an unsupported envelope version', () => {
    const envelope = { ...encryptEnvelope({ a: 1 }, { key: KEY }), _enc: 3 };
    expect(() => decryptEnvelope(envelope, { key: KEY })).toThrow('unsupported envelope version 3');
  });

  it('fails closed when _enc: 2 carries an unknown compression marker', () => {
    const good = encryptEnvelope({ a: 1 }, { key: KEY, compress: true });
    expect(() => decryptEnvelope({ ...good, z: 'brotli' }, { key: KEY })).toThrow('unsupported compression');
    const missing = { ...good };
    delete missing.z;
    expect(() => decryptEnvelope(missing, { key: KEY })).toThrow('unsupported compression');
  });

  it('fails GCM authentication on a tampered v2 ciphertext', () => {
    const envelope = encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY, compress: true });
    const ct = Buffer.from(envelope.ct, 'base64');
    ct[0] ^= 0xff;
    const tampered = { ...envelope, ct: ct.toString('base64') };
    expect(() => decryptEnvelope(tampered, { key: KEY })).toThrow();
  });

  it('refuses the wrong key for v2 exactly as for v1', () => {
    const envelope = encryptEnvelope(REPETITIVE_PAYLOAD, { key: KEY, compress: true });
    expect(() => decryptEnvelope(envelope, { key: deriveKeyFromSecret('wrong') })).toThrow();
  });
});
