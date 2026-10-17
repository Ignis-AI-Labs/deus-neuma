/* global window, sessionStorage */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';

test('social JSON clients preserve local draft/credential operations and report expiry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'social-client-http-'));
  const paths = {
    NEUMA_DATA_ROOT: 'data', WORKSPACES_ROOT: 'workspaces', AI_WITNESSES_ROOT: 'witnesses',
    NEUMA_SOCIAL_CREDENTIALS_PATH: 'credentials.json', NEUMA_SOCIAL_BINDINGS_PATH: 'bindings.json',
    NEUMA_SOCIAL_POST_QUEUE_PATH: 'queue.json', NEUMA_REPLY_CANDIDATES_PATH: 'replies.json',
    NEUMA_CMO_PATH: 'cmo.json', NEUMA_WEEKLY_PLAN_PATH: 'plan.json',
  };
  const secrets = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const keys = [...Object.keys(paths), ...secrets, 'DNA_ENCRYPTION_KEY'];
  const saved = keys.map(key => process.env[key]); let vite; let server; let browser;
  try {
    for (const [key, file] of Object.entries(paths)) process.env[key] = path.join(root, file);
    for (const key of secrets) delete process.env[key];
    process.env.DNA_ENCRYPTION_KEY = 'temporary-social-http-encryption';
    const { default: router } = await import('../../backend/routes/social-channel-routes.js');
    const { loadChannelCredentials } = await import('../../backend/services/social/channel-credentials.js');
    const auth = await fullAuth();
    const app = express(); app.use(express.json()); const requests = [];
    app.use('/api/v1/social-channels', (req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
    app.use('/api/v1/social-channels', router);
    vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite'),
      appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    app.get('/', (_req, res) => res.type('html').send('<script type="module">import * as clients from "/frontend/services/social-channels-client.js"; window.clients=clients; window.expired=0; window.addEventListener("neuma:auth_expired",()=>window.expired++);</script>'));
    app.use(vite.middlewares);
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.clients);
    const call = (name, ...args) => page.evaluate(async ({ name, args }) => {
      try { return { ok: true, value: await window.clients[name](...args) }; }
      catch (error) { return { ok: false, message: error.message, http: error.http }; }
    }, { name, args });
    expect(await call('getChannelBoard')).toMatchObject({ ok: false, message: 'Not authenticated.' });
    expect(requests).toEqual([]);
    await page.evaluate(token => sessionStorage.setItem('authToken', token), auth.token);
    expect((await call('getChannelBoard')).value.channels.find(channel => channel.id === 'x').configured).toBe(false);
    expect((await call('setChannelCredentials', 'telegram', { botToken: 'temporary-bot-token', chatId: 'temporary-chat' })).value.configured).toBe(true);
    expect((await loadChannelCredentials()).telegram.botToken).toBe('temporary-bot-token');
    expect(await fs.readFile(process.env.NEUMA_SOCIAL_CREDENTIALS_PATH, 'utf8')).not.toContain('temporary-bot-token');
    const text = 'Local draft: "quotes", & symbols, newline\nsecond line';
    const draft = (await call('stageQueuePost', { channelId: 'telegram', text })).value.entry;
    expect(draft).toMatchObject({ text, status: 'draft', queuedBy: auth.address });
    expect((await call('updateQueuePost', draft.id, { text: 'Edited local draft' })).value.entry).toMatchObject({ id: draft.id, status: 'draft', text: 'Edited local draft' });
    expect((await call('getPostQueue')).value.queue.find(entry => entry.id === draft.id).text).toBe('Edited local draft');
    expect((await call('rejectQueuePost', draft.id)).value.entry.status).toBe('rejected');
    expect((await call('removeQueuePost', draft.id)).ok).toBe(true);
    expect((await call('getPostQueue')).value.queue).toEqual([]);
    expect((await call('clearChannelCredentials', 'telegram')).ok).toBe(true);
    expect((await loadChannelCredentials()).telegram).toBeUndefined();
    expect(await call('clearChannelCredentials', 'absent-channel')).toEqual({ ok: false, message: 'Unknown channel: absent-channel', http: 404 });
    const before = await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8');
    await page.evaluate(() => sessionStorage.setItem('authToken', 'expired-invalid-token'));
    expect(await call('getChannelBoard')).toMatchObject({ ok: false, http: 401 });
    expect(await call('getPostQueue')).toMatchObject({ ok: false, http: 401 });
    expect(await page.evaluate(() => window.expired)).toBe(2);
    expect(await fs.readFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, 'utf8')).toBe(before);
    expect(requests.some(request => /approve|flight-test|publish/.test(request))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await vite?.close(); keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30000);
