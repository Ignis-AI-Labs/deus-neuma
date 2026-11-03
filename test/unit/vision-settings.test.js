import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { createVisionSettings } from '../../backend/services/vision-settings.js';

describe('vision settings — default on, persisted off, launch kill-switch', () => {
  let root;
  let path;
  let settings;

  beforeEach(async () => {
    root = await createTempDir('vision-settings');
    path = `${root}/vision.json`;
    settings = createVisionSettings({ path, env: {} });
  });

  test('a fresh install enables image input', async () => {
    expect(await settings.isEnabled()).toBe(true);
    expect(settings.isEnvLocked()).toBe(false);
  });

  test('off persists across instances; on persists too', async () => {
    await settings.setEnabled(false);
    expect(await createVisionSettings({ path, env: {} }).isEnabled()).toBe(false);
    await settings.setEnabled(true);
    expect(await createVisionSettings({ path, env: {} }).isEnabled()).toBe(true);
  });

  test('the launch-time hard kill wins over a persisted on', async () => {
    await settings.setEnabled(true);
    const locked = createVisionSettings({ path, env: { NEUMA_VISION: '0' } });
    expect(await locked.isEnabled()).toBe(false);
    expect(locked.isEnvLocked()).toBe(true);
  });

  test('a malformed record does not silently remove the default capability', async () => {
    await fs.writeFile(path, '{not-json');
    expect(await settings.isEnabled()).toBe(true);
  });
});
