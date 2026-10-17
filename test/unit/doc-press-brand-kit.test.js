import { describe, test, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  loadBrandKit, listBrandKits, validateKit, DEFAULT_KIT
} from '../../backend/services/doc-press/brand-kit.js';

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';

async function writeKit(root, id, kitJson, assets = {}) {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'kit.json'), JSON.stringify(kitJson));
  for (const [filename, content] of Object.entries(assets)) {
    await fs.writeFile(path.join(dir, filename), content);
  }
  return dir;
}

describe('validateKit (pure)', () => {
  test('merges partial overrides over defaults', () => {
    const kit = validateKit({ companyName: 'Acme', colors: { accent: '#ff0000' } }, 'acme');
    expect(kit.companyName).toBe('Acme');
    expect(kit.colors.accent).toBe('#ff0000');
    expect(kit.colors.ink).toBe(DEFAULT_KIT.colors.ink);
    expect(kit.pdf.format).toBe('Letter');
  });
  test('rejects logo filenames that escape the kit directory', () => {
    expect(() => validateKit({ logos: { primary: '../../../etc/passwd' } }, 'evil')).toThrow(/bare filename/);
    expect(() => validateKit({ logos: { primary: '/abs/path.svg' } }, 'evil')).toThrow(/bare filename/);
  });
  test('rejects wrong-typed fields loudly', () => {
    expect(() => validateKit({ companyName: 42 }, 'bad')).toThrow(/must be a string/);
    expect(() => validateKit({ charts: { palette: 'red' } }, 'bad')).toThrow(/array of color strings/);
    expect(() => validateKit([], 'bad')).toThrow(/JSON object/);
  });
});

describe('loadBrandKit (real fs)', () => {
  test('no kitId returns the frozen built-in neutral kit', async () => {
    const kit = await loadBrandKit({});
    expect(kit).toBe(DEFAULT_KIT);
    expect(Object.isFrozen(kit)).toBe(true);
  });
  test('loads a kit and resolves logos to data URIs', async () => {
    const root = await createTempDir('brand-kits');
    await writeKit(root, 'acme', { companyName: 'Acme Corp', logos: { primary: 'logo.svg' } }, { 'logo.svg': TINY_SVG });
    const kit = await loadBrandKit({ kitId: 'acme', kitsDir: root });
    expect(kit.companyName).toBe('Acme Corp');
    expect(kit.logoData.primary).toBe(`data:image/svg+xml;base64,${Buffer.from(TINY_SVG).toString('base64')}`);
  });
  test('a missing logo file is skipped, not fatal', async () => {
    const root = await createTempDir('brand-kits');
    await writeKit(root, 'gappy', { logos: { primary: 'logo.svg', badge: 'gone.svg' } }, { 'logo.svg': TINY_SVG });
    const kit = await loadBrandKit({ kitId: 'gappy', kitsDir: root });
    expect(kit.logoData.primary).toBeDefined();
    expect(kit.logoData.badge).toBeUndefined();
  });
  test('unknown kit id throws with the kit path', async () => {
    const root = await createTempDir('brand-kits');
    await expect(loadBrandKit({ kitId: 'nope', kitsDir: root })).rejects.toThrow(/not readable/);
  });
  test('path-traversal kit ids are rejected before any fs access', async () => {
    await expect(loadBrandKit({ kitId: '../escape', kitsDir: '/tmp' })).rejects.toThrow(/Invalid brand kit id/);
  });
});

describe('listBrandKits (real fs)', () => {
  test('lists valid kits and skips broken ones', async () => {
    const root = await createTempDir('brand-kits');
    await writeKit(root, 'good', { name: 'Good Kit', companyName: 'Good Co' });
    const brokenDir = path.join(root, 'broken');
    await fs.mkdir(brokenDir, { recursive: true });
    await fs.writeFile(path.join(brokenDir, 'kit.json'), '{ not json');
    const kits = await listBrandKits({ kitsDir: root });
    expect(kits).toEqual([{ id: 'good', name: 'Good Kit', companyName: 'Good Co' }]);
  });
  test('a missing kit root lists nothing', async () => {
    expect(await listBrandKits({ kitsDir: '/tmp/does-not-exist-doc-press' })).toEqual([]);
  });
});
