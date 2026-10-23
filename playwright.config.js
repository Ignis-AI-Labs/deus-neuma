import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pinSocialKeysEmpty } from './test/helpers/no-social-keys.js';

dotenv.config();

// NO REAL SOCIAL KEYS IN A TEST (2026-10-21 incident: a dev lane posted for real).
// Every backend a spec spawns inherits this env, and its own dotenv would reload
// the repo .env's live channel keys; they are pinned empty here for every spec
// (test/helpers/no-social-keys.js). A spec proves a channel against a local
// stand-in, never a real account.
pinSocialKeysEmpty();

// THE MACHINE'S SERVING TRUTH, READ-ONLY (2026-10-06). Every backend and
// Electron app a spec spawns inherits this process's env — and with no pin
// they read AND WROTE ~/.neuma: an isolated stack's shutdown cleared the live
// model server's substrate-claim.json (the bench's agent arms then failed) and
// rewrote root-lock.json. The vitest lane has pinned this since test/setup.js;
// the browser lane now does the same: the real claim, selection and root lock
// are COPIED into a temp dir once per run (workers inherit the env, so the
// guard holds), so a spec still SEES the live server but can never touch it.
if (!process.env.NEUMA_SUBSTRATE_CLAIM_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-machine-'));
  for (const name of ['substrate-claim.json', 'substrate-selection.json', 'root-lock.json']) {
    const real = path.join(os.homedir(), '.neuma', name);
    if (fs.existsSync(real)) fs.copyFileSync(real, path.join(dir, name));
  }
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = dir;
  process.env.NEUMA_ROOT_LOCK_PATH = process.env.NEUMA_ROOT_LOCK_PATH || path.join(dir, 'root-lock.json');
}

/**
 * Playwright config for Neuma end-to-end tests.
 * Assumes the dev stack and LM Studio (:1234) are already running — birth stages
 * are LLM-backed, so timeouts are generous. The frontend port is env-driven
 * (FRONTEND_PORT, default 7777) so the suite follows a checkout's local ports.
 */
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 7777;

export default defineConfig({
  testDir: './test/e2e',
  // A full 7-stage LLM birth can take minutes
  timeout: 8 * 60 * 1000,
  expect: { timeout: 90 * 1000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/e2e/report' }]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 60 * 1000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
