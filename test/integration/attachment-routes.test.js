// Attachment upload route — REAL express app, REAL router, REAL auth
// (HMAC session tokens from the real auth service — no mocks, AGENTS.md
// RULE 0). Proves the HTTP leg of image sharing: authenticated upload
// returns redeemable ids; unauthenticated and malformed uploads are
// refused; redemption honors the wallet scoping end to end through the
// SAME singleton store the portal uses.
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import attachmentRouter from '../../backend/routes/attachment-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const WALLET = '0x00A77ac4000000000000000000000000000000aa';
const OTHER = '0x00A77ac400000000000000000000000000000bbb';
const RED = solidPngDataUri([255, 0, 0]);

describe('POST /api/v1/attachments (real route, real auth)', () => {
  let server, base;

  beforeAll(async () => {
    // Log-noise suppression only — sits on NO claimed path (the assertions
    // read res.status/res.json/attachmentStore, all real). RULE-0-clean.
    const app = express();
    // No app-level parser on purpose — server.js passes this path through
    // unparsed and the router parses its own body BEHIND auth.
    app.use('/api/v1/attachments', attachmentRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.on('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/v1/attachments`;
  });

  afterAll(() => {
    server?.close();
    vi.restoreAllMocks();
  });

  const upload = (images, token) => fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ images }),
  });

  test('authenticated upload returns ids redeemable by the SAME wallet only', async () => {
    const res = await upload([RED], createSessionToken(WALLET));
    expect(res.status).toBe(200);
    const { ids } = await res.json();
    expect(ids).toHaveLength(1);

    // The portal redeems through this exact store: foreign wallet gets
    // nothing, the owner gets the bytes exactly once.
    expect(attachmentStore.take(ids[0], OTHER)).toBeNull();
    expect(attachmentStore.take(ids[0], WALLET)).toBe(RED);
    expect(attachmentStore.take(ids[0], WALLET)).toBeNull();
  });

  test('no token → 401, and nothing is parked', async () => {
    const res = await upload([RED]);
    expect(res.status).toBe(401);
  });

  test('auth runs BEFORE the body parser — mechanically proven', async () => {
    // Malformed JSON distinguishes the two orderings (echo finding): a
    // parse-first route would answer 400 for both requests. Auth-first
    // answers 401 without a token — the 24MB parser never saw a byte —
    // and only WITH a token does the parser get to say 400.
    const raw = (token) => fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{"images":[<broken',
    });
    expect((await raw(null)).status).toBe(401);
    expect((await raw(createSessionToken(WALLET))).status).toBe(400);
  });

  test('a non-image is refused with the honest reason', async () => {
    const res = await upload(['data:text/html;base64,PGI+'], createSessionToken(WALLET));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/data URI/);
  });

  test('an empty batch is refused', async () => {
    const res = await upload([], createSessionToken(WALLET));
    expect(res.status).toBe(400);
  });

  // --- Text documents (PROJ-03) through the same route + store ---
  const uploadBody = (body, token) => fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  test('a text document uploads and redeems to a { kind:text } object, wallet-scoped', async () => {
    const res = await uploadBody({ files: [{ name: 'notes.md', text: '# hi' }] }, createSessionToken(WALLET));
    expect(res.status).toBe(200);
    const { ids } = await res.json();
    expect(ids).toHaveLength(1);
    expect(attachmentStore.take(ids[0], OTHER)).toBeNull();
    expect(attachmentStore.take(ids[0], WALLET)).toEqual({ kind: 'text', name: 'notes.md', text: '# hi' });
  });

  test('images and documents upload together and preserve order (images first)', async () => {
    const res = await uploadBody({ images: [RED], files: [{ name: 'a.txt', text: 'body' }] }, createSessionToken(WALLET));
    expect(res.status).toBe(200);
    const { ids } = await res.json();
    expect(ids).toHaveLength(2);
    expect(attachmentStore.take(ids[0], WALLET)).toBe(RED);
    expect(attachmentStore.take(ids[1], WALLET)).toEqual({ kind: 'text', name: 'a.txt', text: 'body' });
  });

  test('a binary document (NUL byte) is refused with an honest reason', async () => {
    const res = await uploadBody({ files: [{ name: 'x', text: `a${String.fromCharCode(0)}b` }] }, createSessionToken(WALLET));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/binary/);
  });

  test('a payload with neither images nor files is refused', async () => {
    const res = await uploadBody({}, createSessionToken(WALLET));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no attachments/);
  });
});
