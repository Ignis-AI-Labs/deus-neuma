// Vision — the operator's master switch for image input.
// A fresh install defaults ON. A persisted OFF stays off; NEUMA_VISION=0 is
// the launch-time hard kill. The setting is machine-wide and install-owner gated.

import fs from 'fs/promises';
import { dirname, join } from 'path';
import { getSettingsDir } from './data-root.js';

const defaultPath = (env) => env.NEUMA_VISION_PATH || join(getSettingsDir(), 'vision.json');

export const createVisionSettings = ({ path, env = process.env } = {}) => ({
  async isEnabled() {
    if (String(env.NEUMA_VISION || '') === '0') return false;
    try {
      const parsed = JSON.parse(await fs.readFile(path || defaultPath(env), 'utf8'));
      return parsed.enabled !== false;
    } catch {
      return true;
    }
  },

  isEnvLocked: () => String(env.NEUMA_VISION || '') === '0',

  async setEnabled(enabled) {
    const target = path || defaultPath(env);
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ enabled: enabled === true }, null, 2)}\n`);
    await fs.rename(tmp, target);
  },
});

export const visionSettings = createVisionSettings();
