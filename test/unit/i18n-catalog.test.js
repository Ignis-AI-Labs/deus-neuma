// i18n-catalog.test.js — the catalogs are real data the desk renders from;
// they are loaded FOR REAL here (dynamic import of the actual modules, the
// same files the engine bundles) and judged whole. No mocks anywhere: a
// catalog file is data, and loading it is the real path.
//
// What this guards:
//   1. Every shipped locale speaks every namespace en speaks (key parity —
//      a missing key in zh renders English mid-screen; an extra key is drift).
//   2. No empty values anywhere.
//   3. Interpolation slot parity (a zh string missing {{path}} swallows the
//      operator's data; an extra slot renders literally).
//   4. The languages registry covers exactly the shipped locale directories
//      (a catalog without a registry row is unreachable; a row without a
//      catalog wedges the picker).

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, matchLanguageTag,
} from '../../frontend/i18n/languages.js';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/i18n/locales');

const localeDirs = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const loadNamespace = async (lang, ns) =>
  (await import(pathToFileURL(join(LOCALES_DIR, lang, `${ns}.js`)).href)).default;

// Flatten nested catalogs to dotted paths so parity compares whole trees.
const flatten = (node, prefix = '') => {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
};

const interpolationSlots = (text) =>
  [...String(text).matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]).sort();

const namespacesOf = (lang) =>
  readdirSync(join(LOCALES_DIR, lang))
    .filter((file) => file.endsWith('.js'))
    .map((file) => file.slice(0, -'.js'.length))
    .sort();

describe('i18n catalogs — the registry and the files agree', () => {
  it('the shipped locale directories are exactly the registry rows, en first', () => {
    expect(localeDirs).toContain(DEFAULT_LANGUAGE);
    expect([...SUPPORTED_LANGUAGES.map((lang) => lang.code)].sort()).toEqual(localeDirs);
  });

  it('every registry row is supported and carries an endonym in its own script', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(isSupportedLanguage(lang.code)).toBe(true);
      expect(lang.endonym.trim().length).toBeGreaterThan(0);
    }
  });

  it('BCP-47 region tags fold onto the script-level catalogs', () => {
    expect(matchLanguageTag('zh-CN')).toBe('zh');
    expect(matchLanguageTag('ja-JP')).toBe('ja');
    expect(matchLanguageTag('en-US')).toBe('en');
    expect(matchLanguageTag('fr-FR')).toBe(null);
    expect(matchLanguageTag('')).toBe(null);
    expect(matchLanguageTag(null)).toBe(null);
  });

  it('every locale ships the same namespace set as en', () => {
    const enNamespaces = namespacesOf(DEFAULT_LANGUAGE);
    expect(enNamespaces.length).toBeGreaterThan(0);
    for (const lang of localeDirs) {
      expect(namespacesOf(lang)).toEqual(enNamespaces);
    }
  });
});

describe('i18n catalogs — key and slot parity with en', () => {
  it('every namespace in every locale matches en exactly: keys, non-empty values, slots', async () => {
    for (const ns of namespacesOf(DEFAULT_LANGUAGE)) {
      const enFlat = flatten(await loadNamespace(DEFAULT_LANGUAGE, ns));
      expect(Object.keys(enFlat).length).toBeGreaterThan(0);

      for (const lang of localeDirs) {
        const flat = flatten(await loadNamespace(lang, ns));
        expect(Object.keys(flat).sort(), `${lang}/${ns} key parity`).toEqual(Object.keys(enFlat).sort());

        for (const [key, value] of Object.entries(flat)) {
          expect(typeof value, `${lang}/${ns}:${key} is a string`).toBe('string');
          expect(value.trim().length, `${lang}/${ns}:${key} is not empty`).toBeGreaterThan(0);
          expect(interpolationSlots(value), `${lang}/${ns}:${key} interpolation slots`)
            .toEqual(interpolationSlots(enFlat[key]));
        }
      }
    }
  });

  it('catalogs are frozen at every level (a mutated catalog is a leaked edit)', async () => {
    for (const lang of localeDirs) {
      for (const ns of namespacesOf(lang)) {
        const catalog = await loadNamespace(lang, ns);
        const assertFrozen = (node) => {
          expect(Object.isFrozen(node), `${lang}/${ns} frozen`).toBe(true);
          for (const value of Object.values(node)) {
            if (value && typeof value === 'object') assertFrozen(value);
          }
        };
        assertFrozen(catalog);
      }
    }
  });
});
