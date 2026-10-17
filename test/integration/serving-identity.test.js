/**
 * SERVING IDENTITY — real-kernel gnosis (RULE 0). A real claim file in a temp
 * claim dir, a real open descriptor in THIS process, and a real readlink
 * through /proc/<pid>/fd — the exact resolution path the adopted-serving
 * display fix rides. Nothing mocked.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const CLAIM_ENV = 'NEUMA_SUBSTRATE_CLAIM_DIR';

describe('servedModelPath — the kernel names the descriptor', () => {
  let prevClaimDir, writeClaim, clearClaim, servedModelIdentity, isFdServedName, servedKeyFromLive;
  let handle, modelFile;

  beforeAll(async () => {
    prevClaimDir = process.env[CLAIM_ENV];
    process.env[CLAIM_ENV] = await createTempDir('serving-identity-claim');
    // Import AFTER the env door is set — the claim registry reads it at call
    // time, but keeping the order explicit mirrors the boot sequence.
    ({ writeClaim, clearClaim } = await import('../../backend/services/substrate-claim-registry.js'));
    ({ servedModelIdentity, isFdServedName, servedKeyFromLive } = await import('../../backend/services/serving-identity.js'));
    const dir = await createTempDir('serving-identity-model');
    modelFile = path.join(dir, 'gemma-4-31B-it-Q8_0.gguf');
    await fs.writeFile(modelFile, 'weights stand here');
    handle = await fs.open(modelFile, 'r');
    writeClaim(process.pid, 8089);
  });

  afterAll(async () => {
    await handle?.close();
    clearClaim?.();
    if (prevClaimDir === undefined) delete process.env[CLAIM_ENV];
    else process.env[CLAIM_ENV] = prevClaimDir;
  });

  test('servedKeyFromLive never returns an FD — mapped identity or null', () => {
    const live = { id: '/proc/self/fd/4', name: 'gemma-4-31B-it-Q8_0' };
    expect(servedKeyFromLive(live, null)).toBeNull();
    expect(servedKeyFromLive(live, '/models/gemma-4-31B-it-Q8_0.gguf'))
      .toBe('/models/gemma-4-31B-it-Q8_0.gguf');
    expect(servedKeyFromLive({ id: 'gemma-4-31b', name: 'gemma-4-31b' }, null)).toBe('gemma-4-31b');
    expect(servedKeyFromLive({ id: 'qwen3.8-27b', name: '/proc/self/fd/4' }, null)).toBe('qwen3.8-27b');
    expect(servedKeyFromLive({ id: 'local-model' }, '/x')).toBeNull();
  });

  test('isFdServedName recognizes descriptor spellings and nothing else', () => {
    expect(isFdServedName('/proc/self/fd/4')).toBe(true);
    expect(isFdServedName('/proc/31337/fd/9')).toBe(true);
    expect(isFdServedName('/dev/fd/5')).toBe(true);
    expect(isFdServedName('/models/gemma.gguf')).toBe(false);
    expect(isFdServedName('gemma-4-31b')).toBe(false);
    expect(isFdServedName(null)).toBe(false);
  });

  test('a legacy claim (no identity) resolves a real descriptor through the claimed pid to the real gguf path', async () => {
    const real = await servedModelIdentity(`/proc/self/fd/${handle.fd}`);
    expect(real).toBe(await fs.realpath(modelFile));
  });

  test('a claim carrying the serving identity answers FIRST — no kernel walk needed', async () => {
    writeClaim(process.pid, 8089, { model: modelFile, servingModel: 'gemma-4-31b' });
    expect(await servedModelIdentity('/proc/self/fd/4')).toBe('gemma-4-31b');
    writeClaim(process.pid, 8089, { model: modelFile });
    expect(await servedModelIdentity('/proc/self/fd/4')).toBe(modelFile);
    writeClaim(process.pid, 8089); // restore the legacy shape for later tests
  });

  test("a custody role-name behind the descriptor is refused — 'bytes' is not a model", async () => {
    const roleFile = path.join(path.dirname(modelFile), 'bytes');
    await fs.writeFile(roleFile, 'staged artifact copy');
    const roleHandle = await fs.open(roleFile, 'r');
    try {
      expect(await servedModelIdentity(`/proc/self/fd/${roleHandle.fd}`)).toBeNull();
    } finally {
      await roleHandle.close();
    }
  });

  test('a non-descriptor name resolves to null — callers keep their fallback', async () => {
    expect(await servedModelIdentity('gemma-4-31b')).toBeNull();
    expect(await servedModelIdentity(null)).toBeNull();
  });

  test('a descriptor the serving process does not hold resolves to null, never throws', async () => {
    expect(await servedModelIdentity('/proc/self/fd/1023')).toBeNull();
  });
});
