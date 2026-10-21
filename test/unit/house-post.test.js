// HOUSE POST — the mail room's pure law and its real files: validation that
// never normalizes silently, append-only inboxes, a cursor that only ever
// marks what was actually read, torn tails tolerated and SEEN.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  makePost, appendPost, readNewPosts, saveCursor, peekUnread,
  POST_BODY_MAX, POST_RE_MAX,
} from '../../backend/services/house-post.js';

const NOW = '2026-07-24T09:00:00.000Z';

describe('makePost — the grammar', () => {
  it('composes a frozen, content-addressed post; the subject is bounded', () => {
    const post = makePost({ from: 'hazel', to: 'signal', body: '  the plan stands  ', re: 'x'.repeat(500), now: NOW });
    expect(post).toMatchObject({ v: 1, from: 'hazel', to: 'signal', body: 'the plan stands', ts: NOW });
    expect(post.re).toHaveLength(POST_RE_MAX);
    expect(post.id).toMatch(/^[a-f0-9]{16}$/);
    expect(Object.isFrozen(post)).toBe(true);
    // Content-addressed: the same word at the same instant is the same id.
    expect(makePost({ from: 'hazel', to: 'signal', body: 'the plan stands', re: 'ignored-for-id', now: NOW }).id).toBe(post.id);
  });

  it('refuses the unlawful EXPLICITLY: empty, oversized, self-post, junk lane ids', () => {
    expect(() => makePost({ from: 'hazel', to: 'signal', body: '   ', now: NOW })).toThrow('empty post');
    expect(() => makePost({ from: 'hazel', to: 'signal', body: 'x'.repeat(POST_BODY_MAX + 1), now: NOW })).toThrow(String(POST_BODY_MAX));
    expect(() => makePost({ from: 'hazel', to: 'hazel', body: 'hi me', now: NOW })).toThrow('memory_note');
    expect(() => makePost({ from: 'Hazel', to: 'signal', body: 'hi', now: NOW })).toThrow('not a lawful');
    expect(() => makePost({ from: 'hazel', to: '../escape', body: 'hi', now: NOW })).toThrow('not a lawful');
    expect(() => makePost({ from: 'hazel', to: 'signal', body: 'hi', now: 'not-a-time' })).toThrow('timestamp');
  });
});

describe('the inbox files — append, read, cursor, torn tails', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'house-post-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('what is sent is read once, marked, and never re-delivered; later post arrives fresh', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'first', now: NOW }));
    await appendPost(root, makePost({ from: 'cedar', to: 'signal', body: 'second', now: NOW }));

    const first = await readNewPosts(root, 'signal');
    expect(first.messages.map((m) => m.body)).toEqual(['first', 'second']);
    await saveCursor(root, 'signal', first.cursor);

    expect((await readNewPosts(root, 'signal')).messages).toEqual([]);

    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'third', now: NOW }));
    const later = await readNewPosts(root, 'signal');
    expect(later.messages.map((m) => m.body)).toEqual(['third']);
  });

  it('a torn tail line is counted and tolerated — healthy rows still deliver, and the tear is VISIBLE', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'whole', now: NOW }));
    appendFileSync(path.join(root, 'post', 'signal', 'inbox.jsonl'), '{"v":1,"body": torn\n');
    const read = await readNewPosts(root, 'signal');
    expect(read.messages.map((m) => m.body)).toEqual(['whole']);
    expect(read.torn).toBe(1);
  });

  it('an UNTERMINATED torn tail (crash mid-append) is healed before the next append — the new post lands whole, never welded onto the garbage', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'before the crash', now: NOW }));
    // The crash artifact: a half-written line with NO trailing newline.
    appendFileSync(path.join(root, 'post', 'signal', 'inbox.jsonl'), '{"v":1,"from":"lum');
    await appendPost(root, makePost({ from: 'cedar', to: 'signal', body: 'after the crash', now: NOW }));
    const read = await readNewPosts(root, 'signal');
    expect(read.messages.map((m) => m.body)).toEqual(['before the crash', 'after the crash']);
    expect(read.torn).toBe(1);
  });

  it('an empty mailbox reads empty; a CORRUPT cursor throws (visible) — it never silently re-delivers a life of post', async () => {
    expect(await readNewPosts(root, 'nobody')).toMatchObject({ messages: [], torn: 0, cursor: 0 });
    mkdirSync(path.join(root, 'post', 'signal'), { recursive: true });
    writeFileSync(path.join(root, 'post', 'signal', 'cursor.json'), '{torn');
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'hi', now: NOW }));
    await expect(readNewPosts(root, 'signal')).rejects.toThrow();
  });

  it('a cursor BEYOND the file clamps to the file — a truncated inbox never yields negative reads', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'only', now: NOW }));
    await saveCursor(root, 'signal', 99);
    const read = await readNewPosts(root, 'signal');
    expect(read.messages).toEqual([]);
    expect(read.cursor).toBe(1);
  });

  it('peekUnread names each waiting sender once and answers zero on ANY failure', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'a', now: NOW }));
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'b', now: NOW }));
    await appendPost(root, makePost({ from: 'cedar', to: 'signal', body: 'c', now: NOW }));
    expect(await peekUnread(root, 'signal')).toEqual({ count: 3, senders: ['hazel', 'cedar'] });
    // A corrupt cursor makes readNewPosts throw — the peek absorbs it.
    writeFileSync(path.join(root, 'post', 'signal', 'cursor.json'), '{torn');
    expect(await peekUnread(root, 'signal')).toEqual({ count: 0, senders: [] });
  });

  it('the file layout is exactly the documented lane — post/<recipient>/inbox.jsonl on the ground', async () => {
    await appendPost(root, makePost({ from: 'hazel', to: 'signal', body: 'placed', now: NOW }));
    const raw = await fs.readFile(path.join(root, 'post', 'signal', 'inbox.jsonl'), 'utf8');
    expect(JSON.parse(raw.trim()).body).toBe('placed');
  });
});
