/**
 * PR600 audit P6-125, the search leg: `fs/search` with `regex: true` ran a being's own pattern on the
 * backend's one thread. `^(a+)+$` over one 39-byte file had not returned after 10 s (60 s in a second
 * run): every lane, the wallet routes and the money watches stopped until the process was killed, and
 * the file was still there after the restart.
 *
 * The real tool, through the being-facing route and the real filesystem organ, on real files. The proof
 * that the backend is not held is a clock on THIS thread that keeps ticking while the search runs.
 * No mocks.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval } from 'node:timers';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { LINE_REGEX_BUDGET_MS, openLineRegex } from '../../backend/services/line-regex.js';

const callTool = withFsRouting((server, tool, args) => mcpService.callTool(server, tool, args));
const textOf = (result) => (result?.content || []).map((c) => c?.text || '').join('\n');

// run something while a 20 ms clock ticks on this thread; a held thread ticks zero times
const whileTicking = async (run) => {
  let ticks = 0;
  const clock = setInterval(() => { ticks += 1; }, 20);
  const started = performance.now();
  try {
    const result = await run().then((value) => ({ value }), (error) => ({ error }));
    return { ...result, ticks, ms: performance.now() - started };
  } finally {
    clearInterval(clock);
  }
};

describe('P6-125 — a regular expression search cannot hold the backend', () => {
  let root;
  beforeAll(async () => {
    root = await createTempDir('pr600-regex-search');
    setNativeFilesystemRoots([root]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
    await fs.writeFile(path.join(root, 'bomb.txt'), `${'a'.repeat(38)}!`);
    await fs.writeFile(path.join(root, 'notes.md'), 'alpha one\nBeta two\r\nalpha three\n\ngamma 42\n');
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'more.md'), 'nothing here\nalpha four\n');
  });
  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    await fs.rm(root, { recursive: true, force: true });
  });

  test('the audit\'s pattern on the audit\'s file: stopped at the budget, said plainly, and this thread never waited', async () => {
    const { value, error, ticks, ms } = await whileTicking(() => callTool('fs', 'search', { path: root, pattern: '^(a+)+$', content: true, regex: true }));
    expect(error).toBeUndefined();
    expect(value.isError).toBe(true);
    expect(textOf(value)).toContain('did not finish one file within 2 seconds and was stopped');
    expect(ms).toBeGreaterThanOrEqual(LINE_REGEX_BUDGET_MS - 50);
    expect(ms).toBeLessThan(LINE_REGEX_BUDGET_MS + 3000);
    // a 20 ms clock over two seconds: a held thread ticks 0 times, a free one about 100
    expect(ticks).toBeGreaterThan(40);
  }, 20_000);

  test('the search still works after a stopped one, and reads as it always did', async () => {
    const found = textOf(await callTool('fs', 'search', { path: root, pattern: '^alpha\\s+(one|four)$', content: true, regex: true, filePattern: '*.md' }));
    expect(found.split('\n').filter((line) => line.includes('.md:'))).toEqual([
      `${path.join(root, 'notes.md')}:1: alpha one`,
      `${path.join(root, 'sub', 'more.md')}:2: alpha four`,
    ]);
    const folded = textOf(await callTool('fs', 'search', { path: root, pattern: '^BETA', content: true, regex: true, ignoreCase: true }));
    expect(folded).toContain(`${path.join(root, 'notes.md')}:2: Beta two`);
    const capped = textOf(await callTool('fs', 'search', { path: root, pattern: 'alpha|gamma', content: true, regex: true, maxResults: 2, filePattern: '*.md' }));
    expect(capped.split('\n').filter((line) => line.includes('.md:'))).toHaveLength(2);
    expect(capped).toContain('stopped at 2 matching lines');
    const none = textOf(await callTool('fs', 'search', { path: root, pattern: '^zeta\\d+$', content: true, regex: true, filePattern: '*.md' }));
    expect(none).toContain('No matches found');
  });

  test('a plain-text search and an invalid pattern answer as before', async () => {
    const plain = textOf(await callTool('fs', 'search', { path: root, pattern: 'ALPHA THREE', content: true, ignoreCase: true }));
    expect(plain).toContain(`${path.join(root, 'notes.md')}:3: alpha three`);
    const literal = textOf(await callTool('fs', 'search', { path: root, pattern: '(a+)+', content: true, filePattern: '*.md' }));
    expect(literal).toContain('No matches found');
    const invalid = await callTool('fs', 'search', { path: root, pattern: '(unclosed', content: true, regex: true });
    expect(invalid.isError).toBe(true);
    expect(textOf(invalid)).toMatch(/Invalid regular expression/);
  });

  test('the matcher itself: line numbers in order up to the limit, and a blown budget ends its thread', async () => {
    const lines = openLineRegex('^b', 'i');
    expect(await lines.matchingLines('a\nB\r\nb\nbb\nc', 10)).toEqual([1, 2, 3]);
    expect(await lines.matchingLines('a\nB\r\nb\nbb\nc', 2)).toEqual([1, 2]);
    await lines.close();
    const hostile = openLineRegex('^(a|aa)+$', '', { budgetMs: 150 });
    const { error, ticks, ms } = await whileTicking(() => hostile.matchingLines(`${'a'.repeat(60)}!`, 1));
    expect(error.message).toContain('was stopped');
    expect(ms).toBeLessThan(1500);
    expect(ticks).toBeGreaterThan(2);
    // a matcher whose thread was ended starts a fresh one
    await expect(openLineRegex('x', '').matchingLines('x', 1)).resolves.toEqual([0]);
    expect(() => openLineRegex('(', '')).toThrow(/Invalid regular expression/);
  });
});
