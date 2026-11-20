// P6-142 — the production ACP queue judged with real cwd and real files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createAcpTurnQueue } from '../../cli/lib/acp-turn-queue.js';

let root;
let previousCwd;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-acp-queue-'));
  previousCwd = process.cwd();
});

afterEach(() => {
  process.chdir(previousCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ACP prompt serialization', () => {
  test('two relative-path turns cannot interleave their process cwd', async () => {
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const queue = createAcpTurnQueue();
    const events = [];
    let release;
    let entered;
    const firstEntered = new Promise((resolve) => { entered = resolve; });
    const first = queue(async () => {
      process.chdir(a);
      events.push('a:start');
      entered();
      await new Promise((resolve) => { release = resolve; });
      fs.writeFileSync('relative.txt', process.cwd());
      events.push('a:end');
    });
    await firstEntered;
    const second = queue(async () => {
      process.chdir(b);
      events.push('b:start');
      fs.writeFileSync('relative.txt', process.cwd());
      events.push('b:end');
    });
    expect(events).toEqual(['a:start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(fs.readFileSync(path.join(a, 'relative.txt'), 'utf8')).toBe(a);
    expect(fs.readFileSync(path.join(b, 'relative.txt'), 'utf8')).toBe(b);
  });

  test('a refused turn does not poison the next prompt', async () => {
    const queue = createAcpTurnQueue();
    await expect(queue(async () => { throw new Error('refused'); })).rejects.toThrow('refused');
    await expect(queue(async () => 'completed')).resolves.toBe('completed');
  });
});
