import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { appendJsonLine, readJsonLines } from '../../backend/services/jsonl-append.js';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-jsonl-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readJsonLines', () => {
  test('reads 60,000 real records in order and counts a torn line', async () => {
    const file = path.join(dir, 'large.jsonl');
    const rows = Array.from({ length: 60000 }, (_, n) => JSON.stringify({ n })).join('\n');
    await fs.writeFile(file, `${rows}\nnot-json\n\n`, 'utf8');
    const result = await readJsonLines(file);
    expect(result.records).toHaveLength(60000);
    expect(result.records[0]).toEqual({ n: 0 });
    expect(result.records[59999]).toEqual({ n: 59999 });
    expect(result.torn).toBe(1);
  });

  test('a missing file is empty and a real append heals a torn tail', async () => {
    const file = path.join(dir, 'append.jsonl');
    expect(await readJsonLines(file)).toEqual({ records: [], torn: 0 });
    await fs.writeFile(file, '{"first":1}\n{"torn"', 'utf8');
    await appendJsonLine(file, { second: 2 });
    expect(await readJsonLines(file)).toEqual({ records: [{ first: 1 }, { second: 2 }], torn: 1 });
    expect(await fs.readFile(file, 'utf8')).toBe('{"first":1}\n{"torn"\n{"second":2}\n');
  });
});
