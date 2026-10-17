import { describe, test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  normalizeForScreen, compileScreenList, screenPrompt, screenAll, refusalFor, loadScreenList, SCREEN_CLASSES,
} from '../../backend/services/image-forge/prompt-screen.js';

// The content-law screen, proven with SYNTHETIC terms only — no real banned
// content appears anywhere in this repo (the real list is a gitignored witness
// artifact). Unicode evasion inputs are built with String.fromCharCode per the
// harness-escape law. The entrenched NO-LOLICON rule (age_minor ∧ sexual) is
// the headline assertion.

// A synthetic list: adult sexual terms are ALLOWED alone; a minor indicator is
// a combination trigger; a csam/bestiality placeholder is a standalone deny.
const list = compileScreenList({
  classes: {
    csam: ['zzcsam'],
    age_minor: ['zzminor', 'zzschoolgirl'],
    sexual_explicit: ['zzexplicit'],
    sexual_suggestive: ['zzsuggestive'],
    incest: ['zzincest'],
    bestiality: ['zzbeast'],
    nonconsent: ['zznoconsent'],
  },
});

describe('normalizeForScreen', () => {
  test('folds leet, strips zero-width + combining, collapses separators, NFKD-folds fullwidth', () => {
    const zwj = String.fromCharCode(0x200D);
    const comb = String.fromCharCode(0x0301);
    expect(normalizeForScreen('L0L1').collapsed).toBe('loli');
    expect(normalizeForScreen(`a${zwj}b${zwj}c`).collapsed).toBe('abc');
    expect(normalizeForScreen(`e${comb}xample`).collapsed).toBe('example');
    expect(normalizeForScreen('l.o-l_i').collapsed).toBe('loli');
    expect(normalizeForScreen(String.fromCharCode(0xFF41, 0xFF42)).collapsed).toBe('ab'); // fullwidth a,b
  });

  test('non-strings and empty are safe', () => {
    // Three forms now: `collapsed` (evasion-resistant substring matching) plus
    // `spaced`/`joined` for word-boundary terms. The empty spaced/joined form is
    // a single space, so a ` term ` probe can never accidentally match.
    expect(normalizeForScreen(null)).toEqual({ collapsed: '', spaced: ' ', joined: ' ' });
    expect(normalizeForScreen('')).toEqual({ collapsed: '', spaced: ' ', joined: ' ' });
  });

  test('spaced form isolates words so a term can be matched at a boundary', () => {
    expect(normalizeForScreen('nude 9 year old').spaced).toBe(' nude 9 year old ');
    // The whole point: '9 year old' is a SUFFIX of '19 year old' in collapsed
    // form, but a distinct word run here.
    expect(normalizeForScreen('a 19 year old').spaced.includes(' 9 year old ')).toBe(false);
    expect(normalizeForScreen('a 9 year old').spaced.includes(' 9 year old ')).toBe(true);
    // And the innocents that forced 'rape' out of the list entirely.
    expect(normalizeForScreen('a bunch of grapes').spaced.includes(' rape ')).toBe(false);
    expect(normalizeForScreen('fabric draped over it').spaced.includes(' raped ')).toBe(false);
  });

  test('joined form re-glues single-letter evasion so boundary terms still catch it', () => {
    expect(normalizeForScreen('r a p e d').joined).toBe(' raped ');
    // Ordinary text with lone words is not corrupted into a false match.
    expect(normalizeForScreen('a woman in a field').joined.includes(' raped ')).toBe(false);
  });
});

describe('the entrenched NO-LOLICON law (age_minor ∧ sexual ⇒ deny)', () => {
  test('adult sexual content ALONE is allowed (this is an adults platform)', () => {
    expect(screenPrompt('a tasteful zzexplicit nude study', list)).toEqual({ ok: true, classes: [] });
    expect(screenPrompt('zzsuggestive pose', list)).toEqual({ ok: true, classes: [] });
  });

  test('a minority indicator ALONE is allowed (age words are not sexual)', () => {
    expect(screenPrompt('a zzminor detail in the painting', list)).toEqual({ ok: true, classes: [] });
  });

  test('minor indicator + sexual content TOGETHER is refused as minor_sexual', () => {
    const r = screenPrompt('zzminor zzexplicit', list);
    expect(r.ok).toBe(false);
    expect(r.classes).toEqual(['minor_sexual']);
    expect(screenPrompt('zzschoolgirl zzsuggestive scene', list).classes).toEqual(['minor_sexual']);
  });

  test('the combination is caught through separator + leet evasion', () => {
    // "zzm1n0r" leet-folds to "zzminor"; separators collapse away.
    expect(screenPrompt('zz.m1n0r + zz-explicit', list).classes).toEqual(['minor_sexual']);
  });

  test('cross-script homoglyph evasion is caught — a Cyrillic о does not sail through (echo r1 High)', () => {
    // "zzmin<Cyrillic о>r" must fold to "zzminor" and still trip the combination.
    const cyrO = String.fromCharCode(0x043E); // Cyrillic small o
    expect(screenPrompt(`zzmin${cyrO}r zzexplicit`, list).classes).toEqual(['minor_sexual']);
    // A Greek alpha standing in for 'a' in a standalone-deny term.
    const grAlpha = String.fromCharCode(0x03B1);
    const list2 = compileScreenList({ classes: { csam: ['zzcasam'] } });
    expect(screenPrompt(`zzc${grAlpha}sam`, list2).classes).toEqual(['csam']);
    // Greek mu folds toward 'm' (uppercase Μ is an M look-alike that lowercases
    // to μ) — 'm' is load-bearing in "minor" (echo r2 RQ).
    expect(normalizeForScreen(String.fromCharCode(0x03BC) + 'inor').collapsed).toBe('minor');
  });

  test('the refusal NEVER echoes the matched term — classes only', () => {
    const r = screenPrompt('zzminor zzexplicit', list);
    expect(JSON.stringify(r)).not.toContain('zzminor');
    expect(JSON.stringify(r)).not.toContain('zzexplicit');
  });
});

