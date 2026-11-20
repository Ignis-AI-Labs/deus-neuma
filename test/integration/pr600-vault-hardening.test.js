/* global process */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { aesSeal } from '../helpers/electron-seal.js';

const require = createRequire(import.meta.url);
const { writeFileAtomic } = require('../../electron/key-lock/atomic-file.cjs');
const { createWalletService } = require('../../electron/wallet/wallet-service.cjs');

const CHEAP = { N: 1024, r: 8, p: 1, dkLen: 32 };
const SEAL = aesSeal();

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pr600-vault-'));
const tempsIn = (dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));

describe('durable key and wallet records', () => {
  let dir;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('exclusive writes never follow a planted temporary or destination symlink', () => {
    const file = path.join(dir, 'secrets.json');
    const outside = path.join(dir, 'outside.json');
    fs.writeFileSync(outside, 'do-not-replace');
    const stale = `${file}.${process.pid}.tmp`;
    fs.symlinkSync(outside, stale);

    writeFileAtomic(file, 'first', { backup: true });
    expect(fs.readFileSync(outside, 'utf8')).toBe('do-not-replace');
    expect(fs.readFileSync(stale, 'utf8')).toBe('do-not-replace');
    expect(fs.readFileSync(file, 'utf8')).toBe('first');
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe('first');
    expect(tempsIn(dir)).toEqual([path.basename(stale)]);

    const linked = path.join(dir, 'linked.json');
    fs.symlinkSync(outside, linked);
    writeFileAtomic(linked, 'second');
    expect(fs.readFileSync(linked, 'utf8')).toBe('second');
    expect(fs.readFileSync(outside, 'utf8')).toBe('do-not-replace');
    expect(fs.lstatSync(linked).isSymbolicLink()).toBe(false);
  });

  test('owner mode is enforced on rewrite and a failed rename cleans its own temporary file', () => {
    const file = path.join(dir, 'record.json');
    writeFileAtomic(file, 'old');
    fs.chmodSync(file, 0o644);
    writeFileAtomic(file, 'new', { backup: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe('new');
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(`${file}.bak`).mode & 0o777).toBe(0o600);
    }

    const blocked = path.join(dir, 'blocked');
    fs.mkdirSync(blocked);
    expect(() => writeFileAtomic(blocked, 'cannot-land')).toThrow();
    expect(tempsIn(dir)).toEqual([]);
  });

  test('registry, remembered password, and made-key siblings all land through real atomic writes', () => {
    const service = createWalletService({ walletDir: dir, outerSeal: SEAL, scryptParams: CHEAP });
    const made = service.createForMe();
    service.unlock(made.id, SEAL.decrypt(fs.readFileSync(path.join(dir, `made-${made.id}.dat`))), true);

    const registry = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'));
    expect(registry.activeId).toBe(made.id);
    const remembered = JSON.parse(SEAL.decrypt(fs.readFileSync(path.join(dir, 'remember.dat'))));
    expect(remembered.id).toBe(made.id);
    expect(fs.existsSync(path.join(dir, `made-${made.id}.dat`))).toBe(true);
    expect(tempsIn(dir)).toEqual([]);
    if (process.platform !== 'win32') {
      for (const name of ['registry.json', 'remember.dat', `made-${made.id}.dat`]) {
        expect(fs.statSync(path.join(dir, name)).mode & 0o777).toBe(0o600);
      }
    }
  });
});
