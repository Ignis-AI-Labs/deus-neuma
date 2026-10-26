/**
 * THE SPELLCHECK DICTIONARY IS NOT FETCHED UNTIL THE PERSON TURNS IT ON (CONNECTIONS, Founder
 * 2026-10-25). In a REAL Electron on a fresh profile, the app's own registerConnections: switched
 * off, typing misspelled words asks Google for nothing (no download event, no dictionary on disk,
 * no language set); switched on through the panel's real IPC knock, the download begins. Nothing is
 * mocked. (A disabled spellchecker alone still downloads — that is why off is an empty language list.)
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { expect, test } from 'vitest';

const dictionaries = async (profile) => (await fs.readdir(path.join(profile, 'Dictionaries')).catch(() => [])).filter((f) => f.endsWith('.bdic'));

test('off asks nothing; the knock after turning it on starts the download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spellcheck-switch-'));
  const profile = path.join(root, 'profile');
  const switches = path.join(root, 'connections.json');
  await fs.writeFile(switches, '{}');
  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['--disable-gpu', fileURLToPath(new URL('../fixtures/spellcheck-switch-main.cjs', import.meta.url))],
      env: { ...process.env, SPELL_TEST_PROFILE: profile, NEUMA_CONNECTIONS_PATH: switches },
    });
    const page = await app.firstWindow();
    await page.waitForSelector('#t', { state: 'attached' });
    await page.focus('#t');
    await page.keyboard.type('helo wrold thsi is mispeled ');
    await page.waitForTimeout(8000);
    expect(await app.evaluate(() => global.spellEvents)).toEqual([]);
    expect(await app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages())).toEqual([]);
    expect(await dictionaries(profile)).toEqual([]);

    await fs.writeFile(switches, JSON.stringify({ spellcheck: true }));
    expect(await page.evaluate(() => window.knock())).toEqual({ ok: true, spellcheck: true });
    const languages = await app.evaluate(({ session }) => session.defaultSession.getSpellCheckerLanguages());
    expect(languages.length).toBeGreaterThan(0);
    await page.keyboard.type(' agian');
    await expect.poll(() => app.evaluate(() => global.spellEvents), { timeout: 30_000 }).toContain(`begin:${languages[0]}`);
  } finally {
    await app?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 90_000);
