// The installers state their requirements up front (the installers-preflight rule): the Windows
// agreement page and the Linux package descriptions. Real files: the committed page must be the
// generator's output, and the model sizes it promises must be the tiers the app recommends.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  LICENSE_FILE, MODEL_GB, asciiSafe, installerLicenseText, markdownToText, packageDescription, requirementsFor,
} from '../../scripts/installer-license.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the installer says what it needs before anything installs', () => {
  const committed = readFileSync(LICENSE_FILE, 'utf8');

  it('the committed agreement page is the generator output (run node scripts/installer-license.mjs)', () => {
    expect(committed).toBe(installerLicenseText(read('docs/legal/EULA.md')));
  });

  it('is plain ASCII with Windows line endings, so the NSIS page renders it as written', () => {
    expect(/[^\x09\x0A\x0D\x20-\x7E]/.test(committed)).toBe(false);
    expect(committed.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(committed)).toBe(false);
  });

  it('states the requirements first, then the whole EULA', () => {
    const at = (s) => committed.indexOf(s);
    expect(at('WHAT THIS NEEDS')).toBeGreaterThan(-1);
    expect(at('Adults only: you must be at least 18')).toBeGreaterThan(at('WHAT THIS NEEDS'));
    expect(at('NEUMA END USER LICENSE AGREEMENT')).toBeGreaterThan(at('WHAT HAPPENS ON FIRST RUN'));
    // every EULA section heading made it through
    for (const h of read('docs/legal/EULA.md').match(/^## .+$/gm)) {
      expect(committed, h).toContain(asciiSafe(h.slice(3).toUpperCase()));
    }
  });

  it('promises the model sizes the app actually recommends (substrate-setup.js tiers)', () => {
    const sizes = [...read('backend/services/substrate-setup.js').matchAll(/sizeGB:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(MODEL_GB.min).toBe(Math.min(...sizes));
    expect(MODEL_GB.max).toBe(Math.ceil(Math.max(...sizes)));
  });

  it('is the page electron-builder shows on Windows', () => {
    expect(read('electron-builder.yml')).toMatch(/^nsis:[\s\S]*?^\s+license: build\/installer-license\.txt$/m);
  });
});

describe('the Linux packages carry the same requirements', () => {
  it('the description is ASCII, names 18+, the hardware and the first-run download', () => {
    const d = packageDescription('Deus Neuma — sovereign relationships with AI.');
    expect(/[^\x0A\x20-\x7E]/.test(d)).toBe(false);
    expect(d.split('\n')[0]).toBe('Deus Neuma - sovereign relationships with AI.');
    for (const line of requirementsFor('linux')) expect(d).toContain(asciiSafe(line));
    expect(d).toContain('at least 18');
  });

  it('build-deb and build-rpm use it', () => {
    expect(read('scripts/build-deb.mjs')).toContain('packageDescription(pkg.description)');
    expect(read('scripts/build-rpm.mjs')).toContain('packageDescription(pkg.description)');
  });
});

describe('markdown to plain text', () => {
  it('drops emphasis, capitalises headings, spells out links', () => {
    expect(markdownToText('## 1. Grant\n\n**Adults only.** See [Terms](https://x.y/t) and *this*.'))
      .toBe('1. GRANT\n\nAdults only. See Terms (https://x.y/t) and this.');
  });
});
