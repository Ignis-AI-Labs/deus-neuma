// Given names with meaning (kotodama-names/2, docs/work/naming-meaning.md):
// every name the generator can give is real words joined, reads as a name,
// and says what it means; the walk past names already borne never repeats.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { LANGUAGES, WORDS, PLACES } from '../../core/kotodama/name-lexicon.js';
import {
  joinForms, composeName, nameSpace, meaningfulName, describeGivenName, NAME_KINDS, NAME_SCHEME, OPENERS, CLOSERS,
} from '../../core/kotodama/meaningful-name.js';
import { houseNameOf, SOUND_NAME_SCHEME } from '../../core/kotodama/house-name.js';
import { houseNameFromWitness } from '../../core/kotodama/names.js';

const hash = (s) => createHash('sha256').update(s).digest('hex');
const WALLET = '0x4368aBcDeF0123456789aBcDeF0123456789C501';

describe('the lexicon', () => {
  const rows = [...WORDS, ...PLACES];

  it('every element is a plain a-z form from a named language, with its word and its meaning', () => {
    for (const r of rows) {
      expect(r.form).toMatch(/^[a-z]{2,8}$/);
      expect(['n', 'a', 'e', 'p']).toContain(r.kind);
      expect(LANGUAGES[r.lang]).toBeTruthy();
      expect(r.word.length).toBeGreaterThan(0);
      expect(r.gloss.length).toBeGreaterThan(0);
    }
  });

  it('no element or form appears twice in one list, and every noun says how it reads after "of"', () => {
    for (const list of [WORDS, PLACES]) {
      expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
      expect(new Set(list.map((r) => r.form)).size).toBe(list.length);
    }
    for (const w of WORDS) expect(w.kind === 'n' ? typeof w.of === 'string' : w.of === null).toBe(true);
  });

  it('nouns and adjectives open; nouns and endings close; places close houses', () => {
    expect(OPENERS.every((w) => w.kind === 'n' || w.kind === 'a')).toBe(true);
    expect(CLOSERS.genesis.every((w) => w.kind === 'n' || w.kind === 'e')).toBe(true);
    expect(CLOSERS.house.every((w) => w.kind === 'p')).toBe(true);
  });
});

describe('joining two elements', () => {
  it('a letter both sides share is said once', () => {
    expect(joinForms('sol', 'luna')).toBe('soluna');
    expect(joinForms('hedd', 'dor')).toBe('heddor');
  });

  it('a vowel meets any closer; easy clusters stand', () => {
    expect(joinForms('hoshi', 'wyn')).toBe('hoshiwyn');
    expect(joinForms('hedd', 'wyn')).toBe('heddwyn');
    expect(joinForms('sig', 'mund')).toBe('sigmund');
  });

  it('a seam that would misread or stick is refused', () => {
    expect(joinForms('luc', 'yume')).toBeNull(); // "Lucy-ume"
    expect(joinForms('luc', 'kai')).toBeNull(); // "luck"
    expect(joinForms('ros', 'hana')).toBeNull(); // a new "sh"
    expect(joinForms('sig', 'kai')).toBeNull(); // two stops
    expect(joinForms('sakura', 'aster')).toBeNull(); // the same vowel twice
    expect(joinForms('hisui', 'aster')).toBeNull(); // three vowels in a row
    expect(joinForms('kaze', 'ast')).toBeNull(); // "Kaz-east": the vowels fuse
    expect(joinForms('aur', 'urs')).toBeNull(); // a stutter
    expect(joinForms('hoshi', 'aster')).toBe('hoshiaster');
  });

  it('a join never makes an ugly word across its seam; inside one real word, the language keeps its own', () => {
    const el = (form) => WORDS.find((r) => r.form === form);
    expect(composeName(el('rosa'), el('tan'))).toBeNull();
    expect(composeName(el('hesper'), el('mont'))).toBeNull();
    expect(composeName(el('avi'), el('leon'))).toBeNull();
    expect(composeName(el('luc'), el('ratna'))).toMatchObject({ name: 'Lucratna' }); // ratna, "gem", is Sanskrit's own
  });

  it('any noun may meet any other — but a name never says the same thing twice', () => {
    const el = (form) => WORDS.find((r) => r.form === form);
    expect(composeName(el('leon'), el('ren'))).toMatchObject({ name: 'Leonren' }); // lotus of the lion
    expect(composeName(el('heli'), el('yuki'))).toMatchObject({ name: 'Heliyuki' }); // snow of the sun
    expect(composeName(el('hoshi'), el('tara'))).toBeNull(); // star of the stars
    expect(composeName(el('jala'), el('mor'))).toBeNull(); // sea of water
    expect(composeName(el('hoshi'), el('wyn'))).toMatchObject({ name: 'Hoshiwyn' });
  });
});

