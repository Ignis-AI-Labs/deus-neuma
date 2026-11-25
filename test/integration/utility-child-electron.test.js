import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron');

const CHILD_SOURCE = `
const { installUtilityProcessCompat } = require(${JSON.stringify(path.join(ROOT, 'electron/utility-process-compat.cjs'))});
installUtilityProcessCompat();
process.send({ type: 'ready', electron: process.versions.electron, runAsNode: process.env.ELECTRON_RUN_AS_NODE || null });
process.on('message', (message) => process.send({ type: 'answer', value: message.value }));
setInterval(() => {}, 1000);
`;

const MAIN_SOURCE = `
const { app, utilityProcess } = require('electron');
const { asNodeChild } = require(${JSON.stringify(path.join(ROOT, 'electron/utility-child.cjs'))});
app.whenReady().then(() => {
  const child = asNodeChild(utilityProcess.fork(${JSON.stringify(path.join(ROOT, '.scratch-utility-child.cjs'))}, [], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    stdio: ['ignore', 'inherit', 'inherit'],
  }));
  const done = (code, result) => {
    console.log('RESULT ' + JSON.stringify(result));
    child.kill();
    app.exit(code);
  };
  let ready = null;
  child.on('message', (message) => {
    if (message.type === 'ready') {
      ready = message;
      child.send({ value: 'authenticated-launch' }, (error) => {
        console.log('SEND ' + JSON.stringify({ error: error ? error.message : null, connected: child.connected }));
      });
    }
    if (message.type === 'answer') done(0, { ...message, ready, connectedBeforeExit: child.connected });
  });
  child.on('exit', () => console.log('EXIT ' + JSON.stringify({ connected: child.connected })));
  setTimeout(() => done(2, { error: 'utility message timeout' }), 10000).unref();
});
`;

describe.runIf(process.platform === 'linux')('the real Electron utility-process adapters', () => {
  it('runs without RunAsNode and round-trips both Node-style message directions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-utility-electron-'));
    try {
      const childPath = path.join(root, 'child.cjs');
      const mainPath = path.join(root, 'main.cjs');
      await fs.writeFile(childPath, CHILD_SOURCE);
      await fs.writeFile(mainPath, MAIN_SOURCE.replace(JSON.stringify(path.join(ROOT, '.scratch-utility-child.cjs')), JSON.stringify(childPath)));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const { stdout, stderr } = await new Promise((resolve, reject) => {
        execFile(ELECTRON, ['--ozone-platform=headless', mainPath], { env, timeout: 15000 }, (error, out, err) => {
          if (error) reject(new Error(`${error.message}\n${out}\n${err}`));
          else resolve({ stdout: out, stderr: err });
        });
      });
      expect(stdout).toContain('"runAsNode":null');
      expect(stdout).toContain('"electron":"44.11.3"');
      expect(stdout).toContain('"error":null,"connected":true');
      expect(stdout).toContain('"value":"authenticated-launch"');
      expect(stdout).toContain('"connectedBeforeExit":true');
      expect(stdout).toContain('EXIT {"connected":false}');
      expect(stderr).toBe('');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20000);
});
