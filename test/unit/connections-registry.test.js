// The CONNECTIONS list (electron/connections.json) and its one reader (electron/connections.cjs):
// every connection that runs by itself is OFF until the person turns it on, a broken switch file
// reads as everything off, and the file lives where the backend's data root says. Real files on a
// real temp dir; nothing is mocked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import connections from '../../electron/connections.cjs';

const { CONNECTIONS, SWITCHED, switchOn, dataRootFor, switchFilePath, readSwitchFile, isOn } = connections;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-conn-registry-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the list', () => {
  test('the four that run by themselves are switched, and every one starts off', () => {
    expect(SWITCHED).toEqual(['update-check', 'security-watch', 'platform-data', 'mail-watch', 'sanctions-list', 'chat-bridge']);
    for (const id of SWITCHED) expect(CONNECTIONS.find((c) => c.id === id).default).toBe(false);
  });

  test('every row says where it goes, when, and what it sends; a switched row says what is lost while off', () => {
    const controls = new Set(['switch', 'web', 'use', 'choice', 'setup']);
    for (const row of CONNECTIONS) {
      for (const key of ['id', 'name', 'to', 'when', 'sends', 'detail']) expect(String(row[key] || '').trim(), `${row.id}.${key}`).not.toBe('');
      expect(controls.has(row.control), row.id).toBe(true);
      if (row.control === 'switch') expect(String(row.whileOff || '').trim(), `${row.id}.whileOff`).not.toBe('');
    }
    expect(new Set(CONNECTIONS.map((c) => c.id)).size).toBe(CONNECTIONS.length);
  });
});

describe('a switch', () => {
  test('never written reads as its default — off', () => {
    expect(switchOn('update-check', {})).toBe(false);
  });
  test('reads what the person saved', () => {
    expect(switchOn('update-check', { 'update-check': true })).toBe(true);
    expect(switchOn('update-check', { 'update-check': false })).toBe(false);
  });
  test('an unreadable file and an unknown id are off, whatever was saved', () => {
    expect(switchOn('update-check', null)).toBe(false);
    expect(switchOn('web', { web: true })).toBe(false); // not this list's switch
    expect(switchOn('nope', { nope: true })).toBe(false);
  });
  test('a saved value that is not a boolean falls back to off', () => {
    expect(switchOn('update-check', { 'update-check': 'yes' })).toBe(false);
  });
});

describe('the switch file on disk', () => {
  test('none written reads as {}; corrupt or an array reads as null', () => {
    expect(readSwitchFile(path.join(dir, 'missing.json'))).toEqual({});
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{ not json');
    expect(readSwitchFile(path.join(dir, 'corrupt.json'))).toBeNull();
    fs.writeFileSync(path.join(dir, 'array.json'), '[true]');
    expect(readSwitchFile(path.join(dir, 'array.json'))).toBeNull();
  });

  test('isOn reads the real file through the isolation door', () => {
    const file = path.join(dir, 'on.json');
    fs.writeFileSync(file, JSON.stringify({ 'security-watch': true }));
    const env = { NEUMA_CONNECTIONS_PATH: file };
    expect(isOn('security-watch', { env, dataRoot: '/nowhere' })).toBe(true);
    expect(isOn('update-check', { env, dataRoot: '/nowhere' })).toBe(false);
  });

  test('lives under the data root the backend uses', () => {
    expect(switchFilePath({ env: {}, dataRoot: '/d' })).toBe(path.join('/d', 'settings', 'connections.json'));
    expect(dataRootFor({ env: { NEUMA_DATA_ROOT: '/x' }, isPackaged: true, home: '/h', repoRoot: '/r' })).toBe('/x');
    expect(dataRootFor({ env: {}, isPackaged: true, home: '/h', repoRoot: '/r' })).toBe(path.join('/h', '.neuma', 'data'));
    expect(dataRootFor({ env: {}, isPackaged: false, home: '/h', repoRoot: '/r' })).toBe(path.join('/r', 'data'));
  });
});
