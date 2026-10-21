/**
 * Per-message text documents (PROJ-03): the redemption discrimination and the
 * turn-composition, proven against the REAL attachment store singleton the
 * portal uses — no mocks. Images redeem to data-URI strings, documents to
 * { name, text }, from the same id list; the docs block fences each body so a
 * document's own code fence cannot break out.
 */

import { describe, test, expect, vi } from 'vitest';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { createTempDir } from '../helpers/temp-fs.js';

const { _redeemAttachments, composeDocsBlock } = __test;

const WALLET = '0xAaAa000000000000000000000000000000000009';
const IMG = 'data:image/png;base64,AAAA';

describe('_redeemAttachments — images and documents from one id list', () => {
  test('splits a mixed batch into images (strings) and docs (objects)', () => {
    const doc = { kind: 'text', name: 'vad.js', text: 'export const x = 1;' };
    const { ids } = attachmentStore.put(WALLET, [IMG, doc]);
    const r = _redeemAttachments({ walletAddress: WALLET }, ids);
    expect(r.ok).toBe(true);
    expect(r.images).toEqual([IMG]);
    expect(r.docs).toEqual([{ name: 'vad.js', text: 'export const x = 1;' }]);
  });

  test('no attachments → empty images and docs', () => {
    expect(_redeemAttachments({ walletAddress: WALLET }, undefined)).toEqual({ ok: true, images: [], docs: [] });
  });

  test('an expired/foreign id fails the whole batch (never a half-send)', () => {
    const { ids } = attachmentStore.put(WALLET, [{ kind: 'text', name: 'a', text: 'b' }]);
    // A different wallet cannot redeem it.
    const r = _redeemAttachments({ walletAddress: '0xBbBb000000000000000000000000000000000008' }, ids);
    expect(r.ok).toBe(false);
  });

  test('a malformed id list is refused', () => {
    expect(_redeemAttachments({ walletAddress: WALLET }, [42]).ok).toBe(false);
  });

  test('an unrecognized payload shape fails the whole batch (exhaustive union, never a silent half-send)', () => {
    // Force a future/foreign shape directly into the store: take() would consume
    // it, so the redeemer must surface a failure rather than drop it silently.
    const { ids } = attachmentStore.put(WALLET, [{ kind: 'video', blob: 'x' }]);
    const r = _redeemAttachments({ walletAddress: WALLET }, ids);
    expect(r.ok).toBe(false);
  });
});

describe('composeDocsBlock — documents ride the turn as fenced text', () => {
  test('one document: heading, fenced body, a singular note', () => {
    const block = composeDocsBlock([{ name: 'notes.md', text: 'amplitude → mouth' }]);
    expect(block).toContain('1 document is attached');
    expect(block).toContain('### notes.md');
    expect(block).toContain('amplitude → mouth');
  });

  test('no documents → empty string (nothing appended to the turn)', () => {
    expect(composeDocsBlock([])).toBe('');
    expect(composeDocsBlock(undefined)).toBe('');
  });

  test('a body that itself contains a code fence gets a longer outer fence', () => {
    const block = composeDocsBlock([{ name: 'readme.md', text: 'before\n```\nfenced\n```\nafter' }]);
    expect(block).toContain('````'); // 4-backtick outer fence encloses the 3-backtick body
  });

  test('plural note for multiple documents', () => {
    const block = composeDocsBlock([{ name: 'a', text: 'x' }, { name: 'b', text: 'y' }]);
    expect(block).toContain('2 documents are attached');
    expect(block).toContain('### a');
    expect(block).toContain('### b');
  });
});

describe('documents persist on the session record (real workspace round-trip)', () => {
  test('appendMessage keeps a docs field, readSession hands it back', async () => {
    const root = await createTempDir('docs-persist');
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    const ws = (await import('../../core/workspace/neuma-workspace.js')).default;

    // A birthed neuma has its workspace dirs; this test forges only what the
    // round-trip needs (createSession does not mkdir).
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.mkdir(path.join(root, 'n-docs', 'sessions'), { recursive: true });
    await ws.createSession('n-docs', 'session-1');
    const docs = [{ name: 'notes.md', text: '# what the neuma saw' }];
    await ws.appendMessage('n-docs', 'session-1', { role: 'user', content: 'look at this', docs });

    const session = await ws.readSession('n-docs', 'session-1');
    const userRec = session.find((m) => m.role === 'user');
    expect(userRec.docs).toEqual(docs); // the durable copy survives a reload
    vi.restoreAllMocks();
  });
});

// THE ROOM (ruling, 2026-10-06): an attached document rides whole when the turn
// has room for it; when it does not, the lines that fit ride with an honest
// note, and the block's header never claims full contents it does not carry.
describe('composeDocsBlock — fitted to the turn\'s room', () => {
  const report = (lines) => Array.from({ length: lines }, (_, i) => `finding ${i + 1}: ${'detail '.repeat(10)}`).join('\n');

  test('room to spare: every document whole, and the header says so', () => {
    const docs = [{ name: 'a.md', text: report(200) }, { name: 'b.md', text: report(50) }];
    const block = composeDocsBlock(docs, { window: 262144, promptTokens: 20000 });
    expect(block).toMatch(/^\[2 documents are attached to this message — their full contents are below\.\]/);
    expect(block).toContain(report(200));
    expect(block).toContain(report(50));
    expect(block).not.toMatch(/this document is ~/);
  });

  test('too big for the room: the lines that fit, the note, and nothing claimed whole', () => {
    const docs = [{ name: 'huge.md', text: report(3000) }, { name: 'after.md', text: report(5) }];
    const block = composeDocsBlock(docs, { window: 32768, promptTokens: 18000 });
    expect(block).toMatch(/as much as fits — read the note on any document that was cut/);
    expect(block).not.toMatch(/full contents are below/);
    expect(block).toMatch(/\[this document is ~\d+k tokens \(3000 lines\); this conversation had room for ~\d+ — only lines 1–\d+ fit below\. Even a fresh chat \(~33k-token window\) cannot hold all of it at once\. Tell your operator plainly/);
    expect(block).toMatch(/### after\.md\n`+\n\[this document is ~\d+ tokens \(5 lines\)[^\]]*none of it fits below/);
    expect(block.length).toBeLessThan(3 * (32768 - 18000 - 8192) + 2000);
  });

  test('no room given (another seat): the documents ride as they always did', () => {
    const docs = [{ name: 'a.md', text: report(3000) }];
    expect(composeDocsBlock(docs)).toContain(report(3000));
  });
});
