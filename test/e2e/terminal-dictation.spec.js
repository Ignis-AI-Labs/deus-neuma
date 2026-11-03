// @ts-check
/* global fetch, Buffer */
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { setupPerfStack, initPerfSession, perf } from './helpers/perf-harness.js';
import { passDeskGates } from './helpers/desk-gates.js';
import { ownerClaimHeaders } from './helpers/owner-claim.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { openDockApp } from './helpers/dock.js';

// Real speech through Chromium's capture device and the real Whisper engine.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-dictation-'));
const SPEECH_WAV = path.join(fixtureDir, 'speech.wav');
execSync(`espeak-ng -s 135 -g 1 -w ${SPEECH_WAV} "hello terminal this is a dictation test"`);
const wav = fs.readFileSync(SPEECH_WAV);
const padded = Buffer.concat([wav, Buffer.alloc(wav.readUInt32LE(28))]);
padded.writeUInt32LE(padded.length - 8, 4);
padded.writeUInt32LE(padded.length - 44, 40);
fs.writeFileSync(SPEECH_WAV, padded);

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});
const whisperPort = await freePort();
setupPerfStack({ env: { WHISPER_FORCE_CPU: '1', WHISPER_HOST: '127.0.0.1', WHISPER_PORT: String(whisperPort) } });
test.use({
  channel: 'chromium',
  launchOptions: { args: [
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${SPEECH_WAV}%noloop`,
    '--use-fake-ui-for-media-stream',
  ] },
  permissions: ['microphone'],
  viewport: { width: 1600, height: 900 },
});

test.beforeAll(async () => {
  const wallet = ethers.Wallet.createRandom();
  const { challenge } = await (await fetch(`${perf.BASE}/api/v1/auth/challenge?address=${wallet.address}`)).json();
  const signature = await wallet.signMessage(challenge);
  const verified = await fetch(`${perf.BASE}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ownerClaimHeaders(path.join(perf.root, 'data')) },
    body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  const { token } = await verified.json();
  if (!token) throw new Error('terminal test wallet did not authenticate');
  perf.token = token;
  perf.addr = wallet.address;
  await claimOwner(perf.root, 'e2e-perf', wallet.address);
});

test.afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.__crashes = errors;
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/?test=1`);
  await passDeskGates(page, 10000);
});

const openShell = async (page) => {
  await openDockApp(page, 'TERMINAL');
  const win = page.locator('.fwin', { has: page.locator('.terminal-stage') }).first();
  await expect(win.locator('.xterm')).toBeVisible({ timeout: 20000 });
  await expect(win.locator('.terminal-stage')).toContainText(/[$#%>~@]/, { timeout: 20000 });
  return win;
};

const holdMic = async (page, milliseconds = 2200) => {
  const mic = page.locator('.terminal-dictate');
  await mic.hover();
  await page.mouse.down();
  await expect(mic).toHaveClass(/is-recording/);
  await page.waitForTimeout(milliseconds);
  await page.mouse.up();
  await expect(mic).not.toHaveClass(/is-recording/, { timeout: 120000 });
};

test('early terminal input is queued until the real PTY is ready', async ({ page }) => {
  const win = await openShell(page);
  await win.locator('.xterm').click();
  await page.keyboard.type('echo QUEUE_PROOF');
  await page.keyboard.press('Enter');
  await expect(win.locator('.terminal-stage')).toContainText('QUEUE_PROOF', { timeout: 15000 });
  expect(page.__crashes).toEqual([]);
});

test('pointer-held dictation lands as editable shell input and never auto-executes', async ({ page }) => {
  const win = await openShell(page);
  await holdMic(page);
  await expect(win.locator('.terminal-stage')).toContainText(/dictation/i, { timeout: 120000 });
  expect(await win.locator('.terminal-stage').innerText()).not.toContain('command not found');

  await win.locator('.xterm').click();
  await page.keyboard.type('; echo DICTATION_EDIT_OK');
  await page.keyboard.press('Enter');
  await expect(win.locator('.terminal-stage')).toContainText('DICTATION_EDIT_OK', { timeout: 15000 });
  expect(page.__crashes).toEqual([]);
});

test('a Space tap types a space; a held Space dictates without auto-executing', async ({ page }) => {
  const win = await openShell(page);
  const mic = page.locator('.terminal-dictate');
  await win.locator('.xterm').click();
  await page.keyboard.press('Space');
  await expect(mic).not.toHaveClass(/is-recording/);

  await page.keyboard.down('Space');
  await expect(mic).toHaveClass(/is-recording/);
  await page.waitForTimeout(2200);
  await page.keyboard.up('Space');
  await expect(mic).not.toHaveClass(/is-recording/, { timeout: 120000 });
  await expect(win.locator('.terminal-stage')).toContainText(/dictation/i, { timeout: 120000 });
  expect(await win.locator('.terminal-stage').innerText()).not.toContain('command not found');
  expect(page.__crashes).toEqual([]);
});
