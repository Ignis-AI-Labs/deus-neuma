// The RECORD's count memo (core/runtime/neuma-record.js) — counts are
// remembered under each source's change stamp, so a RECORD open stops
// decrypting the whole history; any real change must still show at once.
// Real workspace, real encrypted files in a temp root — nothing stubbed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import process from 'node:process';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { buildNeumaRecord } from '../../core/runtime/neuma-record.js';

const KEY = 'record-count-memo-key-long-enough';
const ID = 'memo-lane';

describe('RECORD count memo', () => {
  let origRoot;
  beforeEach(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(await createTempDir('record-count-memo'));
  });
  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
  });

  it('stamps move with every append and every new memory file', async () => {
    const s1 = await workspace.sessionStamp(ID, 's1');
    expect(s1).toBeNull(); // no file, no stamp — the reader computes
    await workspace.appendMessage(ID, 's1', { role: 'user', content: 'one' });
    const a = await workspace.sessionStamp(ID, 's1');
    await workspace.appendMessage(ID, 's1', { role: 'assistant', content: 'two' });
    expect(await workspace.sessionStamp(ID, 's1')).not.toBe(a);

    await workspace.addObservation(ID, { type: 'moment', significance: 1 });
    const o = await workspace.memoryStoreStamp(ID, 'observations');
    expect(o).toMatch(/:1$/);
    await workspace.addObservation(ID, { type: 'moment', significance: 1 });
    expect(await workspace.memoryStoreStamp(ID, 'observations')).not.toBe(o);
  });

  it('a repeat RECORD reads the same counts, and every change shows at once', async () => {
    await workspace.appendMessage(ID, 's1', { role: 'user', content: 'hi', timestamp: '2026-10-01T00:00:00.000Z' });
    await workspace.appendMessage(ID, 's1', { role: 'assistant', content: 'hello', timestamp: '2026-10-01T00:00:05.000Z' });
    await workspace.writeEntity(ID, { name: 'Founder', type: 'person' });
    await workspace.addObservation(ID, { type: 'moment', significance: 1 });

    const first = (await buildNeumaRecord(ID, workspace)).record;
    expect(first.relationship).toMatchObject({ conversations: 1, messages: 2, exchanges: 1 });
    expect(first.memory).toMatchObject({ entities: 1, observations: 1 });
    expect((await buildNeumaRecord(ID, workspace)).record).toEqual(first);

    // A new message, a new chat, a new entity, a new observation — each counted.
    await workspace.appendMessage(ID, 's1', { role: 'user', content: 'again', timestamp: '2026-10-02T00:00:00.000Z' });
    await workspace.appendMessage(ID, 's2', { role: 'user', content: 'new chat', timestamp: '2026-10-03T00:00:00.000Z' });
    await workspace.writeEntity(ID, { name: 'Keir', type: 'being' });
    await workspace.addObservation(ID, { type: 'moment', significance: 1 });
    const next = (await buildNeumaRecord(ID, workspace)).record;
    expect(next.relationship).toMatchObject({
      conversations: 2, messages: 4, exchanges: 3,
      firstSeen: '2026-10-01T00:00:00.000Z', lastSeen: '2026-10-03T00:00:00.000Z',
    });
    expect(next.memory).toMatchObject({ entities: 2, observations: 2 });
  });

  it('a compaction (a new file renamed over the session) is read again', async () => {
    for (let i = 0; i < 30; i++) {
      await workspace.appendMessage(ID, 'long', { role: i % 2 ? 'assistant' : 'user', content: `m${i} words for the summary` });
    }
    const before = (await buildNeumaRecord(ID, workspace)).record.relationship.messages;
    expect(before).toBe(30);
    expect(await workspace.compactSession(ID, 'long', { threshold: 10, keepRecent: 5 })).toBe(true);
    const after = (await buildNeumaRecord(ID, workspace)).record.relationship.messages;
    expect(after).toBe((await workspace.readSession(ID, 'long')).length);
    expect(after).toBeLessThan(before);
  });
});
