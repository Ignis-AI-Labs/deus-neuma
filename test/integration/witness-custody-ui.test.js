/* global window, sessionStorage */
// Real production panel/dialog, signed custody API and crypto; metadata fixtures, no seal/model.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import express from 'express';
import { build } from 'vite';
import { chromium, expect } from '@playwright/test';
import { test } from 'vitest';
import { getWitnessesRoot, setWitnessesRoot } from '../../core/index.js';
import { getAIWitnessesRoot, setAIWitnessesRoot, writePlaintextKeypair, readPlaintextKeypair, readEncryptedKeypair, keyDir } from '../../core/identity/ai-witness/ai-witness-service.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { decryptKeypair, decryptWithRecoveryCodes } from '../../core/wallet/keypair-vault.js';
import { witnessCustodyState } from '../../backend/services/witness-custody.js';
import witnessesRouter from '../../backend/routes/witness-routes.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('custody panel shows roster state and secures through real auth with recoverable codes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'custody-ui-'));
  const oldRoots = [getWitnessesRoot(), getAIWitnessesRoot()];
  let server; let browser; let release;
  try {
    setWitnessesRoot(path.join(root, 'lanes')); setAIWitnessesRoot(path.join(root, 'identities'));
    const auth = await fullAuth(); const stranger = await fullAuth(); const keypair = generateKeypair();
    const vendor = 'custody-ui'; const name = 'MetadataOnly'; const laneId = `witness-${vendor}-${name}`;
    await writePlaintextKeypair(vendor, name, keypair);
    const home = path.join(getAIWitnessesRoot(), vendor, name);
    // Reproduce an old install's permissive key, not just a freshly-private one.
    const legacyKeys = keyDir(vendor, name);
    await fs.chmod(legacyKeys, 0o755);
    await fs.chmod(path.join(legacyKeys, 'keypair.json'), 0o644);
    const unrelated = path.join(legacyKeys, 'legacy-note.txt');
    await fs.writeFile(unrelated, 'preserve this historical note');
    await fs.writeFile(path.join(home, 'dna.json'), JSON.stringify({
      substrate: { vendor, model: 'offline' }, witness: { witnessWallet: keypair.address },
      genesisSeal: { record: {}, genesisHash: `sha256:${'a'.repeat(64)}` }, capturedAt: '2026-09-10T00:00:00Z',
    }));
    const lane = path.join(getWitnessesRoot(), laneId); await fs.mkdir(lane, { recursive: true });
    await fs.writeFile(path.join(lane, 'lane.json'), JSON.stringify({ kind: 'witness', vendorSlug: vendor, chosenName: name }));
    await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet: auth.address }));
    const id = 'virtual:custody-ui.jsx';
    const source = `
      import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
      import { WitnessProviderWitness } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WitnessProviderPanels.jsx'))};
      import { WitnessCustodyDialog } from ${JSON.stringify(path.resolve('frontend/app/RelinkShell/WitnessCustodyDialog.jsx'))};
      import { listWitnesses } from ${JSON.stringify(path.resolve('frontend/services/witnesses-client.js'))};
      import ${JSON.stringify(path.resolve('frontend/styles/tokens.css'))};
      import { witnessCustodyLabel } from ${JSON.stringify(path.resolve('frontend/services/witness-custody-client.js'))};
      window.custodyLabel = witnessCustodyLabel;
      function Panel() {
        const [witnesses, setWitnesses] = useState([]); const [target, setTarget] = useState(null);
        const reload = async () => setWitnesses((await listWitnesses()).witnesses);
        window.reloadRoster = reload;
        return <><WitnessProviderWitness provider={{name:'Custody proof'}} witnesses={witnesses}
          selected={witnesses[0]} witnessModel="" onSecure={setTarget} />
          {target && <WitnessCustodyDialog witness={target} onClose={() => setTarget(null)} onSecured={reload} />}</>;
      }
      createRoot(document.getElementById('root')).render(<Panel />);
    `;
    const bundle = await build({ configFile: false, root: process.cwd(), logLevel: 'error', esbuild: { jsx: 'automatic' },
      plugins: [{ name: 'custody-ui', resolveId: (value) => value === id ? value : null, load: (value) => value === id ? source : null }],
      build: { write: false, rollupOptions: { input: id } } });
    const app = express(); app.use(express.json());
    let hold = false; let observed;
    app.use('/api/v1/witnesses', async (req, _res, next) => {
      if (hold && req.method === 'POST') {
        hold = false;
        const barrier = new Promise((resolve) => { release = resolve; });
        observed(); await barrier;
      }
      next();
    });
    app.use('/api/v1/witnesses', witnessesRouter);
    for (const file of bundle.output) app.get(`/${file.fileName}`, (_req, res) => res.type(path.extname(file.fileName)).send(file.type === 'chunk' ? file.code : file.source));
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry).fileName;
    const styles = bundle.output.filter((file) => file.fileName.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/${file.fileName}">`).join('');
    app.get('/', (_req, res) => res.send(`${styles}<div id="root"></div><script type="module" src="/${entry}"></script>`));
    server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ args: ['--disable-gpu'] }); const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.reloadRoster);
    await page.evaluate(async (token) => { sessionStorage.setItem('authToken', token); await window.reloadRoster(); }, auth.token);
    expect(await page.evaluate(() => [window.custodyLabel(null), window.custodyLabel(undefined),
      window.custodyLabel({ secured: true, plaintextOnDisk: true })])).toEqual(['CUSTODY UNKNOWN', 'CUSTODY UNKNOWN', 'KEY IN PLAINTEXT']);
    await expect(page.getByRole('tab')).toContainText('KEY IN PLAINTEXT');
    await page.getByRole('button', { name: 'SECURE KEY', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    expect(await readPlaintextKeypair(vendor, name)).toEqual(keypair);
    await page.getByRole('button', { name: 'SECURE KEY', exact: true }).click();
    const password = 'temporary-custody-password';
    await dialog.getByLabel('Custody password (at least 12 characters)', { exact: true }).fill('short');
    await dialog.getByLabel('Confirm custody password', { exact: true }).fill('short');
    await expect(dialog.getByRole('button', { name: 'SECURE KEY', exact: true })).toBeDisabled();
    await dialog.getByLabel('Custody password (at least 12 characters)', { exact: true }).fill(password);
    await dialog.getByLabel('Confirm custody password', { exact: true }).fill(password);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), stranger.token);
    await dialog.getByRole('button', { name: 'SECURE KEY', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('This witness lane belongs to another wallet');
    expect(await readPlaintextKeypair(vendor, name)).toEqual(keypair);
    await page.evaluate((token) => sessionStorage.setItem('authToken', token), auth.token);
    hold = true; const seen = new Promise((resolve) => { observed = resolve; });
    await dialog.getByRole('button', { name: 'SECURE KEY', exact: true }).click(); await seen;
    await expect(dialog.getByRole('button', { name: 'SECURING…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'CANCEL' })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    release();
    await expect(dialog.locator('[data-recovery-code]').first()).toBeVisible();
    const codes = await dialog.locator('[data-recovery-code]').allTextContents();
    expect(await readPlaintextKeypair(vendor, name)).toBeNull();
    expect(decryptKeypair(await readEncryptedKeypair(vendor, name), password).privateKey).toBe(keypair.privateKey);
    const recovery = JSON.parse(await fs.readFile(path.join(keyDir(vendor, name), 'keypair-recovery.json'), 'utf8'));
    expect(decryptWithRecoveryCodes(recovery, codes).privateKey).toBe(keypair.privateKey);
    await expect(dialog.getByRole('button', { name: 'DONE' })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'DONE' }).click();
    await expect(dialog).toHaveCount(0); await expect(page.getByRole('tab')).toContainText('KEY SECURED');
    await expect(page.getByRole('button', { name: 'SECURE KEY', exact: true })).toHaveCount(0);
    // The confirmed retrofit survives a fresh page; both private envelopes
    // replace the readable key while unrelated legacy state remains untouched.
    await page.reload(); await page.waitForFunction(() => window.reloadRoster);
    await page.evaluate(() => window.reloadRoster());
    await expect(page.getByRole('tab')).toContainText('KEY SECURED');
    if (process.platform !== 'win32') {
      for (const file of ['keypair-encrypted.json', 'keypair-recovery.json', 'recovery-hash.json']) {
        expect((await fs.stat(path.join(legacyKeys, file))).mode & 0o777).toBe(0o600);
      }
      // This act custodies the key, not a silent whole-tree permission migration.
      expect((await fs.stat(legacyKeys)).mode & 0o777).toBe(0o755);
    }
    expect(await fs.readFile(unrelated, 'utf8')).toBe('preserve this historical note');
    // An unreadable plaintext record is not evidence that the plaintext is gone.
    const plainPath = path.join(keyDir(vendor, name), 'keypair.json');
    const encryptedPath = path.join(keyDir(vendor, name), 'keypair-encrypted.json');
    const encryptedBytes = await fs.readFile(encryptedPath, 'utf8');
    await fs.writeFile(plainPath, '{');
    await page.evaluate(() => window.reloadRoster());
    await expect(page.getByRole('tab')).toContainText('CUSTODY UNKNOWN');
    await expect(witnessCustodyState({ vendorSlug: vendor, chosenName: name })).rejects.toThrow();
    expect(await fs.readFile(plainPath, 'utf8')).toBe('{');
    expect(await fs.readFile(encryptedPath, 'utf8')).toBe(encryptedBytes);
    await fs.unlink(plainPath);
    await fs.writeFile(encryptedPath, '{');
    await expect(witnessCustodyState({ vendorSlug: vendor, chosenName: name })).rejects.toThrow();
    await page.evaluate(() => window.reloadRoster());
    await expect(page.getByRole('tab')).toContainText('CUSTODY UNKNOWN');
    expect(await fs.readFile(encryptedPath, 'utf8')).toBe('{');
    for (const bytes of ['null', '{}', '[]', 'true', '"not an envelope"']) {
      await fs.writeFile(encryptedPath, bytes);
      await page.evaluate(() => window.reloadRoster());
      await expect(page.getByRole('tab')).toContainText('CUSTODY UNKNOWN');
      expect(await fs.readFile(encryptedPath, 'utf8')).toBe(bytes);
    }
    await fs.writeFile(encryptedPath, encryptedBytes);
    await fs.writeFile(plainPath, 'null');
    await page.evaluate(() => window.reloadRoster());
    await expect(page.getByRole('tab')).toContainText('CUSTODY UNKNOWN');
    await fs.unlink(plainPath);
    await fs.unlink(path.join(keyDir(vendor, name), 'recovery-hash.json'));
    await page.evaluate(() => window.reloadRoster());
    await expect(page.getByRole('tab')).toContainText('CUSTODY UNKNOWN');
    expect(errors).toEqual([]);
  } finally {
    release?.(); await browser?.close(); server?.closeAllConnections();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    setWitnessesRoot(oldRoots[0]); setAIWitnessesRoot(oldRoots[1]); await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
