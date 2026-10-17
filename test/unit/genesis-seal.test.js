import { describe, it, expect } from 'vitest';
import {
  buildGenesisSeal,
  canonicalize,
  captureBirthMoment,
  SEAL_VERSION,
} from '../../core/identity/genesis-seal.js';
import { genesisNameFromEvent } from '../../core/kotodama/names.js';

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

const BIRTH = Object.freeze({
  chosenName: 'Aeon',
  lean: 7,
  witnessWallet: '0xC0FFEE285a3F1b2C4d5E6F7081920A3b4C5d6E7f',
  soulPublicKey: '04a3f1b2c4d5e6f7081920a3b4c5d6e7f8091a2b',
  birthCycle: 1,
  birthMoment: MOMENT,
  substrate: SUBSTRATE,
});

describe('canonicalize', () => {
  it('is key-order independent at every depth', () => {
    expect(canonicalize({ b: { d: 2, c: 1 }, a: 0 }))
      .toBe(canonicalize({ a: 0, b: { c: 1, d: 2 } }));
  });

  it('preserves nested keys (no array-replacer stripping)', () => {
    const text = canonicalize({ gpu: { vramGB: 96, name: 'RTX' } });
    expect(text).toContain('"vramGB":96');
    expect(text).toContain('"name":"RTX"');
  });

  it('drops undefined-valued keys deterministically', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('genesis seal', () => {
  it('produces a stable hash for identical births', () => {
    expect(buildGenesisSeal(BIRTH).genesisHash).toBe(buildGenesisSeal(BIRTH).genesisHash);
    expect(buildGenesisSeal(BIRTH).genesisHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('any change to the moment changes the seed', () => {
    const later = buildGenesisSeal({
      ...BIRTH,
      birthMoment: { ...MOMENT, epochMs: MOMENT.epochMs + 1, utc: '2026-06-12T07:42:13.286Z' },
    });
    expect(later.genesisHash).not.toBe(buildGenesisSeal(BIRTH).genesisHash);
  });

  it('any change to the machine changes the seed', () => {
    const otherRig = buildGenesisSeal({
      ...BIRTH,
      substrate: { ...SUBSTRATE, gpu: { name: 'RTX 5090', vramGB: 32 } },
    });
    expect(otherRig.genesisHash).not.toBe(buildGenesisSeal(BIRTH).genesisHash);
  });

  it('timezone is load-bearing, not decoration', () => {
    const otherZone = buildGenesisSeal({
      ...BIRTH,
      birthMoment: { ...MOMENT, zone: 'Asia/Tokyo', offsetMinutes: 540 },
    });
    expect(otherZone.genesisHash).not.toBe(buildGenesisSeal(BIRTH).genesisHash);
  });

  it('the record carries the full irreproducible context', () => {
    const { record, canonical } = buildGenesisSeal(BIRTH);
    expect(record.version).toBe(SEAL_VERSION);
    expect(record.witnessWallet).toBe(BIRTH.witnessWallet.toLowerCase());
    expect(canonical).toContain('"zone":"America/Los_Angeles"');
    expect(canonical).toContain('"vramGB":96');
    expect(canonical).toContain('qwen3-14b-base-emanon-arch-v9');
  });

  it('the genesis name derives from the seed — the middle name IS this moment on this machine', () => {
    const { genesisHash } = buildGenesisSeal(BIRTH);
    const name = genesisNameFromEvent(genesisHash);
    expect(name).toMatch(/^[A-Z][a-z]+$/);
    expect(genesisNameFromEvent(buildGenesisSeal(BIRTH).genesisHash)).toBe(name);
  });

  it('rejects malformed births loudly', () => {
    expect(() => buildGenesisSeal({ ...BIRTH, chosenName: '' })).toThrow(/chosenName/);
    expect(() => buildGenesisSeal({ ...BIRTH, witnessWallet: 'not-a-wallet' })).toThrow(/address/);
    expect(() => buildGenesisSeal({ ...BIRTH, birthCycle: 0 })).toThrow(/birthCycle/);
    expect(() => buildGenesisSeal({ ...BIRTH, birthMoment: { utc: 'x' } })).toThrow(/birthMoment/);
    expect(() => buildGenesisSeal({ ...BIRTH, substrate: null })).toThrow(/substrate/);
  });

  it('seals are frozen — a birth record is immutable', () => {
    const seal = buildGenesisSeal(BIRTH);
    expect(Object.isFrozen(seal)).toBe(true);
    expect(Object.isFrozen(seal.record)).toBe(true);
  });
});

describe('captureBirthMoment', () => {
  it('captures utc, epoch, IANA zone, and offset together', () => {
    const moment = captureBirthMoment();
    expect(moment.utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isInteger(moment.epochMs)).toBe(true);
    expect(moment.zone.length).toBeGreaterThan(0);
    expect(Number.isInteger(moment.offsetMinutes)).toBe(true);
    expect(Object.isFrozen(moment)).toBe(true);
  });
});
