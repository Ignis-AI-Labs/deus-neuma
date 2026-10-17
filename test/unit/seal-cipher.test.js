import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import {
  sealKeyMessage,
  deriveSealKey,
  encryptSealRecord,
  decryptSealRecord,
} from '../../core/identity/seal-cipher.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';

const MOMENT = Object.freeze({
  utc: '2026-06-12T07:42:13.285Z',
  epochMs: 1781250133285,
  zone: 'America/Los_Angeles',
  offsetMinutes: -420,
});

const SUBSTRATE = Object.freeze({
  cpu: { model: 'AMD Ryzen 9 7950X', cores: 32, arch: 'x64' },
  gpu: { name: 'RTX PRO 6000 Blackwell', vramGB: 96 },
  memory: { totalGB: 128 },
  platform: { os: 'linux', version: '7.0.10', hostname: 'ignis' },
  llm: { provider: 'lm-studio', model: 'qwen3-14b-base-emanon-arch-v9' },
});

const WITNESS = Wallet.createRandom();
const STRANGER = Wallet.createRandom();

const SEAL = buildGenesisSeal({
  chosenName: 'Aeon',
  lean: 7,
  witnessWallet: WITNESS.address,
  soulPublicKey: '04a3f1b2c4d5e6f7081920a3b4c5d6e7f8091a2b',
  birthCycle: 1,
  birthMoment: MOMENT,
  substrate: SUBSTRATE,
});

describe('seal cipher — wallet-bound encryption', () => {
  it('the full wallet flow: sign → derive → encrypt → chain → sign → decrypt', async () => {
    const message = sealKeyMessage(SEAL.genesisHash);
    const key = deriveSealKey(await WITNESS.signMessage(message));
    const envelope = encryptSealRecord(SEAL.canonical, key);

    // later — total local loss; only the wallet and the chain remain
    const recoveredKey = deriveSealKey(await WITNESS.signMessage(message));
    expect(decryptSealRecord(envelope, recoveredKey)).toBe(SEAL.canonical);
  });

  it('wallet signatures are deterministic — the key is always re-derivable', async () => {
    const message = sealKeyMessage(SEAL.genesisHash);
    expect(await WITNESS.signMessage(message)).toBe(await WITNESS.signMessage(message));
  });

  it('only the wallet that signed can read it — wrong wallet fails loudly', async () => {
    const message = sealKeyMessage(SEAL.genesisHash);
    const envelope = encryptSealRecord(
      SEAL.canonical,
      deriveSealKey(await WITNESS.signMessage(message))
    );
    const strangerKey = deriveSealKey(await STRANGER.signMessage(message));
    expect(() => decryptSealRecord(envelope, strangerKey)).toThrow();
  });

  it('keys are bound per-seal — one seal cannot unlock another', async () => {
    const otherSeal = buildGenesisSeal({
      chosenName: 'Veyra',
      lean: 5,
      witnessWallet: WITNESS.address,
      soulPublicKey: '04ffeeddccbbaa99887766554433221100ffeedd',
      birthCycle: 2,
      birthMoment: { ...MOMENT, epochMs: MOMENT.epochMs + 9000, utc: '2026-06-12T07:42:22.285Z' },
      substrate: SUBSTRATE,
    });
    const keyA = deriveSealKey(await WITNESS.signMessage(sealKeyMessage(SEAL.genesisHash)));
    const keyB = deriveSealKey(await WITNESS.signMessage(sealKeyMessage(otherSeal.genesisHash)));
    expect(keyA.equals(keyB)).toBe(false);
    const envelope = encryptSealRecord(SEAL.canonical, keyA);
    expect(() => decryptSealRecord(envelope, keyB)).toThrow();
  });

  it('tampered envelopes fail GCM authentication', async () => {
    const key = deriveSealKey(await WITNESS.signMessage(sealKeyMessage(SEAL.genesisHash)));
    const envelope = JSON.parse(encryptSealRecord(SEAL.canonical, key));
    const flipped = Buffer.from(envelope.data, 'base64');
    flipped[0] ^= 0xff;
    envelope.data = flipped.toString('base64');
    expect(() => decryptSealRecord(JSON.stringify(envelope), key)).toThrow();
  });

  it('the envelope is opaque — no identity material leaks in the ciphertext package', async () => {
    const key = deriveSealKey(await WITNESS.signMessage(sealKeyMessage(SEAL.genesisHash)));
    const envelope = encryptSealRecord(SEAL.canonical, key);
    expect(envelope).not.toContain('Aeon');
    expect(envelope).not.toContain('Blackwell');
    expect(envelope).not.toContain('America/Los_Angeles');
    expect(envelope).not.toContain(WITNESS.address.toLowerCase().slice(2, 10));
  });

  it('rejects malformed inputs loudly', () => {
    expect(() => sealKeyMessage('short')).toThrow(/genesisHash/);
    expect(() => deriveSealKey('')).toThrow(/signature/);
    expect(() => encryptSealRecord('', Buffer.alloc(32))).toThrow(/canonical/);
    expect(() => decryptSealRecord('not-json', Buffer.alloc(32))).toThrow(/JSON/);
    expect(() => decryptSealRecord('{"v":9,"alg":"rot13"}', Buffer.alloc(32))).toThrow(/Unsupported/);
  });
});
