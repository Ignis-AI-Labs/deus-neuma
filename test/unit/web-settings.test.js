import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createWebSettings } from '../../backend/services/web-settings.js';

// Real tmp files, real disk — the factory is the production code path.

describe('web-settings.js', () => {
  const make = (env = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-settings-'));
    return { dir, settings: createWebSettings({ path: path.join(dir, 'web-access.json'), env }) };
  };

  test('fresh install defaults ON when no choice has been persisted', async () => {
    const { settings } = make();
    expect(await settings.isEnabled()).toBe(true);
    expect(settings.isEnvLocked()).toBe(false);
  });

  test('a flipped switch persists and is read back by a fresh instance', async () => {
    const { dir, settings } = make();
    await settings.setEnabled(true);
    const reread = createWebSettings({ path: path.join(dir, 'web-access.json'), env: {} });
    expect(await reread.isEnabled()).toBe(true);
    await settings.setEnabled(false);
    expect(await reread.isEnabled()).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('NEUMA_WEB_ACCESS=0 is the operator hard kill — it overrides a persisted ON', async () => {
    const { settings } = make({ NEUMA_WEB_ACCESS: '0' });
    await settings.setEnabled(true);
    expect(settings.isEnvLocked()).toBe(true);
    expect(await settings.isEnabled()).toBe(false);
  });

  test('a corrupt file fails closed as OFF, never as ON, never a throw', async () => {
    const { dir, settings } = make();
    fs.writeFileSync(path.join(dir, 'web-access.json'), '{not json');
    expect(await settings.isEnabled()).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
