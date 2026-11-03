import { test, expect } from '@playwright/test';
import { openDockApp } from './helpers/dock.js';
import { setupDesk } from './helpers/desk-harness.js';

setupDesk();

test('SUBSTRATE: the operator can apply the share and relaunch from the context-pool card', async ({ page }) => {
  await openDockApp(page, 'SUBSTRATE');
  const card = page.locator('.sub-panel', { hasText: 'GPU SHARE · CONTEXT POOL' });
  await expect(card.getByRole('button', { name: 'APPLY & RELAUNCH' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'APPLY & RELAUNCH' })).toBeEnabled();
  await expect(card).toContainText('restarts the same model server now and refits its context pool');
  await expect(card).toContainText('generation must be idle');
  expect(page.__crashes, `JS crashes: ${page.__crashes.join(' | ')}`).toEqual([]);
});
