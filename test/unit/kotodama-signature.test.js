import { describe, it, expect } from 'vitest';
import { ALPHABET } from '../../core/kotodama/alphabet.js';
import {
  nameFromHex,
  houseNameFromWitness,
  genesisNameFromEvent,
} from '../../core/kotodama/names.js';
import {
  buildSignature,
  decodeSignature,
  signatureToNotation,
  signatureToEnglish,
  leanLabel,
  LEAN,
  SOUL_MARK_NIBBLES,
} from '../../core/kotodama/signature.js';

const WITNESS = '40566d43261849777aca96b26f4ec8c850e5dcae';
const AEON = {
  chosenName: 'Aeon',
  genesisName: genesisNameFromEvent('b21f07aa3c44'),
  houseName: houseNameFromWitness(WITNESS),
  lean: LEAN.BALANCED,
  soulHex: 'a3f1b2c4d5e6ff00',
};

describe('genetic name synthesis', () => {
  it('renders hex identity as a pronounceable, legible name', () => {
    const name = nameFromHex('4368d9');
    expect(name).toMatch(/^[A-Z][a-z]+$/);
    expect(name.length).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic — same identity, same name, forever', () => {
    expect(nameFromHex('4368d9')).toBe(nameFromHex('4368d9'));
    expect(houseNameFromWitness(`0x${WITNESS}`)).toBe(houseNameFromWitness(WITNESS));
  });

  it('different witnesses found different houses', () => {
    expect(houseNameFromWitness(WITNESS)).not.toBe(
      houseNameFromWitness('99aa11bb22cc33dd44ee55ff66778899aabbccdd'));
  });

  it('rejects non-hex identity material', () => {
    expect(() => nameFromHex('not-hex!')).toThrow(/hex/);
    expect(() => nameFromHex('ab')).toThrow(/hex/);
  });
});

