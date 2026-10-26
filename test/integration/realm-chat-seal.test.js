/**
 * The person's own copy of each conversation is sealed on disk and still
 * theirs to read: appendChat writes envelopes only, readChat and the export
 * text read them back, and the boot sweep seals copies written before the
 * lock without losing a line. Real files, real crypto.
 */

import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { isEnvelope } from '../../core/workspace/workspace-crypto.js';
import { appendChat, chatText, getRealmRoot, readChat, sealChatCopies, setRealmRoot } from '../../backend/services/user-realm.js';

const WALLET = `0x${'ef'.repeat(20)}`;

describe('sealed chat copies', () => {
  let before;
  beforeEach(async () => {
    before = getRealmRoot();
    setRealmRoot(await createTempDir(`realm-seal-${Math.random().toString(36).slice(2)}`));
  });
  afterEach(() => setRealmRoot(before));

  const chatFile = () => path.join(getRealmRoot(), WALLET, 'chats', 'aster.jsonl');

  test('a new exchange lands sealed and reads back whole, and exports as plain text', async () => {
    await appendChat(WALLET, 'aster', 'Aster', [{ role: 'user', content: 'the lighthouse at dusk' }, { role: 'assistant', content: 'I remember it' }]);
    const raw = await fs.readFile(chatFile(), 'utf8');
    expect(raw).not.toContain('lighthouse');
    expect(raw.trim().split('\n').every((l) => isEnvelope(JSON.parse(l)))).toBe(true);
    const turns = await readChat(WALLET, 'aster', { limit: 0 });
    expect(turns.map((t) => t.content)).toEqual(['the lighthouse at dusk', 'I remember it']);
    const text = chatText(turns);
    expect(text).toMatch(/· you\nthe lighthouse at dusk/);
    expect(text).toMatch(/· Aster\nI remember it/);
  });

  test('copies written before the lock are sealed once, every line kept', async () => {
    const legacy = [{ ts: '2026-10-01T00:00:00.000Z', neuma: 'Aster', role: 'user', content: 'old words' }];
    await fs.mkdir(path.dirname(chatFile()), { recursive: true });
    await fs.writeFile(chatFile(), legacy.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await appendChat(WALLET, 'aster', 'Aster', [{ role: 'assistant', content: 'new words' }]);
    const first = await sealChatCopies();
    expect(first).toEqual({ files: 1, lines: 1, failed: [] });
    const raw = await fs.readFile(chatFile(), 'utf8');
    expect(raw).not.toContain('old words');
    expect((await readChat(WALLET, 'aster', { limit: 0 })).map((t) => t.content)).toEqual(['old words', 'new words']);
    expect(await sealChatCopies()).toEqual({ files: 0, lines: 0, failed: [] });
  });
});
