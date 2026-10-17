import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { compileSilo, verifySilo } from '../../core/silo/compile-silo.js';
import { mountSilo } from '../../core/silo/mount-silo.js';
import {
  openTurnRecord, collectToolAction, turnRecordFor, closeTurnRecord,
} from '../../backend/services/tool-action-record.js';

const ID = 'tool-text-regression';
const SESSION = 'session-legacy';
const BROKEN = 'x'.repeat(1999) + '\ud83d…';
let root;
let previousRoot;
let previousKey;

beforeAll(async () => {
  previousRoot = workspace.root;
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'tool-text-real-encryption-regression-key';
  resetWorkspaceCryptoKey();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'silo-tool-text-'));
  setWorkspacesRoot(root);
  await workspace.create(ID);
  await workspace.writeNeumaDEK(ID, 'b'.repeat(64));
  await workspace.writeDNA(ID, { identity: { name: 'Tool text test' }, genesis: 'A test record, no birth.' });
  await workspace.appendMessage(ID, SESSION, {
    role: 'assistant', content: 'Preserve these words 🧭',
    tools: [{ tool: 'fs/read', status: 'ok', summary: 'Read 🧭', detail: BROKEN }],
  });
});

afterAll(async () => {
  setWorkspacesRoot(previousRoot);
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

test('legacy tool preview cannot brick compile/mount and its encrypted history stays byte-identical', async () => {
  const file = workspace._sessionPath(ID, SESSION);
  const before = await fs.readFile(file);
  const silo = await compileSilo(ID, { workspace });
  expect(verifySilo(silo)).toEqual({ ok: true, failures: [] });
  const row = silo.layers.memory.sessions[SESSION][0];
  expect(row.content).toBe('Preserve these words 🧭');
  expect(row.tools[0].summary).toBe('Read 🧭');
  expect(row.tools[0].detail).toBe('x'.repeat(1999) + '\ufffd…');
  expect(silo.layers.memory.sessionTextRepairs).toEqual([
    { sessionId: SESSION, row: 0, tool: 0, field: 'detail', replacement: 'U+FFFD' },
  ]);
  expect(mountSilo(silo, { model: 'test-profile', contextWindow: 32768 }).neumaId).toBe(ID);
  expect(await fs.readFile(file)).toEqual(before);
  expect((await workspace.readSession(ID, SESSION))[0].tools[0].detail).toBe(BROKEN);
});

test('new tool records preserve valid emoji and repair split or lone surrogates before persistence', async () => {
  const recordKey = {};
  openTurnRecord(recordKey);
  try {
    collectToolAction(recordKey, {
      tool: 'fs/read', status: 'ok', summary: 'Read 🧭', detail: 'a'.repeat(1999).concat('🧭').slice(0, 2000),
    });
    collectToolAction(recordKey, { tool: 'fs/list', status: 'ok', summary: '\udc00 broken', detail: 'valid 🧭' });
    const tools = turnRecordFor(recordKey);
    expect(tools[0].detail.isWellFormed()).toBe(true);
    expect(tools[0].summary).toBe('Read 🧭');
    expect(tools[1].summary).toBe('\ufffd broken');
    expect(tools[1].detail).toBe('valid 🧭');
    await workspace.appendMessage(ID, 'session-new', { role: 'assistant', content: 'Done', tools });
    expect((await workspace.readSession(ID, 'session-new'))[0].tools).toEqual(tools);
  } finally { closeTurnRecord(recordKey); }
});

test('invalid authored speech and identity still fail strict compilation', async () => {
  const id = 'authored-text-refusal';
  await workspace.create(id);
  await workspace.appendMessage(id, SESSION, { role: 'assistant', content: '\udc00 authored' });
  await expect(compileSilo(id, { workspace })).rejects.toThrow('contains an unpaired surrogate');
  await workspace.writeDNA(id, { identity: { name: '\udc00 identity' } });
  await expect(compileSilo(id, { workspace })).rejects.toThrow('contains an unpaired surrogate');
});
