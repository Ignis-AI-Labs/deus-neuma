/**
 * THE PRESS's Chromium starts without the backend's secrets, and still
 * presses (security seat G7). REAL press path, REAL spawn, REAL Chromium,
 * REAL PDF — no mock (RULE 0).
 *
 * The oracle is the environment the press's spawn really hands its child.
 * NEUMA_CHROMIUM_PATH (the operator's own door) points at a two-line shell
 * launcher that writes the environment it was given and then `exec`s the
 * real browser in its place, so the same process renders the page. /proc
 * cannot serve here: Chromium rewrites its argv over the environ region
 * (setproctitle), so a large environment reads back as argv text — measured
 * 2026-10-19, it hid the very secrets the proof looks for.
 *
 * Linux/macOS only (a POSIX shell) and only where a Chromium exists — both
 * skips are loud. Every secret here is FAKE.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { pressDocument, locateChromium } from '../../backend/services/doc-press/index.js';
import { pdfText } from '../../backend/services/pdf-text.js';

const SECRETS = Object.freeze({
  AUTH_SECRET: 'FAKE_press_auth_secret',
  DNA_ENCRYPTION_KEY: 'FAKE_press_dna_key',
  DEPLOYER_PRIVATE_KEY: '0xFAKEPRESSKEY',
  OPENAI_API_KEY: 'sk-FAKE-press',
});

const located = (() => {
  if (process.platform === 'win32' || !existsSync('/bin/sh')) {
    console.warn('doc-press env proof SKIPPED — no POSIX shell for the launcher');
    return null;
  }
  try {
    return locateChromium();
  } catch (err) {
    console.warn(`doc-press env proof SKIPPED — no gnosis on this machine: ${err.message}`);
    return null;
  }
})();

// impure — the newest Playwright headless shell on this machine, or null.
const headlessShell = () => {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const newest = readdirSync(root).filter((name) => /^chromium_headless_shell-\d+$/.test(name))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
    const shell = newest && path.join(root, newest, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    return shell && existsSync(shell) ? shell : null;
  } catch {
    return null;
  }
};

// The browser locateChromium finds, and — where one is installed — the
// headless shell an operator points NEUMA_CHROMIUM_PATH at. The launcher's
// name carries `headless_shell` exactly when the real one does, so the press
// composes the same flags it would for that browser.
const BROWSERS = located
  ? [['the located browser', located], ...(headlessShell() ? [['the headless shell', headlessShell()]] : [])]
  : [];

// `env` output, one NAME=value per line (a continuation line of a multi-line
// value carries no NAME= head and is skipped).
const parseEnvDump = (raw) => Object.fromEntries(raw.split('\n').filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

describe.skipIf(!located)('the press\'s Chromium is handed no backend secret (real spawn, real browser)', () => {
  const prior = {};
  let scratch;

  beforeAll(async () => {
    scratch = await createTempDir('press-env');
    for (const key of [...Object.keys(SECRETS), 'NEUMA_CHROMIUM_PATH']) prior[key] = process.env[key];
    Object.assign(process.env, SECRETS);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test.each(BROWSERS)('%s: the child holds no secret, and the press still lands a real PDF', async (label, real) => {
    const tag = label.replace(/\W+/g, '-');
    const dump = path.join(scratch, `${tag}.env`);
    const launcher = path.join(scratch, real.includes('headless_shell') ? `${tag}-headless_shell` : `${tag}-chrome`);
    await fs.writeFile(launcher, `#!/bin/sh\nenv > '${dump}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
    process.env.NEUMA_CHROMIUM_PATH = launcher;

    const outputPath = path.join(scratch, `${tag}.pdf`);
    await pressDocument({ markdown: '# Env\n\nPRESSED_UNDER_A_CLEAN_ENV\n', title: 'env', outputPath });

    const env = parseEnvDump(await fs.readFile(dump, 'utf8'));
    for (const key of Object.keys(SECRETS)) expect(env).not.toHaveProperty(key);
    for (const value of Object.values(SECRETS)) expect(Object.values(env)).not.toContain(value);
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.PATH).toBeTruthy();
    const pdf = await fs.readFile(outputPath);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await pdfText(outputPath)).toContain('PRESSED_UNDER_A_CLEAN_ENV');
  }, 60_000);
});
