// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openDockApp } from './helpers/dock.js';
import { setupIsolatedHouse, openDesk, settledShot } from './helpers/isolated-house.js';

/**
 * End-to-end THE ENGINE BUTTONS ARE PERMISSIONS (2026-10-18) — in SETTINGS →
 * MODELS, a model folder's engine buttons say which engines may load from it.
 * Allowing an engine is one click; taking one away asks again, says what it
 * breaks, and changes nothing until the deliberate yes. (A single click once
 * took llama-server off the folder the house model lives in, and the desk
 * could no longer load it.) Real isolated stack with its OWN folder store
 * (NEUMA_MODEL_FOLDERS_PATH in the temp root — the operator's is never read
 * or written), real auth, real PUT/GET; no mocks. Shot: test/e2e/shots/model-folders-confirm.png
 */

const MEMBERS = [{ id: 'e2e-mf-one', name: 'Ashwren', utc: '2026-08-11T18:03:38.075Z' }];
const stack = setupIsolatedHouse(MEMBERS, 4931);
const FOLDER = '/opt/e2e-models';

test.use({ viewport: { width: 1400, height: 1000 } });

const stored = () => JSON.parse(fs.readFileSync(path.join(stack.root, 'model-folders.json'), 'utf8')).folders;

test('an engine is taken off a folder only by a deliberate, informed yes', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  const put = await fetch(`${stack.api}/api/v1/llm/model-folders`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${stack.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [{ path: FOLDER, servers: ['llama-server', 'lm-studio'] }] }),
  });
  expect(put.ok, `seed PUT ${put.status}`).toBe(true);

  await openDesk(page, stack, MEMBERS[0]);
  await openDockApp(page, 'SETTINGS');
  await page.getByRole('tab', { name: /MODELS/ }).click();
  const row = page.locator('.mf-folder', { hasText: FOLDER });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText('ENGINES ALLOWED');
  const llama = row.getByRole('button', { name: 'LLAMA-SERVER' });
  await expect(llama).toHaveAttribute('aria-pressed', 'true');

  // one click on an allowed engine only ASKS — nothing is saved
  await llama.click();
  const ask = page.getByRole('alertdialog');
  await expect(ask).toContainText(`LLAMA-SERVER WILL STOP LOADING MODELS FROM ${FOLDER}`);
  expect(stored()[0].servers).toEqual(['llama-server', 'lm-studio']);
  const win = page.locator('.fwin', { has: row });
  await win.locator('.fwin-bar').dblclick();
  await settledShot(win, 'model-folders-confirm');

  // KEEP IT ALLOWED — still allowed, still stored
  await ask.getByRole('button', { name: 'KEEP IT ALLOWED' }).click();
  await expect(ask).toHaveCount(0);
  await expect(llama).toHaveAttribute('aria-pressed', 'true');
  expect(stored()[0].servers).toEqual(['llama-server', 'lm-studio']);

  // the deliberate yes takes it away
  await llama.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'TURN IT OFF' }).click();
  await expect(llama).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => stored()[0].servers).toEqual(['lm-studio']);

  // allowing it again is one click — widening never needs asking
  await llama.click();
  await expect(llama).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => stored()[0].servers.includes('llama-server')).toBe(true);

  expect(crashes, crashes.join(' | ')).toEqual([]);
});
