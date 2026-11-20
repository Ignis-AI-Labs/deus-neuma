import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendCommand, commandPaths, initializeCommandQueue, signCommand, verifyCommand } from '../../scripts/demo-video/lib/command-queue.mjs';
import { CONTROL, OUT } from '../../scripts/demo-video/lib/paths.mjs';

const roots = [];
const root = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-film-queue-'));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('authenticated film command queues', () => {
  test('control state is private and outside generated temp media', () => {
    const dir = path.join(root(), 'control');
    const key = initializeCommandQueue(dir);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    for (const file of Object.values(commandPaths(dir))) expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(CONTROL.startsWith(OUT)).toBe(false);
    expect(CONTROL.includes(`${path.sep}data${path.sep}temp${path.sep}`)).toBe(false);
  });

  test('the real sender writes a command the reader authenticates exactly', () => {
    const dir = root();
    const key = initializeCommandQueue(dir);
    const sender = path.resolve(import.meta.dirname, '../../scripts/demo-video/send.mjs');
    execFileSync(process.execPath, [sender, dir, 'click', 'role=CONNECT']);
    const raw = fs.readFileSync(commandPaths(dir).queue, 'utf8').trimEnd();
    expect(verifyCommand(key, raw)).toBe('click role=CONNECT');
    appendCommand(dir, 'key Enter');
    const lines = fs.readFileSync(commandPaths(dir).queue, 'utf8').trimEnd().split('\n');
    expect(verifyCommand(key, lines[1])).toBe('key Enter');
  });

  test('missing, altered, wrong-session, and multiline commands are refused', () => {
    const first = root();
    const second = root();
    const key = initializeCommandQueue(first);
    const otherKey = initializeCommandQueue(second);
    const signed = signCommand(key, 'js document.body.remove()');
    expect(() => verifyCommand(key, 'js document.body.remove()')).toThrow('unauthenticated film command');
    expect(() => verifyCommand(key, `${signed.slice(0, -1)}0`)).toThrow('unauthenticated film command');
    expect(() => verifyCommand(key, signed.replace('document.body', 'document.head'))).toThrow('unauthenticated film command');
    expect(() => verifyCommand(otherKey, signed)).toThrow('unauthenticated film command');
    expect(() => verifyCommand(key, `${signed}\n${signed}`)).toThrow('unauthenticated film command');
    expect(() => signCommand(key, 'api PUT /x\nkeys stolen')).toThrow('one non-empty line');
    expect(() => verifyCommand(key, `not-a-mac ${signed}`)).toThrow('unauthenticated film command');
  });

  test('both film drivers authenticate before dispatching a command', () => {
    for (const file of ['commands/live.mjs', 'tiktok-review.mjs']) {
      const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/demo-video', file), 'utf8');
      expect(source).toContain('initializeCommandQueue(CONTROL_DIR)');
      expect(source.indexOf('verifyCommand(key, raw)')).toBeLessThan(source.indexOf('run(cmd, rest, rest.join'));
      expect(source).not.toContain('const line = raw.trim()');
    }
  });

  test('reopening one control directory rotates the key and rejects an old-session replay', () => {
    const dir = path.join(root(), 'session');
    const firstKey = initializeCommandQueue(dir);
    const replay = signCommand(firstKey, 'quit');
    const secondKey = initializeCommandQueue(dir);
    expect(secondKey).not.toBe(firstKey);
    expect(verifyCommand(firstKey, replay)).toBe('quit');
    expect(() => verifyCommand(secondKey, replay)).toThrow('unauthenticated film command');
    expect(verifyCommand(secondKey, signCommand(secondKey, 'quit'))).toBe('quit');
  });
});
