/* global process */
import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';

const fixture = fileURLToPath(new URL('../fixtures/pr600-electron-main.cjs', import.meta.url));

test('real Electron refuses missing/foreign origins and recovers confirmation after a setup exception', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'pr600-electron-'));
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath: electronPath,
      args: ['--disable-gpu', fixture],
      env: { ...process.env, PR600_PROFILE: profile, NEUMA_CONFIRM_E2E: '1' },
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const result = await desktop.evaluate(() => globalThis.result);
    expect(result.ready).toBe(true);
    expect(result.fatal).toBeUndefined();
    expect(result.omission).toMatch(/requires the desk origin resolver/);
    expect(result.testGlobal).toBe('undefined');
    expect(result.deskStatus).toMatchObject({ hasWallet: false, unlocked: false });
    expect(result.foreignError).toMatch(/refused: not the desk/);
    expect(result.devTools).toBe(false);
    expect(result.earlyError).toBeTruthy();
    expect(result.recovered).toBe(false);
    expect(result.concurrent).toMatch(/already open/);
    expect(result.firstClosed).toBe(false);
  } finally {
    await desktop?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}, 60_000);
