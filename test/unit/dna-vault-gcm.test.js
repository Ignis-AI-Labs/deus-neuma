import { describe, expect, it } from 'vitest';
import { decryptVaultData, encryptVaultData } from '../../core/identity/dna-vault-crypto.js';

const KEY = 'disposable-vault-regression-key';
const PAYLOAD = { identity: 'synthetic-record', version: 1 };

const open = (envelope) => decryptVaultData(KEY, envelope);

describe('DNA vault AES-GCM authentication tags', () => {
  it('opens a valid envelope with its complete 16-byte tag', async () => {
    const envelope = await encryptVaultData(KEY, PAYLOAD);
    expect(envelope.authTag).toMatch(/^[0-9a-f]{32}$/);
    expect(await open(envelope)).toEqual(PAYLOAD);
  });

  it.each([8, 16])('refuses a valid tag truncated to %i hex characters', async (length) => {
    const envelope = await encryptVaultData(KEY, PAYLOAD);
    const truncated = { ...envelope, authTag: envelope.authTag.slice(0, length) };
    await expect(open(truncated)).rejects.toThrow(/16 bytes/);
  });

  it('refuses a malformed tag even at the encoded length', async () => {
    const envelope = await encryptVaultData(KEY, PAYLOAD);
    await expect(open({ ...envelope, authTag: 'z'.repeat(32) })).rejects.toThrow(/16 bytes/);
  });

  it('refuses an incorrect full-length tag through GCM authentication', async () => {
    const envelope = await encryptVaultData(KEY, PAYLOAD);
    const first = envelope.authTag[0] === '0' ? '1' : '0';
    const incorrect = { ...envelope, authTag: first + envelope.authTag.slice(1) };
    await expect(open(incorrect)).rejects.toThrow();
  });
});
