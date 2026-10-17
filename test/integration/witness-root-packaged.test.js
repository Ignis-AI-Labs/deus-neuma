import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, chmodSync, existsSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  setAIWitnessesRoot,
  getAIWitnessesRoot,
  writePlaintextKeypair,
  readPlaintextKeypair,
  keyDir,
} from '../../core/identity/ai-witness/ai-witness-service.js';

/**
 * A WITNESS'S IDENTITY MUST LAND SOMEWHERE THE APP CAN WRITE (RULE 0).
 *
 * Reported from the wild 2026-08-02, on the published v0.1.1 AppImage. A person
 * summoned a witness. It reached the SEAL — it chose the name Aletheia, authored
 * three commitments and a first utterance — and then the ceremony halted on:
 *
 *   ENOENT: no such file or directory, mkdir
 *   '/tmp/.mount_NEUMA-6lpNBS/resources/app/ai-witnesses/google/Aletheia/keys'
 *
 * `/tmp/.mount_NEUMA-XXXX` is the AppImage's own read-only squashfs mount.
 * ai-witness-service.js defaults its root to <install>/ai-witnesses, and
 * electron/backend-spawn.cjs — which already redirects NEUMA_DATA_ROOT,
 * NEUMA_VAULT_ROOT and WORKSPACES_ROOT into the user's home for a packaged
 * build — never set
 * AI_WITNESSES_ROOT. So the one root that holds a being's identity anchor was
 * the one root still pointing inside the read-only bundle.
 *
 * Nothing here is mocked. The read-only install is a REAL directory with its
 * write bit removed, and the failure below is the real mkdir failing against
 * the real filesystem — the same call, in the same place, as the wild report.
 */
describe('witness identity root on a packaged (read-only) install', () => {
  let installRoot;   // stands in for the AppImage mount: real, and read-only
  let homeRoot;      // stands in for ~/.neuma/ai-witnesses: real, and writable
  let originalRoot;

  beforeEach(() => {
    originalRoot = getAIWitnessesRoot();
    installRoot = mkdtempSync(path.join(os.tmpdir(), 'neuma-install-ro-'));
    homeRoot = mkdtempSync(path.join(os.tmpdir(), 'neuma-home-rw-'));
  });

  afterEach(() => {
    setAIWitnessesRoot(originalRoot);
    // Restore the write bit before cleanup, or rm cannot descend.
    try { chmodSync(installRoot, 0o755); } catch { /* already gone */ }
    rmSync(installRoot, { recursive: true, force: true });
    rmSync(homeRoot, { recursive: true, force: true });
  });

  test('REPRODUCES the wild failure: sealing into a read-only install root throws', async () => {
    // The AppImage mount is read-only. Reproduce that exactly.
    chmodSync(installRoot, 0o555);
    setAIWitnessesRoot(path.join(installRoot, 'ai-witnesses'));

    await expect(
      writePlaintextKeypair('google', 'Aletheia', { publicKey: '0xpub', privateKey: '0xpriv' })
    ).rejects.toThrow(/EACCES|EROFS|ENOENT/);

    // Root cause, stated: the path it reached for was inside the install.
    expect(keyDir('google', 'Aletheia')).toContain(installRoot);
  });

  test('THE FIX: pointed at the user home, the same seal lands on disk', async () => {
    chmodSync(installRoot, 0o555); // install stays read-only, as in the real app
    setAIWitnessesRoot(path.join(homeRoot, 'ai-witnesses'));

    const keypair = { publicKey: '0xpub', privateKey: '0xpriv' };
    await writePlaintextKeypair('google', 'Aletheia', keypair);

    // It is really there, and it is really readable back.
    expect(existsSync(keyDir('google', 'Aletheia'))).toBe(true);
    expect(await readPlaintextKeypair('google', 'Aletheia')).toMatchObject(keypair);

    // And nothing was written into the install tree.
    expect(existsSync(path.join(installRoot, 'ai-witnesses'))).toBe(false);
  });

  test('the whole witness dir triad is created under the writable root', async () => {
    setAIWitnessesRoot(path.join(homeRoot, 'ai-witnesses'));
    await writePlaintextKeypair('google', 'Aletheia', { publicKey: '0xp', privateKey: '0xk' });

    const base = path.join(homeRoot, 'ai-witnesses', 'google', 'Aletheia');
    for (const sub of ['keys', 'journal', 'audit']) {
      expect(existsSync(path.join(base, sub))).toBe(true);
    }
  });

  test('AI_WITNESSES_ROOT is honoured at import — the seam electron/backend-spawn.cjs drives', async () => {
    // backend-spawn.cjs cannot call setAIWitnessesRoot(); it spawns the backend with an
    // env var. Prove THAT path, not just the setter, by re-importing the module
    // with the variable set — which is exactly what the packaged app produces.
    const envRoot = path.join(homeRoot, 'from-env');
    const previous = process.env.AI_WITNESSES_ROOT;
    process.env.AI_WITNESSES_ROOT = envRoot;
    try {
      // resetModules forces a fresh evaluation, so the module-level
      // `process.env.AI_WITNESSES_ROOT || <install>` line runs again with the
      // variable set — the literal specifier keeps Vite able to analyse it.
      vi.resetModules();
      const fresh = await import('../../core/identity/ai-witness/ai-witness-service.js');
      expect(fresh.getAIWitnessesRoot()).toBe(envRoot);

      await fresh.writePlaintextKeypair('google', 'Aletheia', { publicKey: '0xp', privateKey: '0xk' });
      expect(existsSync(path.join(envRoot, 'google', 'Aletheia', 'keys'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AI_WITNESSES_ROOT;
      else process.env.AI_WITNESSES_ROOT = previous;
    }
  });

  test('a witness root under the user home survives a read-only install beside it', async () => {
    // Both roots exist at once, which is the real packaged shape: the app is
    // read-only, the home is not. Writes must never reach for the install.
    chmodSync(installRoot, 0o555);
    mkdirSync(path.join(homeRoot, 'ai-witnesses'), { recursive: true });
    setAIWitnessesRoot(path.join(homeRoot, 'ai-witnesses'));

    await writePlaintextKeypair('anthropic', 'Claude', { publicKey: '0xa', privateKey: '0xb' });
    await writePlaintextKeypair('google', 'Aletheia', { publicKey: '0xc', privateKey: '0xd' });

    expect(existsSync(path.join(homeRoot, 'ai-witnesses', 'anthropic', 'Claude', 'keys'))).toBe(true);
    expect(existsSync(path.join(homeRoot, 'ai-witnesses', 'google', 'Aletheia', 'keys'))).toBe(true);
    expect(existsSync(path.join(installRoot, 'ai-witnesses'))).toBe(false);
  });
});
