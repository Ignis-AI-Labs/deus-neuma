// SOFTWARE GROUND — the open folder is a software project by its markers
// (backend/services/software-ground.js). Real folders on a real disk.
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { isSoftwareGround, SOFTWARE_MARKERS } from '../../backend/services/software-ground.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'software-ground-'));
afterAll(() => fs.rm(root, { recursive: true, force: true }));
const folder = async (name, files = {}) => {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    if (body === null) await fs.mkdir(path.join(dir, f), { recursive: true });
    else await fs.writeFile(path.join(dir, f), body);
  }
  return dir;
};

describe('isSoftwareGround', () => {
  it('a version-controlled folder, or one with a build manifest, is software work', async () => {
    expect(await isSoftwareGround(await folder('git', { '.git': null }))).toBe(true);
    expect(await isSoftwareGround(await folder('node', { 'package.json': '{}' }))).toBe(true);
    expect(await isSoftwareGround(await folder('py', { 'pyproject.toml': '' }))).toBe(true);
    expect(SOFTWARE_MARKERS).toContain('Cargo.toml');
  });

  it('an empty folder, a documents folder, nothing at all — not software work', async () => {
    expect(await isSoftwareGround(await folder('empty'))).toBe(false);
    expect(await isSoftwareGround(await folder('docs', { 'notes.md': '# x', 'photo.png': 'x' }))).toBe(false);
    expect(await isSoftwareGround(path.join(root, 'missing'))).toBe(false);
    expect(await isSoftwareGround(null)).toBe(false);
  });
});
