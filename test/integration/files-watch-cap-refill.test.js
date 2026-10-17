// Real Git tree, real async traversal, real inotify. No transport doubles.
import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startFilesWatchers, stopFilesWatchers, syncFilesWatchers, watchedRoots,
  MAX_DIRS_PER_ROOT, FLUSH_MS, parseIgnoredDirs,
} from '../../backend/services/files-watcher.js';
import { createFilesWatchWalk, isIgnoredWatchDir, pruneIgnoredWatches } from '../../backend/services/files-watch-walk.js';

const exec = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let root;
afterEach(async () => {
  stopFilesWatchers();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = null;
});

const largeTree = async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hr-desk-watch-'));
  // Real directories before the deeper genuine source in the original BFS.
  for (let at = 0; at < MAX_DIRS_PER_ROOT + 80; at += 32) {
    await Promise.all(Array.from({ length: 32 }, (_, i) =>
      fs.mkdir(path.join(root, `artifact-${String(at + i).padStart(5, '0')}`))));
  }
  await fs.mkdir(path.join(root, 'z-source', 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, '.gitignore'), 'artifact-*/\n');
  await exec('git', ['-c', 'init.templateDir=', 'init', '-q'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: root,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
};

describe('watcher cap refill after Git ignores arrive', () => {
  it('refills through watched ancestors after a real capped walk is pruned by real Git output', async () => {
    await largeTree();
    const dirs = new Map();
    const heard = [];
    const errors = [];
    let ignored = new Set();
    let completions = 0;
    const walker = createFilesWatchWalk({
      dirs, cap: MAX_DIRS_PER_ROOT, isLive: () => true,
      isIgnored: (dir) => isIgnoredWatchDir(dir, ignored), isNoise: (name) => name === '.git',
      watchDir: (dir) => {
        const watch = fsSync.watch(dir, (event, filename) => heard.push(path.join(dir, String(filename))));
        dirs.set(dir, watch);
        return true;
      },
      onComplete: () => { completions += 1; }, onError: (error) => errors.push(error.message),
    });
    try {
      walker.enqueue(root);
      const deadline = Date.now() + 10000;
      while (completions < 1 && Date.now() < deadline) await wait(25);
      expect(dirs.size).toBe(MAX_DIRS_PER_ROOT);
      const { stdout } = await exec('git', ['-c', 'core.fsmonitor=', 'ls-files', '-o', '-i', '--directory', '--exclude-standard', '-z'], { cwd: root });
      ignored = parseIgnoredDirs(stdout, root);
      await pruneIgnoredWatches({ dirs, isIgnored: (dir) => isIgnoredWatchDir(dir, ignored), isLive: () => true });
      expect(dirs.size).toBeLessThan(10);
      walker.enqueue(root); // root itself is ALREADY WATCHED
      const source = path.join(root, 'z-source', 'nested', 'refilled.js');
      while (!dirs.has(path.dirname(source)) && Date.now() < deadline) await wait(25);
      expect(dirs.has(path.dirname(source))).toBe(true);
      await fs.writeFile(source, 'real refill');
      while (!heard.includes(source) && Date.now() < deadline) await wait(25);
      expect(heard).toContain(source);
      expect(errors).toEqual([]);
    } finally {
      walker.close();
      for (const watch of dirs.values()) watch.close();
    }
  }, 30000);

  it('hears deeper genuine source behind more than a cap of ignored directories', async () => {
    await largeTree();
    const frames = [];
    startFilesWatchers([root], (frame) => frames.push(frame));
    const source = path.join(root, 'z-source', 'nested', 'current.js');
    const deadline = Date.now() + 10000;
    // Repeated real writes avoid guessing when async coverage has arrived.
    while (!frames.some((frame) => frame.paths.includes(source)) && Date.now() < deadline) {
      await fs.writeFile(source, `export const revision = ${Date.now()};`);
      await wait(FLUSH_MS + 50);
    }
    expect(frames.some((frame) => frame.paths.includes(source))).toBe(true);
    await wait(FLUSH_MS + 100);
    frames.length = 0;
    await fs.writeFile(path.join(root, 'artifact-00000', 'ignored.txt'), 'quiet');
    await wait(FLUSH_MS + 100);
    expect(frames).toEqual([]);
  }, 30000);

  it('closing/replacing during discovery never resurrects the old traversal', async () => {
    await largeTree();
    const frames = [];
    startFilesWatchers([root], (frame) => frames.push(frame));
    syncFilesWatchers([]);
    expect(watchedRoots()).toEqual([]);
    await wait(800);
    await fs.writeFile(path.join(root, 'z-source', 'nested', 'unheard.js'), 'closed');
    await wait(FLUSH_MS + 100);
    expect(watchedRoots()).toEqual([]);
    expect(frames).toEqual([]);
    startFilesWatchers([root], (frame) => frames.push(frame));
    await fs.writeFile(path.join(root, 'immediate.txt'), 'root is immediate');
    await wait(FLUSH_MS + 100);
    expect(frames.some((frame) => frame.paths.includes(path.join(root, 'immediate.txt')))).toBe(true);
    stopFilesWatchers();
    frames.length = 0;
    await wait(800);
    expect(frames).toEqual([]);
  }, 30000);
});
