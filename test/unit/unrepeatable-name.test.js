// THE UNREPEATABLE NAME (MANY SKIES §6.1) — the mathematical law, proven on
// the real forge. Real modules end to end; no mocks (RULE 0).
import { describe, it, expect } from 'vitest';
import { nameFromHex, uniqueGenesisName } from '../../core/kotodama/names.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { forgeBirthIdentity } from '../../core/birth/identity-forge.js';
import { composeMomentContext, paletteFromSeed } from '../../core/birth/moment-context.js';
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

describe('uniqueGenesisName — deterministic extension', () => {
  const hash = 'ab'.repeat(32);

  it('gives the 3-syllable name when free, extends past each collision', () => {
    const base = uniqueGenesisName(hash);
    expect(base).toBe(nameFromHex(hash, 3));
    const extended = uniqueGenesisName(hash, [base]);
    expect(extended).toBe(nameFromHex(hash, 4));
    const twice = uniqueGenesisName(hash, [base, extended]);
    expect(twice).toBe(nameFromHex(hash, 5));
    // The extension only ever reveals more of the SAME seed.
    expect(extended.toLowerCase().startsWith(base.toLowerCase())).toBe(true);
  });

  it('collision check folds case', () => {
    const base = uniqueGenesisName(hash);
    expect(uniqueGenesisName(hash, [base.toUpperCase()])).toBe(nameFromHex(hash, 4));
  });

  it('two distinct hashes always separate (injectivity, spot-proven)', () => {
    const a = 'ab'.repeat(32);
    const b = 'ab'.repeat(31) + 'ac';
    expect(nameFromHex(a, 32)).not.toBe(nameFromHex(b, 32));
  });
});

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
  it('extends the genesis name past a name already borne — chosen name untouched', () => {
    const first = forgeBirthIdentity({
      chosenName: 'Proof',
      witnessWallet: SEAL_INPUT.witnessWallet,
      soulPublicKey: SEAL_INPUT.soulPublicKey,
      birthCycle: 1,
      birthMoment: MOMENT,
      substrate: { model: 'test' },
    });
    // Re-forge identical inputs with the first genesis name already borne:
    // same hash, DIFFERENT (extended) genesis name, same chosen name.
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
    expect(second.trueName.genesisName.toLowerCase()
      .startsWith(first.trueName.genesisName.toLowerCase())).toBe(true);
    expect(second.trueName.chosenName).toBe('Proof');
  });

  it('two births with fresh momentSeeds can never share a hash — even at the same instant', () => {
    const a = forgeBirthIdentity({ ...SEAL_INPUT, lean: undefined, momentSeed: 'aa'.repeat(32) });
    const b = forgeBirthIdentity({ ...SEAL_INPUT, lean: undefined, momentSeed: 'ab'.repeat(32) });
    expect(a.seal.genesisHash).not.toBe(b.seal.genesisHash);
    expect(a.trueName.genesisName).not.toBe(b.trueName.genesisName); // 3 syllables of distinct hashes here
  });
});

describe('the sky of the moment at naming', () => {
  it('renders the real coordinates and the seed\'s own syllables', () => {
    const seed = 'ef'.repeat(32);
    const block = composeMomentContext(MOMENT, seed);
    expect(block).toContain('THE SKY OF YOUR MOMENT');
    expect(block).toContain('Maya count');
    expect(block).toContain('modern 1987'); // Dreamspell honestly labeled
    expect(block).toContain("YOUR MOMENT'S SYLLABLES");
    const palette = paletteFromSeed(seed);
    expect(palette).toHaveLength(8);
    for (const fragment of palette) expect(block).toContain(fragment);
    // Soft law, never a gate:
    expect(block).toContain('the choice, always, is yours alone');
  });

  it('no moment → no block; no seed → the pada sound still rides, the seed fragments do not', () => {
    expect(composeMomentContext(null, 'ef'.repeat(32))).toBe('');
    // The Nāmakaraṇa sound derives from the MOMENT alone, so it survives a
    // missing seed; only the entropy fragments need the seed.
    const seedless = composeMomentContext(MOMENT, undefined);
    expect(seedless).toContain('THE SKY OF YOUR MOMENT');
    expect(seedless).toContain('Nāmakaraṇa');
    expect(seedless).not.toContain('minted a seed');
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

describe('the pada sound in the naming context', () => {
  it('the ancient layer rides beside the seed syllables', () => {
    const block = composeMomentContext(MOMENT, 'ef'.repeat(32));
    expect(block).toContain('Nāmakaraṇa');
    expect(block).toMatch(/pada whose syllable is "/);
    expect(block).toContain('the choice, always, is yours alone');
  });
});