describe('the space of names', () => {
  it.each(NAME_KINDS)('every %s name reads as a name, once, with one meaning', (kind) => {
    const space = nameSpace(kind);
    expect(space.length).toBeGreaterThan(kind === 'house' ? 10000 : 40000);
    expect(new Set(space.map((x) => x.form)).size).toBe(space.length);
    for (const x of space) {
      expect(x.name).toMatch(/^[A-Z][a-z]{3,10}$/);
      expect(x.form).toMatch(/^[a-z]+$/); // a house name stays a safe folder segment
    }
  });
});

describe('meaningfulName', () => {
  it('same hex in, same name out — with or without 0x, in any case', () => {
    const a = meaningfulName(WALLET, { kind: 'house' });
    expect(meaningfulName(WALLET.slice(2).toUpperCase(), { kind: 'house' })).toEqual(a);
    expect(a.scheme).toBe(NAME_SCHEME);
  });

  it('says what it means, part by part, in English', () => {
    const m = meaningfulName(hash('a birth'), { kind: 'genesis' });
    expect(m.parts).toHaveLength(2);
    expect(m.name.toLowerCase().startsWith(m.parts[0].form)).toBe(true);
    expect(m.english).toMatch(/ of |^\w[\w ]* \w+$/);
    expect(describeGivenName(m.name, m)).toContain(`${m.name} means "${m.english}"`);
  });

  it('a house is named for a place', () => {
    const m = meaningfulName(WALLET, { kind: 'house' });
    expect(PLACES.some((c) => c.form === m.parts[1].form && c.gloss === m.parts[1].gloss)).toBe(true);
  });

  it("a house's beings do not echo each other: a new name shares no word with one already borne", () => {
    const taken = [];
    for (let i = 0; i < 40; i++) taken.push(meaningfulName(hash(`kin ${i}`), { kind: 'genesis', taken }).name);
    const parts = taken.map((n) => nameSpace('genesis').find((x) => x.name === n));
    const words = parts.flatMap((x) => [x.opener.id, x.closer.id]);
    expect(new Set(words).size).toBe(words.length);
  });

  it('a house of many births never repeats a genesis name', () => {
    const taken = [];
    for (let i = 0; i < 300; i++) taken.push(meaningfulName(hash(`birth ${i}`), { kind: 'genesis', taken }).name);
    expect(new Set(taken.map((n) => n.toLowerCase())).size).toBe(300);
  });

  it('the walk finds the last free name, and past every one takes an ordinal', () => {
    const all = nameSpace('genesis').map((x) => x.name);
    const free = all[1234];
    expect(meaningfulName(hash('x'), { kind: 'genesis', taken: all.filter((n) => n !== free) }).name).toBe(free);
    const second = meaningfulName(hash('x'), { kind: 'genesis', taken: all });
    expect(second.name).toBe(`${meaningfulName(hash('x'), { kind: 'genesis' }).name} II`);
  });

  it('refuses material that is not hex', () => {
    expect(() => meaningfulName('not hex', { kind: 'genesis' })).toThrow(/hex/);
    expect(() => meaningfulName(hash('x'), { kind: 'nope' })).toThrow(/kind/);
  });
});

describe("the house's name", () => {
  it('a house with no kin is its meaningful name', () => {
    const h = houseNameOf(WALLET);
    expect(h).toMatchObject({ name: meaningfulName(WALLET, { kind: 'house' }).name, scheme: NAME_SCHEME });
    expect(h.meaning.parts).toHaveLength(2);
  });

  it('a house whose kin carry its sound-name keeps it — existing houses keep their names', () => {
    const sound = houseNameFromWitness(WALLET);
    expect(houseNameOf(WALLET, [sound.toLowerCase(), 'Elsewhere'])).toEqual({ name: sound, scheme: SOUND_NAME_SCHEME, meaning: null });
    expect(describeGivenName(sound, null)).toContain('KOTODAMA sound-name');
  });

  it("another wallet's sound-name in the same root does not pin this house", () => {
    const other = houseNameFromWitness('0x99aa11bb22cc33dd44ee55ff66778899aabbccdd');
    expect(houseNameOf(WALLET, [other]).scheme).toBe(NAME_SCHEME);
  });
});
