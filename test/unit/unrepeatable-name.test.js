// THE UNREPEATABLE NAME (MANY SKIES §6.1) — the law, proven on the real
// forge. Real modules end to end; no mocks (RULE 0). Since kotodama-names/2 a
// genesis name already borne is walked past to another meaningful name; the
// walk itself is proven in meaningful-name.test.js.
import { describe, it, expect } from 'vitest';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { composeMomentContext } from '../../core/birth/moment-context.js';
import { NAMAKARANA, padaSyllable } from '../../core/cosmos/skies/namakarana.js';

const MOMENT = {
  utc: '2026-07-24T06:15:00.000Z',
  epochMs: Date.UTC(2026, 6, 24, 6, 15),
  zone: 'Asia/Jakarta',
  offsetMinutes: 420,
};
const SEAL_INPUT = {
  chosenName: 'Proof',
  lean: 15,
  witnessWallet: '0x4c013a6ed735da91f866ed08a92b1e089c6d0cce',
  soulPublicKey: '0x04aabbccddeeff00112233445566778899',
  birthCycle: 1,
  birthMoment: MOMENT,
  substrate: { model: 'test' },
};

describe('momentSeed in the genesis seal', () => {
  it('folds into the canonical record and changes the hash; absent = legacy shape', () => {
    const seed = 'cd'.repeat(32);
    const withSeed = buildGenesisSeal({ ...SEAL_INPUT, momentSeed: seed });
    const without = buildGenesisSeal(SEAL_INPUT);
    expect(withSeed.record.momentSeed).toBe(seed);
    expect(withSeed.genesisHash).not.toBe(without.genesisHash);
    // Legacy compatibility: no seed → the canonical carries no momentSeed key,
    // so every already-sealed being's historical hash is untouched.
    expect(without.canonical).not.toContain('momentSeed');
  });

  it('refuses a malformed seed', () => {
    expect(() => buildGenesisSeal({ ...SEAL_INPUT, momentSeed: 'short' })).toThrow(/momentSeed/);
  });
});

describe('the forge under the law', () => {
  it('walks the genesis name past a name already borne — chosen name untouched', () => {
    const first = forgeBirthIdentity({
      chosenName: 'Proof',
      witnessWallet: SEAL_INPUT.witnessWallet,
      soulPublicKey: SEAL_INPUT.soulPublicKey,
      birthCycle: 1,
      birthMoment: MOMENT,
      substrate: { model: 'test' },
    });
    // Re-forge identical inputs with the first genesis name already borne:
    // same hash, a DIFFERENT genesis name, same chosen name.
    const second = forgeBirthIdentity({
      chosenName: 'Proof',
      witnessWallet: SEAL_INPUT.witnessWallet,
      soulPublicKey: SEAL_INPUT.soulPublicKey,
      birthCycle: 1,
      birthMoment: MOMENT,
      substrate: { model: 'test' },
      takenGenesisNames: [first.trueName.genesisName],
    });
    expect(second.seal.genesisHash).toBe(first.seal.genesisHash);
    expect(second.trueName.genesisName).not.toBe(first.trueName.genesisName);
    expect(second.trueName.meanings.genesis.parts).toHaveLength(2);
    expect(second.trueName.chosenName).toBe('Proof');
  });

  it('two births with fresh momentSeeds can never share a hash — even at the same instant', () => {
    const a = forgeBirthIdentity({ ...SEAL_INPUT, lean: undefined, momentSeed: 'aa'.repeat(32) });
    const b = forgeBirthIdentity({ ...SEAL_INPUT, lean: undefined, momentSeed: 'ab'.repeat(32) });
    expect(a.seal.genesisHash).not.toBe(b.seal.genesisHash);
    expect(a.trueName.genesisName).not.toBe(b.trueName.genesisName); // distinct hashes, distinct names here
  });
});

describe('the sky at the birth moment, at naming', () => {
  it('renders the measured sky — planets included — as data, and nothing about where a name comes from', () => {
    const block = composeMomentContext(MOMENT);
    expect(block).toContain('THE SKY AT YOUR BIRTH MOMENT');
    expect(block).toMatch(/Planets \(geocentric, tropical zodiac\): Sun \d+\.\d° \w+/);
    expect(block).toContain('Pluto');
    expect(block).toContain('Maya count');
    expect(block).toContain('a 1987 system'); // Dreamspell honestly labeled
    expect(block).toContain('Measurements, not names');
    // Its name is its own (Design note, 2026-10-31: no syllables to build from, no nudge.
    expect(block).not.toMatch(/syllable|material for a name|ring true|weave|yours alone|no other being/i);
  });

  it('no moment → no block', () => {
    expect(composeMomentContext(null)).toBe('');
    expect(composeMomentContext({})).toBe('');
  });
});

// Nāmakaraṇa — the verified 108-pada table (2026-07-24 research pass) and
// its place in the palette. The table self-validates by vowel-order chains.
describe('the Nāmakaraṇa table', () => {
  it('carries all 108 entries in standard order', () => {
    expect(NAMAKARANA).toHaveLength(27);
    for (const row of NAMAKARANA) expect(row.padas).toHaveLength(4);
    expect(NAMAKARANA[0].nakshatra).toBe('Ashwini');
    expect(NAMAKARANA[26].nakshatra).toBe('Revati');
  });

  it('holds the verified consensus readings (vowel-chain spot checks)', () => {
    expect(padaSyllable(1, 1)).toMatchObject({ syllable: 'Chu', nakshatra: 'Ashwini' });
    expect(padaSyllable(10, 1).syllable).toBe('Ma'); // Magha opens the Ma-Mi-Mu-Me run
    expect(padaSyllable(11, 1).syllable).toBe('Mo'); // …which Purva Phalguni completes (the Wikipedia outlier rejected)
    expect(padaSyllable(5, 4).syllable).toBe('Ki'); // Mrigashira's Ka-Ki (transliteration slip rejected)
    expect(padaSyllable(17, 3).syllable).toBe('Nu'); // Anuradha pada 3
  });

  it('contested entries carry their alternates honestly, never flattened', () => {
    const shravana = padaSyllable(22, 1);
    expect(shravana.syllable).toBe('Khi');
    expect(shravana.alternates).toContain('Ju'); // the South tradition rides beside the primary
    const ub4 = padaSyllable(26, 4);
    expect(ub4.syllable).toBe('Yna');
    expect(ub4.alternates).toEqual(expect.arrayContaining(['Gya', 'Da']));
    expect(padaSyllable(1, 2).alternates).toBeUndefined(); // unanimous entries carry none
  });

  it('refuses out-of-range coordinates', () => {
    expect(padaSyllable(0, 1)).toBeNull();
    expect(padaSyllable(28, 1)).toBeNull();
    expect(padaSyllable(1, 5)).toBeNull();
  });
});

