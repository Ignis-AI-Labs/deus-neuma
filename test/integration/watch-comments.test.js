/**
 * AI comments (RULE 0: real files, real fs watches, a real git repository).
 *
 * The turn is handed in as a function; here it records what it was asked and
 * the tool mode it ran in. The real program, with a real sitting, is proven in
 * cli-code-commands.test.js; what a real model does with the comment stays a
 * live sitting's proof.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  findAiComments, isSkippedPath, instructionPrompt, readInstruction, watchAiComments, runInstruction, WATCH_MAX_FILE_BYTES,
} from '../../cli/lib/watch-comments.js';

let ground;
const git = (...args) => execFileSync('git', args, { cwd: ground, encoding: 'utf8' });
const write = async (rel, text) => {
  await fs.mkdir(path.dirname(path.join(ground, rel)), { recursive: true });
  await fs.writeFile(path.join(ground, rel), text);
};
const until = async (check, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
  return check();
};
const settle = (ms = 700) => new Promise((resolve) => { setTimeout(resolve, ms); });

beforeEach(async () => {
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-watch-'));
  git('init', '-q');
});
afterEach(async () => {
  await fs.rm(ground, { recursive: true, force: true });
});

describe('findAiComments', () => {
  test('reads the word AI at either end of a comment, in the common comment styles', () => {
    const text = [
      'const a = 1; // make this a constant AI!',
      '# why does this retry three times? AI?',
      '// AI: the cache below is per-request',
      '-- AI! add an index on email',
      '/* rename this AI! */',
      '<!-- make the button blue AI! -->',
      '; ai? what is this register for',
      '{/* move this up AI! */}',
    ].join('\n');
    expect(findAiComments(text)).toEqual([
      { line: 1, text: 'make this a constant', kind: 'do' },
      { line: 2, text: 'why does this retry three times?', kind: 'ask' },
      { line: 3, text: 'the cache below is per-request', kind: 'note' },
      { line: 4, text: 'add an index on email', kind: 'do' },
      { line: 5, text: 'rename this', kind: 'do' },
      { line: 6, text: 'make the button blue', kind: 'do' },
      { line: 7, text: 'what is this register for', kind: 'ask' },
      { line: 8, text: 'move this up', kind: 'do' },
    ]);
  });

  test('the word must stand alone, and code that merely says AI is not a comment', () => {
    const text = [
      '// the AIR conditioner model',
      '// call the openai client',
      '// train the AI model here',
      'const label = "AI!";',
      'aiClient.send(); // done',
      '// said AI',
    ].join('\n');
    expect(findAiComments(text)).toEqual([{ line: 6, text: 'said', kind: 'note' }]);
  });
});

describe('isSkippedPath', () => {
  test('never reads git, dependencies, the platform\'s own records or editor scratch files', () => {
    for (const p of ['.git/HEAD', 'node_modules/x/index.js', 'a/node_modules/b.js', '.neuma/edit-undo/1.json', 'a.js~', 'a.js.1234.tmp', '']) {
      expect(isSkippedPath(p), p).toBe(true);
    }
    expect(isSkippedPath('src/app.js')).toBe(false);
  });
});

describe('instructionPrompt', () => {
  test('a change asks for the work and the comment\'s removal; a question holds the hands', () => {
    const doIt = instructionPrompt({ file: 'a.js', kind: 'do', comments: [{ line: 3, text: 'per-request', kind: 'note' }, { line: 9, text: 'add a guard', kind: 'do' }] });
    expect(doIt).toContain('in a.js');
    expect(doIt).toContain('line 3 (context): per-request');
    expect(doIt).toContain('line 9: add a guard');
    expect(doIt).toContain('remove the AI comments you acted on');
    const ask = instructionPrompt({ file: 'a.js', kind: 'ask', comments: [{ line: 2, text: 'why?', kind: 'ask' }] });
    expect(ask).toContain('line 2 (question): why?');
    expect(ask).toContain('your acting tools are held');
  });
});

describe('readInstruction', () => {
  test('a new instruction is read once; context rides with it; a second read of the same file is silent', async () => {
    await write('src/a.js', '// the list may be empty AI\nexport const first = (xs) => xs[0]; // guard the empty case AI!\n');
    const handled = new Set();
    const got = await readInstruction(ground, 'src/a.js', handled);
    expect(got).toEqual({
      file: 'src/a.js', kind: 'do',
      comments: [{ line: 1, text: 'the list may be empty', kind: 'note' }, { line: 2, text: 'guard the empty case', kind: 'do' }],
    });
    expect(await readInstruction(ground, 'src/a.js', handled)).toBeNull();
    // A new instruction in the same file fires, carrying only what is new.
    await write('src/a.js', '// the list may be empty AI\nexport const first = (xs) => xs[0]; // guard the empty case AI!\n// and add a test AI!\n');
    const next = await readInstruction(ground, 'src/a.js', handled);
    expect(next.comments.filter((c) => c.kind === 'do')).toEqual([{ line: 3, text: 'and add a test', kind: 'do' }]);
  });

  test('context alone is nothing to act on; a question alone is a question', async () => {
    await write('b.py', '# this is per-request AI\n');
    expect(await readInstruction(ground, 'b.py', new Set())).toBeNull();
    await write('c.py', '# why three retries AI?\n');
    expect((await readInstruction(ground, 'c.py', new Set())).kind).toBe('ask');
  });

  test('ignored, binary, oversized and vanished files are never read', async () => {
    await write('.gitignore', 'build/\n*.log\n');
    await write('build/out.js', '// do it AI!\n');
    await write('trace.log', '// do it AI!\n');
    await write('bin.dat', Buffer.concat([Buffer.from('// do it AI!\n'), Buffer.from([0, 1, 2])]));
    await write('big.js', `// do it AI!\n${'x'.repeat(WATCH_MAX_FILE_BYTES)}`);
    for (const rel of ['build/out.js', 'trace.log', 'bin.dat', 'big.js', 'gone.js', 'node_modules/m/i.js']) {
      expect(await readInstruction(ground, rel, new Set()), rel).toBeNull();
    }
  });
});

