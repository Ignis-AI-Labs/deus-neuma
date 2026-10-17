/**
 * Tests for files-watcher — the desk's eyes on the opened roots.
 *
 * The lifecycle half runs REAL: real temp directories, real fs.watch
 * (recursive inotify), real writes, the real debounce — frames land in a
 * plain collector array, which is this path's terminal sink, not a stub of
 * anything the path travels through (RULE 0). The classifier and fold are
 * pure and proven on real values.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  classifyChange, foldPending, outerRoots, watchableRoots, startFilesWatchers,
  syncFilesWatchers, stopFilesWatchers, watchedRoots, parseIgnoredDirs,
  FLUSH_MS, MAX_PATHS,
} from '../../backend/services/files-watcher.js';


const until = async (pred, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition never held');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('classifyChange (pure)', () => {
  it('a plain file resolves under its root', () => {
    expect(classifyChange('/r', 'src/a.js')).toEqual({ kind: 'path', path: path.join('/r', 'src/a.js') });
  });
  it('.git internals collapse to the git flag', () => {
    expect(classifyChange('/r', '.git/index').kind).toBe('git');
    expect(classifyChange('/r', '.git/objects/ab/cd').kind).toBe('git');
    expect(classifyChange('/r', 'sub/.git/HEAD').kind).toBe('git');
  });
  it('a nameless event is a bulk sweep', () => {
    expect(classifyChange('/r', null).kind).toBe('bulk');
    expect(classifyChange('/r', '').kind).toBe('bulk');
  });
  it('a dotgit-prefixed sibling is NOT git plumbing', () => {
    expect(classifyChange('/r', '.gitignore').kind).toBe('path');
  });
});

describe('foldPending (pure)', () => {
  it('nothing pending → null (no empty frames on the wire)', () => {
    expect(foldPending({ paths: new Map(), bulk: new Set(), git: false })).toBeNull();
  });
  it('an overflow collapses the busiest root into bulk', () => {
    const paths = new Map();
    for (let i = 0; i < MAX_PATHS + 5; i += 1) paths.set(`/busy/f${i}`, '/busy');
    paths.set('/calm/one', '/calm');
    const frame = foldPending({ paths, bulk: new Set(), git: false });
    expect(frame.bulk).toContain('/busy');
    expect(frame.paths).toEqual(['/calm/one']);
  });
});

describe('the watchers, for real', () => {
  let root;
  afterEach(async () => {
    stopFilesWatchers();
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  it('a real write lands as a frame carrying the file path', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    await fs.writeFile(path.join(root, 'born.txt'), 'hello');
    await until(() => frames.length > 0);
    expect(frames.some((f) => f.paths.includes(path.join(root, 'born.txt')))).toBe(true);
  });

  it('a .git internal write raises only the git flag', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    await fs.mkdir(path.join(root, '.git'));
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    // mkdir above may race into the watch window — settle one flush first.
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;
    await fs.writeFile(path.join(root, '.git', 'index'), 'x');
    await until(() => frames.length > 0);
    expect(frames[0].git).toBe(true);
    expect(frames[0].paths.some((p) => p.includes('.git'))).toBe(false);
  });

  it('a change in a nested directory is seen (the watch is recursive)', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    await fs.mkdir(path.join(root, 'a', 'b'), { recursive: true });
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;
    await fs.writeFile(path.join(root, 'a', 'b', 'deep.txt'), 'deep');
    await until(() => frames.some((f) => f.paths.includes(path.join(root, 'a', 'b', 'deep.txt'))));
  });

  it('sync drops a closed root — its writes stop arriving', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    const keep = path.join(root, 'keep');
    const drop = path.join(root, 'drop');
    await fs.mkdir(keep);
    await fs.mkdir(drop);
    const frames = [];
    startFilesWatchers([keep, drop], (f) => frames.push(f));
    syncFilesWatchers([keep]);
    await fs.writeFile(path.join(drop, 'gone.txt'), 'x');
    await fs.writeFile(path.join(keep, 'here.txt'), 'x');
    await until(() => frames.some((f) => f.paths.includes(path.join(keep, 'here.txt'))));
    expect(frames.some((f) => f.paths.includes(path.join(drop, 'gone.txt')))).toBe(false);
  });

  it('stop means silence — and a fresh start hears again', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    stopFilesWatchers();
    await fs.writeFile(path.join(root, 'unheard.txt'), 'x');
    await new Promise((r) => setTimeout(r, FLUSH_MS + 200));
    expect(frames).toEqual([]);
    startFilesWatchers([root], (f) => frames.push(f));
    await fs.writeFile(path.join(root, 'heard.txt'), 'x');
    await until(() => frames.some((f) => f.paths.includes(path.join(root, 'heard.txt'))));
  });
});

describe('noise and overlapping roots — the amplification killers', () => {
  it('dependency/build/cache churn is noise, at any depth (pure)', () => {
    expect(classifyChange('/r', path.join('node_modules', 'dep', 'index.js'))).toEqual({ kind: 'noise' });
    expect(classifyChange('/r', path.join('web', 'dist', 'bundle.js'))).toEqual({ kind: 'noise' });
    expect(classifyChange('/r', path.join('a', '.cache', 'x'))).toEqual({ kind: 'noise' });
    // .git wins over noise: a git internal under a vendored tree is still git.
    expect(classifyChange('/r', path.join('node_modules', '.git', 'index'))).toEqual({ kind: 'git' });
    // A file merely NAMED like a noise dir is not noise.
    expect(classifyChange('/r', 'dist.js')).toEqual({ kind: 'path', path: path.join('/r', 'dist.js') });
  });

  it('outerRoots keeps only the minimal cover (pure)', () => {
    expect(outerRoots(['/a', '/a/b', '/a/b/c', '/d'])).toEqual(['/a', '/d']);
    expect(outerRoots(['/a', '/ab'])).toEqual(['/a', '/ab']); // sibling, not contained
    expect(outerRoots(['/a', '/a'])).toEqual(['/a']);
    expect(outerRoots([])).toEqual([]);
  });

  let root;
  afterEach(async () => {
    stopFilesWatchers();
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  it('an npm-install-shaped burst under node_modules ships NO frame; a sibling write still does', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;
    for (let i = 0; i < 30; i += 1) {
      await fs.writeFile(path.join(root, 'node_modules', 'dep', `f${i}.js`), 'x');
    }
    await new Promise((r) => setTimeout(r, FLUSH_MS + 200));
    expect(frames).toEqual([]);
    await fs.writeFile(path.join(root, 'source.js'), 'x');
    await until(() => frames.some((f) => f.paths.includes(path.join(root, 'source.js'))));
  });

  it('a contained root is served by its parent watcher — events arrive exactly once', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    const child = path.join(root, 'backend');
    await fs.mkdir(child);
    const frames = [];
    startFilesWatchers([root, child], (f) => frames.push(f));
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;
    await fs.writeFile(path.join(child, 'one.js'), 'x');
    await until(() => frames.length > 0);
    await new Promise((r) => setTimeout(r, FLUSH_MS + 200));
    const arrivals = frames.flatMap((f) => f.paths).filter((p) => p === path.join(child, 'one.js'));
    expect(arrivals).toEqual([path.join(child, 'one.js')]);
  });
});

describe('git-ignored trees — where the 4096 budget was going', () => {
  it('only whole DIRECTORIES prune; an ignored file leaves its folder watched (pure)', () => {
    const set = parseIgnoredDirs('.env\0build/\0data/runs/\0', '/r');
    expect([...set].sort()).toEqual([path.join('/r', 'build'), path.join('/r', 'data/runs')]);
    expect(parseIgnoredDirs('', '/r').size).toBe(0);
  });

  let root;
  afterEach(async () => {
    stopFilesWatchers();
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  // REAL git, REAL .gitignore, REAL inotify: the operator's own declaration of
  // what is not source keeps a churning artifact tree off the watch budget,
  // while everything they actually read stays live.
  it('a real repo\'s ignored subtree goes unwatched; source beside it still fires', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-git-'));
    await fs.mkdir(path.join(root, 'runs', 'deep'), { recursive: true });
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), 'runs/\n');
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });

    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;

    await fs.writeFile(path.join(root, 'runs', 'deep', 'artifact.bin'), 'x');
    await new Promise((r) => setTimeout(r, FLUSH_MS + 250));
    expect(frames.flatMap((f) => f.paths).some((p) => p.includes('artifact.bin'))).toBe(false);

    await fs.writeFile(path.join(root, 'src', 'real.js'), 'x');
    await until(() => frames.some((f) => f.paths.includes(path.join(root, 'src', 'real.js'))));
  });

  it('a non-repo root keeps every directory — the prune is git-sourced, never invented', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-plain-'));
    await fs.mkdir(path.join(root, 'runs', 'deep'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), 'runs/\n'); // no repo: inert
    const frames = [];
    startFilesWatchers([root], (f) => frames.push(f));
    await new Promise((r) => setTimeout(r, FLUSH_MS + 100));
    frames.length = 0;
    await fs.writeFile(path.join(root, 'runs', 'deep', 'still-seen.txt'), 'x');
    await until(() => frames.some((f) => f.paths.includes(path.join(root, 'runs', 'deep', 'still-seen.txt'))));
  });
});

describe('watchableRoots — missing paths and home stay off the watch', () => {
  it('drops a missing path and the home directory (real stat)', () => {
    const gone = path.join(os.tmpdir(), `fw-gone-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    expect(watchableRoots([os.homedir(), gone])).toEqual([]);
  });

  let root;
  afterEach(async () => {
    stopFilesWatchers();
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = null;
  });

  it('start never registers home or a missing folder; a real sibling still watches', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-'));
    const gone = path.join(os.tmpdir(), `fw-gone-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    startFilesWatchers([os.homedir(), gone, root], () => {});
    expect(watchedRoots()).toEqual([root]);
  });
});

