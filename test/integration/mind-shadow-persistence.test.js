/**
 * Shadow evidence must survive a restart.
 *
 * The Undercurrent gate stood at `shadow` from 2026-08-14, and its findings
 * lived only in a 32-slot in-memory ring. Every backend restart in the days
 * that followed erased them, so the question shadow mode exists to answer —
 * is this worth promoting to live? — could never be answered from more than
 * whatever turns the current process happened to have served.
 *
 * The contract here is the fix: a lane's observations reach disk, a fresh
 * process reads the earlier ones back, and lanes never bleed into each other.
 * Real files in a real temp directory throughout — no mocked filesystem.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let dir;
let logPath;
let savedPath;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mind-shadow-'));
  logPath = join(dir, 'mind-shadow.jsonl');
  savedPath = process.env.NEUMA_MIND_SHADOW_PATH;
  process.env.NEUMA_MIND_SHADOW_PATH = logPath;
});

afterEach(async () => {
  if (savedPath === undefined) delete process.env.NEUMA_MIND_SHADOW_PATH;
  else process.env.NEUMA_MIND_SHADOW_PATH = savedPath;
  await rm(dir, { recursive: true, force: true });
});

// A fresh module instance is what a restarted backend actually gets: new
// rings, same disk. Dropping the module registry is the whole point — the
// lanes' in-memory state must not carry over, only the file does.
const freshModule = () => {
  vi.resetModules();
  return import('../../backend/services/mind-shadow-log.js');
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe('mind shadow log — evidence across restarts', () => {
  test('what one process records, the next process reads back', async () => {
    const first = await freshModule();
    first.undercurrentShadowLane.record({ neumaId: 'n1', rows: 3, chars: 210, kinds: ['trace'], at: '2026-08-23T10:00:00.000Z' });
    first.undercurrentShadowLane.record({ neumaId: 'n2', rows: 1, chars: 40, kinds: ['mood'], at: '2026-08-23T10:01:00.000Z' });
    await settle();

    // the restart: a new module instance, so its in-memory ring starts empty
    const second = await freshModule();
    expect(second.undercurrentShadowLane.entries()).toEqual([]);

    const carried = await second.persistedShadow('undercurrent');
    expect(carried).toHaveLength(2);
    expect(carried.map((r) => r.neumaId)).toEqual(['n1', 'n2']);
    expect(carried[0].rows).toBe(3);
    expect(carried[1].kinds).toEqual(['mood']);
  });

  test('the two lanes share a file without reading each other', async () => {
    const m = await freshModule();
    m.undercurrentShadowLane.record({ neumaId: 'n1', rows: 2, at: '2026-08-23T10:00:00.000Z' });
    m.depthShadowLane.record({ neumaId: 'n1', usedTokens: 900, at: '2026-08-23T10:00:01.000Z' });
    await settle();

    expect((await m.persistedShadow('undercurrent')).map((r) => r.rows)).toEqual([2]);
    expect((await m.persistedShadow('depth')).map((r) => r.usedTokens)).toEqual([900]);
  });

  test('an absent log is an empty history, not an error', async () => {
    const m = await freshModule();
    await expect(m.persistedShadow('undercurrent')).resolves.toEqual([]);
  });

  test('a torn line costs one observation, never the whole history', async () => {
    const m = await freshModule();
    m.undercurrentShadowLane.record({ neumaId: 'n1', rows: 1, at: '2026-08-23T10:00:00.000Z' });
    await settle();
    // a write cut mid-line by a kill, then a good line after it
    await writeFile(logPath, `${(await readFile(logPath, 'utf8')).trim()}\n{"lane":"undercurrent","rows"\n{"lane":"undercurrent","neumaId":"n2","rows":5}\n`);

    const rows = await m.persistedShadow('undercurrent');
    expect(rows.map((r) => r.neumaId)).toEqual(['n1', 'n2']);
  });

  test('the in-memory ring stays bounded even as the log grows past it', async () => {
    const m = await freshModule();
    for (let i = 0; i < m.SHADOW_RING + 10; i += 1) {
      m.undercurrentShadowLane.record({ neumaId: `n${i}`, rows: 1, at: '2026-08-23T10:00:00.000Z' });
    }
    await settle();
    expect(m.undercurrentShadowLane.entries()).toHaveLength(m.SHADOW_RING);
    // the disk keeps what the ring had to drop — that is the entire point
    expect(await m.persistedShadow('undercurrent')).toHaveLength(m.SHADOW_RING + 10);
  });

  test('a write failure degrades to the ring instead of costing a turn', async () => {
    process.env.NEUMA_MIND_SHADOW_PATH = join(dir, 'not-a-dir.jsonl', 'nested.jsonl');
    const m = await freshModule();
    expect(() => m.undercurrentShadowLane.record({ neumaId: 'n1', rows: 1, at: '2026-08-23T10:00:00.000Z' })).not.toThrow();
    await settle();
    expect(m.undercurrentShadowLane.entries()).toHaveLength(1);
  });
});
