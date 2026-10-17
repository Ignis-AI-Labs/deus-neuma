import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * writeJsonAtomic + readChat torn-line tolerance (backend/services/user-realm.js)
 * — real temp filesystem, no mocks anywhere (RULE 0; these are the exact
 * functions under claim). Proves the realm's whole-file JSON stores can only
 * ever be observed complete — never half-written — and that a crash-torn
 * tail line in an append-only chat log costs that line, not the log.
 */

import { writeJsonAtomic, readChat, setRealmRoot } from '../../backend/services/user-realm.js';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');

let realmRoot;

beforeEach(async () => {
  realmRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'realm-atomic-'));
  setRealmRoot(realmRoot);
});

afterEach(async () => {
  setRealmRoot(DEFAULT_REALM);
  await fs.rm(realmRoot, { recursive: true, force: true });
});

describe('writeJsonAtomic', () => {
  it('writes a complete, parseable JSON document, creating parents', async () => {
    const file = path.join(realmRoot, 'nested', 'doc.json');
    await writeJsonAtomic(file, { a: 1, list: ['x', 'y'] });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ a: 1, list: ['x', 'y'] });
  });

  it('replaces an existing document wholesale', async () => {
    const file = path.join(realmRoot, 'doc.json');
    await writeJsonAtomic(file, { old: true, kept: 'no' });
    await writeJsonAtomic(file, { fresh: 'only' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ fresh: 'only' });
  });

  it('leaves no temp siblings behind', async () => {
    const file = path.join(realmRoot, 'doc.json');
    await writeJsonAtomic(file, { a: 1 });
    const leftovers = (await fs.readdir(realmRoot)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('a failed write leaves no half-file and no temp litter', async () => {
    // A non-empty directory parked at the target path makes fs.rename throw
    // for real (EISDIR/ENOTDIR) — no mock, a genuine rename failure.
    const blocker = path.join(realmRoot, 'blocked.json');
    await fs.mkdir(path.join(blocker, 'subdir'), { recursive: true });
    await expect(writeJsonAtomic(blocker, { a: 1 })).rejects.toThrow();
    const leftovers = (await fs.readdir(realmRoot)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    expect((await fs.stat(blocker)).isDirectory()).toBe(true);
  });

  it('concurrent writers can only ever land a complete document', async () => {
    const file = path.join(realmRoot, 'race.json');
    const writers = Array.from({ length: 20 }, (_, i) => ({ writer: i, payload: 'x'.repeat(500 + i) }));
    await Promise.all(writers.map((w) => writeJsonAtomic(file, w)));
    // Whatever won the last rename, the file parses and IS one of the
    // contestants — a torn mix of two writers is the failure this proves out.
    const final = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(writers).toContainEqual(final);
  });
});

describe('readChat — a crash-torn tail line costs the line, not the log', () => {
  it('returns the intact records and skips the torn tail', async () => {
    const dir = path.join(realmRoot, WALLET, 'chats');
    await fs.mkdir(dir, { recursive: true });
    const good1 = JSON.stringify({ ts: '2026-07-19T00:00:00Z', neuma: 'lifovan', role: 'user', content: 'one' });
    const good2 = JSON.stringify({ ts: '2026-07-19T00:01:00Z', neuma: 'lifovan', role: 'assistant', content: 'two' });
    const torn = '{"ts":"2026-07-19T00:02';
    await fs.writeFile(path.join(dir, 'lifovan.jsonl'), [good1, good2, torn].join('\n') + '\n');
    const turns = await readChat(WALLET, 'lifovan');
    expect(turns).toHaveLength(2);
    expect(turns[0].content).toBe('one');
    expect(turns[1].content).toBe('two');
  });
});
