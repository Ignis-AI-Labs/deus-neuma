/** No mocks: signed authentication, filesystem history and Chromium HTTP reads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { chromium, expect as browserExpect } from '@playwright/test';
import { createChatSearchKit } from '../helpers/chat-search-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { findChatExcerpt } from '../../backend/services/chat-content-search.js';

let kit;
beforeAll(async () => { kit = await createChatSearchKit(); }, 30000);
afterAll(async () => { await kit?.close(); });
const search = async (query, lane = 'search-one', token = kit.token) => {
  const response = await globalThis.fetch(`${kit.url}/api/v1/workspace/${lane}/session-search?q=${encodeURIComponent(query)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
};

test('searches full history past the display tail, literal phrases, and archived messages', async () => {
  const raw = await fs.readFile(path.join(workspace.pathFor('search-one'), 'sessions', 'session-100.jsonl'), 'utf8');
  expect(raw).not.toContain('Violet telescope');
  const found = await search('VIOLET   telescope');
  expect(found.status).toBe(200);
  expect(found.body.matches).toEqual([{ id: 'session-100', role: 'user', excerpt: 'We discussed a Violet telescope for the mountain observatory.' }]);
  expect((await search('picnic lunch')).body.matches[0]).toMatchObject({ id: 'session-200', role: 'assistant' });
  expect((await search('[.*]')).body.matches).toHaveLength(1);
  expect((await search('forgotten observatory')).body.matches[0]).toMatchObject({ id: 'session-400' });
  expect((await search('not present anywhere')).body.matches).toEqual([]);
  expect((await search('   ')).body.matches).toEqual([]);
});

test('requires authentication and ownership, and validates bounded queries', async () => {
  expect((await search('telescope', 'search-one', null)).status).toBe(401);
  expect((await search('telescope', 'search-private')).status).toBe(403);
  expect((await search('x'.repeat(201))).status).toBe(400);
  const repeated = await globalThis.fetch(`${kit.url}/api/v1/workspace/search-one/session-search?q=a&q=b`, { headers: { Authorization: `Bearer ${kit.token}` } });
  expect(repeated.status).toBe(400);
});

test('surfaces unreadable history rather than reporting an empty result', async () => {
  const file = path.join(workspace.pathFor('search-two'), 'sessions', 'session-broken.jsonl');
  await fs.writeFile(file, `${JSON.stringify({ role: 'user', content: 'intact legacy row' })}\nbroken ciphertext\n`);
  expect(await workspace.readSession('search-two', 'session-broken')).toContainEqual({ role: 'user', content: 'intact legacy row' });
  try { expect((await search('sailing', 'search-two')).status).toBe(500); }
  finally { await fs.rm(file); }
  const archive = path.join(workspace.pathFor('search-two'), 'archive', 'session-500');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.writeFile(archive, 'not a directory');
  try { expect((await search('unmatched', 'search-two')).status).toBe(500); }
  finally { await fs.rm(archive); }
});

test('matches visible speech only and bounds excerpts around the match', () => {
  expect(findChatExcerpt([{ role: 'system', content: 'hidden' }], 'hidden')).toBeNull();
  expect(findChatExcerpt([{ role: 'assistant', content: 'Read [TOOL: fs/read {"path":"hidden-payload"}] done' }], 'hidden-payload')).toBeNull();
  const rows = [
    { role: 'user', turnId: 'turn-1', content: 'question' },
    { role: 'assistant', turnId: 'turn-1', takeIndex: 1, content: 'discarded answer' },
    { role: 'assistant', turnId: 'turn-1', takeIndex: 2, content: 'chosen answer' },
  ];
  expect(findChatExcerpt(rows, 'discarded')).toBeNull();
  expect(findChatExcerpt(rows, 'chosen')?.excerpt).toBe('chosen answer');
  const hit = findChatExcerpt([{ role: 'user', content: `${'a'.repeat(1000)} needle ${'z'.repeat(1000)}` }], 'needle');
  expect(hit.excerpt).toContain('needle');
  expect(hit.excerpt.length).toBeLessThan(200);
});

test('shared browser search finds body text and titles, clears, changes lanes, and recovers offline', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  try {
    const context = await browser.newContext();
    await context.addInitScript((token) => globalThis.sessionStorage.setItem('authToken', token), kit.token);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(kit.url);
    const input = page.getByRole('searchbox', { name: 'Search chat titles and messages' });
    const rows = page.locator('li[data-session]');
    await browserExpect(rows).toHaveCount(4);
    await input.fill('violet telescope');
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows).toContainText('Weekend ideas');
    await browserExpect(rows).toContainText('Violet telescope');
    await input.fill('Food plans');
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows).toContainText('Food plans');
    await input.fill('');
    await browserExpect(rows).toHaveCount(4);
    await input.fill('forgotten observatory');
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows).toContainText('copper shutters');
    await input.fill('<img');
    await browserExpect(rows).toContainText('<img src=x onerror=alert(1)>');
    await browserExpect(page.locator('img')).toHaveCount(0);
    await input.fill('telescope');
    await page.getByRole('button', { name: 'Second participant' }).click();
    await browserExpect(page.getByRole('status')).toHaveCount(0);
    await browserExpect(rows).toHaveCount(0);
    await input.fill('sailing');
    await browserExpect(rows).toHaveCount(1);
    await browserExpect(rows).toContainText('sailing');
    await context.setOffline(true);
    await input.fill('different query');
    await browserExpect(page.getByRole('alert')).toBeVisible();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Retry search' }).click();
    await browserExpect(page.getByRole('alert')).toHaveCount(0);
    await browserExpect(page.getByRole('status')).toHaveCount(0);
    await input.fill('');
    await browserExpect(rows).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
