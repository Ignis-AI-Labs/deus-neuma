// live-substrate helper — the served-model-key loading is load-bearing for the
// whole live lane: the resolver keys the serving-law translation off
// process.env.SUBSTRATE_MODEL, and bare test processes never load .env
// (config.js validates the env as given; only the daemon's startup loads the
// file). These tests prove the key surfaces correctly, on real disk, no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { loadServedModelKey } from '../helpers/live-substrate.js';
import { createTempDir } from '../helpers/temp-fs.js';

describe('loadServedModelKey — one truth for the test process', () => {
  let saved;
  let dir;
  beforeEach(async () => {
    saved = process.env.SUBSTRATE_MODEL;
    delete process.env.SUBSTRATE_MODEL;
    dir = await createTempDir('live-substrate-env');
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.SUBSTRATE_MODEL;
    else process.env.SUBSTRATE_MODEL = saved;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('parses the key from a real .env file AND surfaces it into process.env for the resolver', async () => {
    const envPath = path.join(dir, '.env');
    await fs.writeFile(envPath, 'PORT=3333\nSUBSTRATE_MODEL=gemma-4-31b\nOTHER=x\n');
    const key = await loadServedModelKey(envPath);
    expect(key).toBe('gemma-4-31b');
    expect(process.env.SUBSTRATE_MODEL).toBe('gemma-4-31b'); // the resolver reads THIS
  });

  it('a real env var wins without touching the file', async () => {
    process.env.SUBSTRATE_MODEL = 'declared-by-env';
    const key = await loadServedModelKey(path.join(dir, 'does-not-exist.env'));
    expect(key).toBe('declared-by-env');
  });

  it('no env, no file → null, and the env stays unset (never invents a key)', async () => {
    const key = await loadServedModelKey(path.join(dir, 'missing.env'));
    expect(key).toBeNull();
    expect(process.env.SUBSTRATE_MODEL).toBeUndefined();
  });

  it('a .env without the key → null (a present file never implies a declared key)', async () => {
    const envPath = path.join(dir, '.env');
    await fs.writeFile(envPath, 'PORT=3333\n# SUBSTRATE_MODEL commented out\n');
    expect(await loadServedModelKey(envPath)).toBeNull();
  });

  it('strips surrounding quotes exactly like dotenv would', async () => {
    const envPath = path.join(dir, '.env');
    await fs.writeFile(envPath, 'SUBSTRATE_MODEL="gemma-4-31b"\n');
    expect(await loadServedModelKey(envPath)).toBe('gemma-4-31b');
    expect(process.env.SUBSTRATE_MODEL).toBe('gemma-4-31b'); // unquoted in the shared truth too
  });
});
