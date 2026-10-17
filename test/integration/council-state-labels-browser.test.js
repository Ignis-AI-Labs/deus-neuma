import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';

// Actual presentation and CSS with real input states; no council execution or model.
test('council hand and turn states remain readable without color or animation', async () => {
  let server; let browser;
  try {
    const entryId = 'virtual:council-labels.jsx';
    const file = name => JSON.stringify(path.resolve(`frontend/${name}`));
    const source = `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {CouncilSeat,CouncilSpeaking} from ${file('app/RelinkShell/CouncilSeat.jsx')};
      import ${file('styles/tokens.css')};
      import ${file('app/RelinkShell/CouncilRoom-strip.css')};
      import ${file('app/RelinkShell/CouncilRoom-transcript.css')};
      function Page(){const [hand,setHand]=useState('rest'); return <>
        <ul className="council-members">
          <CouncilSeat name="Standby" hand="rest" />
          <CouncilSeat name="Queued" hand="hold" order={2} />
          <CouncilSeat name="Requesting" hand="open" order={1} />
          <CouncilSeat name="Thinking" hand="rest" considering />
          <CouncilSeat name="Floor" hand="open" holdsFloor />
          <CouncilSeat name="Witness" hand={hand} external />
        </ul><button onClick={()=>setHand('hold')}>Raise hand</button>
        <p id="speaking"><CouncilSpeaking /></p><p id="pending"><CouncilSpeaking pending /></p>
      </>; } createRoot(document.getElementById('root')).render(<Page/>);`;
    const bundle = await build({ configFile: false, logLevel: 'error', esbuild: { jsx: 'automatic', loader: 'jsx' },
      plugins: [{ name: 'council-labels', resolveId: id => id === entryId ? id : null,
        load: id => id === entryId ? source : null }], build: { write: false, rollupOptions: { input: entryId } } });
    const app = express();
    for (const asset of bundle.output) app.get(`/${asset.fileName}`, (_req, res) =>
      res.type(path.extname(asset.fileName)).send(asset.type === 'chunk' ? asset.code : asset.source));
    const entry = bundle.output.find(asset => asset.type === 'chunk' && asset.isEntry).fileName;
    const styles = bundle.output.filter(asset => asset.fileName.endsWith('.css')).map(asset => `<link rel="stylesheet" href="/${asset.fileName}">`).join('');
    app.get('/', (_req, res) => res.type('html').send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addStyleTag({ content: '* { color: black !important; background: white !important; animation: none !important; }' });
    for (const [name, status] of [['Standby','STANDBY'],['Queued','HOLD'],['Requesting','OPEN'],['Thinking','CONSIDERING'],['Floor','THE FLOOR'],['Witness','STANDBY']]) {
      const seat = page.getByRole('listitem').filter({ has: page.locator('.council-member-name').filter({ hasText: new RegExp(`^${name}$`) }) });
      await expect(seat.getByText(status, { exact: true })).toBeVisible();
      expect(await seat.ariaSnapshot()).toContain(status);
      await expect(seat.locator('.council-member-mark')).toHaveAttribute('aria-hidden', 'true');
    }
    await expect(page.getByText('2', { exact: true })).toHaveAttribute('title', '2 in line');
    await expect(page.getByText('1', { exact: true })).toHaveAttribute('title', 'Next to speak');
    const witness = page.getByRole('listitem').filter({ hasText: 'Witness' });
    await expect(witness).toHaveAttribute('title', /sealed witness, standing beside this house/);
    await page.getByRole('button', { name: 'Raise hand' }).click();
    await expect(witness.getByText('HOLD', { exact: true })).toBeVisible();
    for (const [id, label] of [['speaking','SPEAKING'],['pending','ABOUT TO SPEAK']]) {
      const state = page.locator(`#${id}`);
      await expect(state.getByText(label, { exact: true })).toBeVisible();
      expect(await state.ariaSnapshot()).toContain(label);
      await expect(state.locator('.council-turn-speaking')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(errors).toEqual([]);
  } finally {
    await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
}, 30_000);
