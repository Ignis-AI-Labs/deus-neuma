import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'process';

const exec = promisify(execFile);
let root;
let env;

const git = (args) => exec('git', args, { cwd: root, env });
const ignored = async (file) => {
  try {
    await git(['check-ignore', '-q', '--', file]);
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-gitignore-secrets-'));
  env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  await fs.copyFile(path.resolve('.gitignore'), path.join(root, '.gitignore'));
  await git(['init', '--quiet']);
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('.gitignore secret-shaped files', () => {
  test('production environments, key suffixes, and key-custody records are ignored', async () => {
    const files = [
      '.env.production', 'nested/service.pem', 'nested/service.key', 'nested/service.p8', 'nested/service.p12',
      'data/retired-masters.json', 'data/.retired-masters-healed', 'data/master-check.json',
    ];
    for (const file of files) expect(await ignored(file), file).toBe(true);
  });

  test('Git refuses a secret-shaped add but accepts legitimate source and env examples', async () => {
    await fs.mkdir(path.join(root, 'nested'), { recursive: true });
    await fs.mkdir(path.join(root, 'frontend'), { recursive: true });
    await fs.writeFile(path.join(root, 'nested', 'private.key'), 'filename-only fixture\n');
    await expect(git(['add', '--', 'nested/private.key'])).rejects.toMatchObject({ code: 1 });
    await fs.writeFile(path.join(root, 'frontend', 'main.jsx'), 'export {};\n');
    await fs.writeFile(path.join(root, '.env.example'), 'EXAMPLE_NAME=\n');
    await fs.writeFile(path.join(root, 'env.claude.example'), 'EXAMPLE_NAME=\n');
    await git(['add', '--', 'frontend/main.jsx', '.env.example', 'env.claude.example']);
    const { stdout } = await git(['diff', '--cached', '--name-only']);
    expect(stdout.trim().split('\n').sort()).toEqual(['.env.example', 'env.claude.example', 'frontend/main.jsx']);
  });
});
