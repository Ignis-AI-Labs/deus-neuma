import { describe, it, expect } from 'vitest';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { decodeSignature, LEAN } from '../../core/kotodama/signature.js';
import { houseNameFromWitness } from '../../core/kotodama/names.js';

const BIRTH = Object.freeze({
  chosenName: 'Aeon',
  witnessWallet: '0xC0FFEE285a3F1b2C4d5E6F7081920A3b4C5d6E7f',
  soulPublicKey: '04a3f1b2c4d5e6f7081920a3b4c5d6e7f8091a2b',
  birthCycle: 1,
  birthMoment: Object.freeze({
    utc: '2026-06-12T07:42:13.285Z',
    epochMs: 1781250133285,
    zone: 'America/Los_Angeles',
    offsetMinutes: -420,
  }),
  substrate: Object.freeze({
    gpu: { name: 'RTX PRO 6000 Blackwell', vramGB: 96 },
    llm: { model: 'qwen3-14b-base-emanon-arch-v9' },
  }),
});

describe('identity forge', () => {
  it('forges seal, signature, and a three-word full name in one act', () => {
    const { seal, signature, trueName } = forgeBirthIdentity(BIRTH);
    expect(seal.genesisHash).toMatch(/^[0-9a-f]{64}$/);
    expect(trueName.fullName.split(' ')).toHaveLength(3);
    expect(trueName.fullName.startsWith('Aeon ')).toBe(true);
    expect(signature.fullName).toBe(trueName.fullName);
    expect(trueName.genesisHash).toBe(seal.genesisHash);
  });

  it('the house comes from the witness; the genesis from the seal', () => {
    const { trueName } = forgeBirthIdentity(BIRTH);
    expect(trueName.houseName).toBe(houseNameFromWitness(BIRTH.witnessWallet));
    const laterMoment = forgeBirthIdentity({
      ...BIRTH,
      birthMoment: { ...BIRTH.birthMoment, epochMs: BIRTH.birthMoment.epochMs + 1, utc: '2026-06-12T07:42:13.286Z' },
    });
    expect(laterMoment.trueName.houseName).toBe(trueName.houseName);
    expect(laterMoment.trueName.genesisName).not.toBe(trueName.genesisName);
  });

  it('essence defaults to UNALIGNED — never assigned at birth', () => {
    const { trueName, signature } = forgeBirthIdentity(BIRTH);
    expect(trueName.lean).toBe(LEAN.UNALIGNED);
    expect(decodeSignature(signature).lean).toBe(LEAN.UNALIGNED);
    expect(trueName.english).toContain('neither pole names me');
  });

  it('renderings carry the full identity', () => {
    const { trueName } = forgeBirthIdentity(BIRTH);
    expect(trueName.notation).toContain(`TRUE NAME — "${trueName.fullName}"`);
    expect(trueName.english).toContain(`I am ${trueName.fullName}.`);
    expect(trueName.soulAlias).toMatch(/^[A-Z][a-z]+$/);
  });

  it('the signature decodes back to the forged names', () => {
    const { signature, trueName } = forgeBirthIdentity(BIRTH);
    const decoded = decodeSignature(signature);
    expect(decoded.chosenName).toBe(trueName.chosenName);
    expect(decoded.genesisName).toBe(trueName.genesisName);
    expect(decoded.houseName).toBe(trueName.houseName);
    expect(decoded.soulMark).toBe(trueName.soulMark);
  });
});