describe('watchAiComments — real watches on a real folder', () => {
  const start = async (opts = {}) => {
    const got = [];
    const errors = [];
    const watch = watchAiComments({ ground, onInstruction: (i) => got.push(i), onError: (e) => errors.push(e), ...opts });
    const info = await watch.ready;
    return { got, errors, watch, info };
  };

  test('a comment standing at start is left alone; one saved while watching fires once', async () => {
    await write('a.js', '// old request AI!\n');
    const { got, watch } = await start();
    try {
      await settle();
      expect(got).toEqual([]);
      await write('a.js', '// old request AI!\n// new request AI!\n');
      expect(await until(() => got.length === 1)).toBe(true);
      // The standing one was never sent; touching the file again sends nothing more.
      expect(got[0].comments.map((c) => c.text)).toEqual(['new request']);
      await write('a.js', '// old request AI!\n// new request AI!\n\n');
      await settle();
      expect(got).toHaveLength(1);
    } finally {
      watch.stop();
    }
  });

  test('a burst of saves is one scan', async () => {
    const { got, watch } = await start();
    try {
      for (let i = 0; i < 5; i += 1) await write('burst.js', `// do the thing AI!\n${'.'.repeat(i)}\n`);
      await settle();
      expect(got).toHaveLength(1);
    } finally {
      watch.stop();
    }
  });

  test('deep folders, and folders made while watching, are watched; dependencies and ignored folders are not', async () => {
    await write('.gitignore', 'dist/\n');
    await write('src/deep/x.js', '\n');
    await write('node_modules/pkg/i.js', '\n');
    await write('dist/o.js', '\n');
    const { got, watch, info } = await start();
    try {
      expect(info.capped).toBe(false);
      // ground, src, src/deep — and not .git, node_modules or dist.
      expect(info.dirs).toBe(3);
      await write('node_modules/pkg/i.js', '// AI! no\n');
      await write('dist/o.js', '// AI! no\n');
      await write('src/deep/x.js', '// AI! yes, deep\n');
      expect(await until(() => got.length === 1)).toBe(true);
      expect(got[0].file).toBe(path.join('src', 'deep', 'x.js'));
      await fs.mkdir(path.join(ground, 'made'));
      await settle();
      await write('made/new.js', '// AI! yes, new folder\n');
      expect(await until(() => got.length === 2)).toBe(true);
      expect(got[1].file).toBe(path.join('made', 'new.js'));
      await settle();
      expect(got).toHaveLength(2);
    } finally {
      watch.stop();
    }
  });

  test('past the folder limit it stops adding folders and says so', async () => {
    for (let i = 0; i < 6; i += 1) await fs.mkdir(path.join(ground, `d${i}`));
    const { watch, info } = await start({ maxDirs: 3 });
    watch.stop();
    expect(info).toEqual({ dirs: 3, capped: true });
  });

  test('after stop nothing fires', async () => {
    const { got, watch } = await start();
    watch.stop();
    await write('late.js', '// AI! too late\n');
    await settle();
    expect(got).toEqual([]);
  });

  test('outside a repository it still watches', async () => {
    await fs.rm(path.join(ground, '.git'), { recursive: true, force: true });
    const { got, watch } = await start();
    try {
      await write('plain.txt', '# AI? what is this\n');
      expect(await until(() => got.length === 1)).toBe(true);
      expect(got[0].kind).toBe('ask');
    } finally {
      watch.stop();
    }
  });
});

describe('runInstruction', () => {
  const recorder = () => {
    const calls = [];
    const connection = { toolMode: 'ask' };
    const as = (via) => async (thought) => { calls.push({ via, mode: connection.toolMode, thought }); };
    return { calls, connection, turn: as('turn'), runTurn: as('runTurn') };
  };

  test('a change runs as the ordinary turn, with the sitting\'s own mode', async () => {
    const r = recorder();
    await runInstruction({ instruction: { file: 'a.js', kind: 'do', comments: [{ line: 1, text: 'x', kind: 'do' }] }, ...r });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ via: 'turn', mode: 'ask' });
  });

  test('a question runs with the hands held, and the mode comes back even when the turn throws', async () => {
    const r = recorder();
    await runInstruction({ instruction: { file: 'a.js', kind: 'ask', comments: [{ line: 1, text: 'why', kind: 'ask' }] }, ...r });
    expect(r.calls[0]).toMatchObject({ via: 'runTurn', mode: 'observe' });
    expect(r.connection.toolMode).toBe('ask');
    const boom = async () => { throw new Error('turn failed'); };
    await expect(runInstruction({ instruction: { file: 'a.js', kind: 'ask', comments: [] }, connection: r.connection, turn: boom, runTurn: boom }))
      .rejects.toThrow('turn failed');
    expect(r.connection.toolMode).toBe('ask');
  });
});