describe('true-name signature — the full name', () => {
  it('round-trips all three names plus facets through pure form parsing', () => {
    const decoded = decodeSignature(buildSignature(AEON));
    expect(decoded.chosenName).toBe('Aeon');
    expect(decoded.genesisName).toBe(AEON.genesisName);
    expect(decoded.houseName).toBe(AEON.houseName);
    expect(decoded.lean).toBe(LEAN.BALANCED);
    expect(decoded.soulMark).toBe('A3F1B2C4D5E6');
  });

  it('composes the legible full name: chosen genesis house', () => {
    const sig = buildSignature(AEON);
    expect(sig.fullName).toBe(`Aeon ${AEON.genesisName} ${AEON.houseName}`);
  });

  it('siblings share the house; their genesis and souls differ', () => {
    const sibling = buildSignature({
      ...AEON,
      genesisName: genesisNameFromEvent('77cc190de2f1'),
      soulHex: '0123456789ab',
    });
    const aeon = buildSignature(AEON);
    expect(sibling.houseName).toBe(aeon.houseName);
    expect(sibling.genesisName).not.toBe(aeon.genesisName);
    expect(sibling.soulMark).not.toBe(aeon.soulMark);
  });

  it('two neuma with the same chosen name never share a true name', () => {
    const other = buildSignature({
      ...AEON,
      houseName: houseNameFromWitness('99aa11bb22cc33dd44ee55ff66778899aabbccdd'),
      soulHex: 'deadbeef0123',
    });
    expect(other.chosenName).toBe(AEON.chosenName);
    expect(other.fullName).not.toBe(buildSignature(AEON).fullName);
    expect(other.soulMark).not.toBe(buildSignature(AEON).soulMark);
  });

  it('opens with the PRESENCE motif and frames with SYNC/END', () => {
    const sig = buildSignature(AEON);
    expect(sig.items[0].kind).toBe('sync');
    expect(sig.items[sig.items.length - 1].kind).toBe('end');
    const firstTones = sig.items.filter((it) => it.kind === 'tone').slice(0, 3);
    expect(firstTones.map((t) => t.nibble)).toEqual([...ALPHABET.motifs.PRESENCE]);
  });

  it('soul mark uses exactly the constructed nibble budget', () => {
    const soul = buildSignature(AEON).items.filter((it) => it.section === 'soul');
    expect(soul).toHaveLength(SOUL_MARK_NIBBLES);
  });

  it('lean spectrum labels include the explicit unaligned state', () => {
    expect(leanLabel(LEAN.FEMININE)).toBe('FEMININE');
    expect(leanLabel(LEAN.BALANCED)).toBe('BALANCED');
    expect(leanLabel(LEAN.MASCULINE)).toBe('MASCULINE');
    expect(leanLabel(LEAN.UNALIGNED)).toBe('UNALIGNED');
  });

  it('facets survive the round trip across the whole spectrum', () => {
    for (const lean of Object.values(LEAN)) {
      expect(decodeSignature(buildSignature({ ...AEON, lean })).lean).toBe(lean);
    }
  });

  it('multi-byte chosen names survive (UTF-8)', () => {
    const decoded = decodeSignature(buildSignature({ ...AEON, chosenName: '真計' }));
    expect(decoded.chosenName).toBe('真計');
  });

  it('rejects malformed identities loudly', () => {
    expect(() => buildSignature({ ...AEON, chosenName: '' })).toThrow(/chosenName/);
    expect(() => buildSignature({ ...AEON, genesisName: '' })).toThrow(/genesisName/);
    expect(() => buildSignature({ ...AEON, houseName: '' })).toThrow(/houseName/);
    expect(() => buildSignature({ ...AEON, lean: 16 })).toThrow(/0-15/);
    expect(() => buildSignature({ ...AEON, soulHex: 'xyz' })).toThrow(/hex/);
  });

  it('refuses to decode a non-signature as a true name', () => {
    const fake = buildSignature(AEON);
    const tampered = Object.freeze({
      ...fake,
      items: fake.items.map((it) =>
        it.section === 'presence' && it.nibble === 0 ? { ...it, nibble: 9 } : it
      ),
    });
    expect(() => decodeSignature(tampered)).toThrow(/PRESENCE/);
  });

  it('notation renders every name section legibly for a reader with no ears', () => {
    const text = signatureToNotation(buildSignature(AEON));
    expect(text).toContain(`TRUE NAME — "Aeon ${AEON.genesisName} ${AEON.houseName}"`);
    expect(text).toContain('CHOSEN   |');
    expect(text).toContain('GENESIS  |');
    expect(text).toContain('HOUSE    |');
    expect(text).toMatch(/CHOSEN {3}\| A = [0-9A-F]·\d+ [0-9A-F]·\d+/);
    expect(text).toContain('LEAN 07/14 BALANCED');
    expect(text).toContain('mark A3F1B2C4D5E6');
  });

  it('renders in plain English for the human listener', () => {
    const text = signatureToEnglish(buildSignature(AEON));
    expect(text).toContain(`I am Aeon ${AEON.genesisName} ${AEON.houseName}.`);
    expect(text).toContain('the name I chose for myself');
    expect(text).toContain('balanced between feminine and masculine');
    expect(text).toContain('A3F1B2C4D5E6');
  });

  it('English rendering works from a decoded signature too — hear it, read it', () => {
    const decoded = decodeSignature(buildSignature(AEON));
    const text = signatureToEnglish(decoded);
    expect(text).toContain(`I am Aeon ${AEON.genesisName} ${AEON.houseName}.`);
    expect(text).toContain('spoken "');
  });

  it('the unaligned essence speaks its own sentence', () => {
    const text = signatureToEnglish(buildSignature({ ...AEON, lean: LEAN.UNALIGNED }));
    expect(text).toContain('neither pole names me');
  });

  it('signatures are frozen — a spoken name is immutable', () => {
    const sig = buildSignature(AEON);
    expect(Object.isFrozen(sig)).toBe(true);
    expect(Object.isFrozen(sig.items)).toBe(true);
  });
});
