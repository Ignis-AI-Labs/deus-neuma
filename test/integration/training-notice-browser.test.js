/* global window, document, sessionStorage, localStorage */
// The training notice:
// every door that connects a provider outside the operator's custody tells
// them to turn off training on their data; sovereign doors say nothing. Real
// browser, real signed routing API, the real provider catalog, the real i18n
// engine — on all four doors: Settings → Models, the harness door's cloud
// road, the witness door, and the WITNESSES app's account-access step.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import routingRouter from '../../backend/routes/routing-routes.js';
import { fullAuth } from '../helpers/audit-auth.js';

const ENV = ['NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_CONNECTIONS_PATH', 'DNA_ENCRYPTION_KEY'];
const at = (file) => JSON.stringify(path.resolve(file));

test('every non-sovereign provider door carries the training notice; sovereign doors carry none', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'training-notice-'));
  const saved = ENV.map((name) => process.env[name]);
  let server; let browser;
  try {
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(root, 'connections.json');
    process.env.DNA_ENCRYPTION_KEY = 'temporary-training-notice-encryption';
    const auth = await fullAuth();
    const entryId = 'virtual:training-notice-proof';
    const source = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import i18next from 'i18next';
      import ${at('frontend/i18n/index.js')};
      import { listProviders } from ${at('frontend/services/routing.js')};
      import { ModelsSection } from ${at('frontend/app/RelinkShell/ModelsSection.jsx')};
      import { WitnessProviderAccess } from ${at('frontend/app/RelinkShell/WitnessProviderPanels.jsx')};
      import { FirstRunHarness } from ${at('frontend/app/FirstRunChoice/FirstRunHarness.jsx')};
      import { FirstRunWitness } from ${at('frontend/app/FirstRunChoice/FirstRunWitness.jsx')};
      const root = createRoot(document.getElementById('root'));
      const noop = () => {};
      window.i18n = i18next;
      window.mount = {
        models: () => root.render(React.createElement(ModelsSection)),
        harness: () => root.render(React.createElement(FirstRunHarness, { onDone: noop, onBack: noop })),
        witnessDoor: () => root.render(React.createElement(FirstRunWitness, { onDone: noop, onBack: noop })),
        access: async (id) => {
          const provider = (await listProviders()).providers.find((p) => p.id === id);
          root.render(React.createElement(WitnessProviderAccess, {
            key: id, provider, credentialReady: false, apiKey: '', endpoint: '', busy: false,
            onApiKey: noop, onEndpoint: noop, onSave: noop, onProvidersChanged: noop,
          }));
          return provider.name;
        },
      };
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error',
      esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'training-notice-proof', resolveId: (id) => (id === entryId ? id : null),
        load: (id) => (id === entryId ? source : null) }],
      build: { write: false, rollupOptions: { input: entryId } } });
    const app = express(); app.use(express.json());
    app.use('/api/v1/routing', routingRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) =>
      res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    browser = await chromium.launch({ args: ['--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mount);
    await page.evaluate(({ token, address }) => {
      sessionStorage.setItem('authToken', token); localStorage.setItem('walletAddress', address);
    }, { token: auth.token, address: auth.address });
    const notice = page.getByTestId('training-notice');
    const says = async (name) => {
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('TURN OFF TRAINING ON YOUR DATA');
      await expect(notice).toContainText(`Anything you send to ${name} leaves your machine.`);
      await expect(notice).toContainText('train their models');
    };

    // 1. Settings → Models: cloud rows warn, the machine's own servers do not
    await page.evaluate(() => window.mount.models());
    const row = (name) => page.locator('.settings-provider-row').filter({ has: page.locator('code', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
    await row('OpenAI').click(); await says('OpenAI');
    await row('Ollama').click(); await expect(notice).toHaveCount(0);
    await row('xAI (Grok)').click(); await says('xAI (Grok)');
    await row('llama-server').click(); await expect(notice).toHaveCount(0);
    await row('LM Studio').click(); await expect(notice).toHaveCount(0);
    await row('Anthropic').click(); await says('Anthropic');

    // the notice speaks the operator's language
    await page.evaluate(() => window.i18n.changeLanguage('zh'));
    await expect(notice).toContainText('关闭用你的数据训练');
    await expect(notice).toContainText('你发送给 Anthropic 的任何内容都会离开你的机器');
    await page.evaluate(() => window.i18n.changeLanguage('en'));
    await says('Anthropic');

    // 2. The harness door: the cloud road warns as soon as a provider is chosen; the local road never
    await page.evaluate(() => window.mount.harness());
    await page.getByRole('radio', { name: /A cloud provider/ }).click();
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', { name: 'Harness provider' }).click();
    await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
    await says('Anthropic');
    await page.getByRole('radio', { name: /On this machine/ }).click();
    await expect(notice).toHaveCount(0);

    // 3. The witness door
    await page.evaluate(() => window.mount.witnessDoor());
    await page.getByRole('button', { name: 'CONTINUE' }).click();
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', { name: 'Witness provider' }).click();
    await page.getByRole('option', { name: 'xAI (Grok)', exact: true }).click();
    await says('xAI (Grok)');

    // 4. The WITNESSES app's account-access step, Kimi's own catalog record — and
    // the component's law holds even if a sovereign record ever reached it
    await says(await page.evaluate(() => window.mount.access('moonshotai')));
    await page.evaluate(() => window.mount.access('llama-server'));
    await expect(page.getByText('ACCOUNT ACCESS')).toBeVisible();
    await expect(notice).toHaveCount(0);

    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    ENV.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    await fs.rm(root, { recursive: true, force: true });
  }
}, 90_000);
