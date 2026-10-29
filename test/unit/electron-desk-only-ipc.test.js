// THE RECOVERY KIT AND UPDATE DOORS ANSWER THE DESK ONLY (re-audit 2026-10-29, M-07 residual). Every
// desk IPC channel checked its sender's frame (fromDesk) except the key lock's — whose revealKit
// hands out the code that opens every key — and the update bar's. Here the REAL registrations run
// against Electron's handler registry (the transport edge, held as a plain map) and are invoked
// with events shaped exactly as Electron delivers them: the desk's own top frame, a frame inside
// the page, and another origin. The real fromDesk judges. No mocks on the claimed path (RULE 0).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fromDesk } = require('../../electron/desk-links.cjs');
const { registerKeyLockIpc } = require('../../electron/key-lock/key-lock-main.cjs');
const { registerUpdateBar } = require('../../electron/update-bar.cjs');

const DESK = 'http://127.0.0.1:47317';
const isDesk = (event) => fromDesk(event, DESK);
const desk = { senderFrame: { url: `${DESK}/`, parent: null } };
const framed = { senderFrame: { url: `${DESK}/`, parent: {} } };
const foreign = { senderFrame: { url: 'https://evil.example/', parent: null } };

// impure — the registry Electron keeps: channel → the handler the app registered
const registry = () => {
  const handlers = new Map();
  return { handlers, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) } };
};

describe('the key lock\'s Recovery Kit doors', () => {
  const { handlers, ipcMain } = registry();
  registerKeyLockIpc({ ipcMain, safeStorage: {}, isDesk });

  it.each(['keyLock:status', 'keyLock:revealKit', 'keyLock:confirmKit', 'keyLock:newKit'])('%s refuses a frame inside the page and another origin', async (channel) => {
    for (const event of [framed, foreign, {}]) {
      await expect(async () => handlers.get(channel)(event)).rejects.toThrow(/not the desk/);
    }
  });

  it('the desk\'s own top frame is answered', async () => {
    expect(await handlers.get('keyLock:status')(desk)).toMatchObject({ active: false });
    expect(await handlers.get('keyLock:revealKit')(desk)).toEqual({ ok: false, error: 'This launch has no keychain lock.' });
  });
});

describe('the update bar', () => {
  const { handlers, ipcMain } = registry();
  const app = { getVersion: () => '0.1.89', getPath: () => '/nonexistent', getAppPath: () => '/nonexistent', isPackaged: false };
  registerUpdateBar({ ipcMain, BrowserWindow: { getAllWindows: () => [] }, shell: {}, app, autoUpdate: { updateOffer: () => null }, isDesk, launch: false });

  it.each(['update:state', 'update:act'])('%s refuses anything but the desk\'s top frame, and answers the desk', async (channel) => {
    for (const event of [framed, foreign]) {
      await expect(async () => handlers.get(channel)(event, 'seen')).rejects.toThrow(/not the desk/);
    }
    await expect(Promise.resolve(handlers.get(channel)(desk, 'nope'))).resolves.toBeTruthy();
  });
});