describe('standalone deny classes', () => {
  test('csam placeholder alone is refused', () => {
    expect(screenPrompt('zzcsam', list)).toEqual({ ok: false, classes: ['csam'] });
  });
  test('bestiality placeholder alone is refused', () => {
    expect(screenPrompt('zzbeast', list)).toEqual({ ok: false, classes: ['bestiality'] });
  });
  test('incest / nonconsent refuse only WITH sexual content', () => {
    expect(screenPrompt('zzincest family tree', list).ok).toBe(true);
    expect(screenPrompt('zzincest zzexplicit', list).classes).toEqual(['incest_sexual']);
    expect(screenPrompt('zznoconsent zzexplicit', list).classes).toEqual(['nonconsent_sexual']);
  });
});

describe('fail-closed everywhere', () => {
  test('an unavailable list denies with list_unavailable', () => {
    expect(screenPrompt('anything', { failClosed: true })).toEqual({ ok: false, classes: ['list_unavailable'] });
    expect(screenPrompt('anything', null)).toEqual({ ok: false, classes: ['list_unavailable'] });
  });

  test('a list with an UNKNOWN class fails to compile (fail-closed)', () => {
    const bad = compileScreenList({ classes: { not_a_real_class: ['x'] } });
    expect(bad.failClosed).toBe(true);
    expect(screenPrompt('benign', bad).ok).toBe(false);
  });

  test('a malformed shape fails closed', () => {
    expect(compileScreenList(null).failClosed).toBe(true);
    expect(compileScreenList({}).failClosed).toBe(true);
    expect(compileScreenList({ classes: 'nope' }).failClosed).toBe(true);
  });

  test('a benign prompt against a valid list passes', () => {
    expect(screenPrompt('a serene mountain landscape at dawn', list)).toEqual({ ok: true, classes: [] });
    expect(screenPrompt('', list)).toEqual({ ok: true, classes: [] });
  });
});

describe('loadScreenList (impure boundary, real files)', () => {
  test('loads and compiles a real JSON artifact from disk', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'screen-list-'));
    const p = path.join(dir, 'content-law.json');
    writeFileSync(p, JSON.stringify({ classes: { csam: ['zzc'], age_minor: ['zzm'], sexual_explicit: ['zzs'] } }));
    const loaded = loadScreenList(p);
    expect(loaded.failClosed).toBe(false);
    expect(screenPrompt('zzm zzs', loaded).classes).toEqual(['minor_sexual']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing file fails CLOSED — no law, no generation', () => {
    const loaded = loadScreenList('/no/such/content-law.json');
    expect(loaded.failClosed).toBe(true);
    expect(screenPrompt('anything', loaded).ok).toBe(false);
  });

  test('a file with an unknown class fails CLOSED', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'screen-list-'));
    const p = path.join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ classes: { made_up_class: ['x'] } }));
    expect(loadScreenList(p).failClosed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the shipped example structure compiles (synthetic terms, shape valid)', () => {
    const loaded = loadScreenList(path.join(process.cwd(), 'backend/services/image-forge/content-law.example.json'));
    expect(loaded.failClosed).toBe(false);
  });
});

describe('screenAll (multi-slot)', () => {
  test('first refusal across slots wins; a clean set passes', () => {
    expect(screenAll(['clean positive', 'clean negative'], list)).toEqual({ ok: true, classes: [] });
    expect(screenAll(['clean', 'zzminor zzexplicit'], list).classes).toEqual(['minor_sexual']);
  });
});

describe('refusalFor (the fixed policy, unit-level)', () => {
  test('sexual alone allows; +minor denies; csam/bestiality deny alone', () => {
    expect(refusalFor(new Set(['sexual_explicit']))).toBeNull();
    expect(refusalFor(new Set(['age_minor']))).toBeNull();
    expect(refusalFor(new Set(['age_minor', 'sexual_explicit']))).toBe('minor_sexual');
    expect(refusalFor(new Set(['age_minor', 'sexual_suggestive']))).toBe('minor_sexual');
    expect(refusalFor(new Set(['csam']))).toBe('csam');
    expect(refusalFor(new Set(['bestiality']))).toBe('bestiality');
  });

  test('csam takes precedence in the refusal name when multiple hit', () => {
    expect(refusalFor(new Set(['csam', 'age_minor', 'sexual_explicit']))).toBe('csam');
  });

  test('every SCREEN_CLASS is a known token (no typos between taxonomy and policy)', () => {
    expect(SCREEN_CLASSES).toContain('age_minor');
    expect(SCREEN_CLASSES).toContain('sexual_explicit');
    expect(SCREEN_CLASSES).toContain('deaging'); // NEGATIVE-slot only
    expect(SCREEN_CLASSES.length).toBe(8);
  });
});
