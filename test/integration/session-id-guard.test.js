/**
 * SEC-033 (#186) — a sessionId is a filename, and it is client-supplied on
 * portal:resume and the REST session viewer. Before the guard,
 * `readSession(attacker, "../../victim/sessions/<sid>")` resolved INSIDE the
 * victim's lane and the victim's own DEK decrypted it for the attacker.
 *
 * Proven here against the REAL workspace: real temp root, real encrypted
 * writes, real reads — no mocks anywhere in the path under test (Rule 0).
 * The REST layer runs the real router behind a real witness session
 * (#390 tranche 4) that genuinely owns the attacker's own lane.
 */
import express from 'express';
import request from 'supertest';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sessionId guard (SEC-033)', () => {
  let root, workspace;

  beforeEach(async () => {
    vi.resetModules();
    root = await createTempDir('session-guard');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
  });

  test('a real session round-trips under a legit server-minted id', async () => {
    await workspace.create('victim');
    await workspace.appendMessage('victim', 'session-1', { role: 'user', content: 'the victim remembers this' });
    const messages = await workspace.readSession('victim', 'session-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('the victim remembers this');
  });

  test('traversal sessionIds are rejected on every session-lane method', async () => {
    await workspace.create('victim');
    await workspace.create('attacker');
    await workspace.appendMessage('victim', 'session-9', { role: 'user', content: 'victim-only words' });

    const traversal = '../../victim/sessions/session-9';
    await expect(workspace.readSession('attacker', traversal)).rejects.toThrow(/Invalid sessionId/);
    await expect(workspace.appendMessage('attacker', traversal, { role: 'user', content: 'forged' }))
      .rejects.toThrow(/Invalid sessionId/);
    await expect(workspace.createSession('attacker', traversal)).rejects.toThrow(/Invalid sessionId/);
    await expect(workspace.compactSession('attacker', traversal)).rejects.toThrow(/Invalid sessionId/);

    // And the victim's lane carries exactly the one honest message — the
    // rejected writes never touched it.
    const messages = await workspace.readSession('victim', 'session-9');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('victim-only words');
  });

  test('slash, dot, and empty shapes are rejected even inside the own lane', async () => {
    await workspace.create('being');
    for (const bad of ['a/b', '../x', 'a b', 'session.jsonl', '']) {
      await expect(workspace.readSession('being', bad)).rejects.toThrow(/Invalid sessionId/);
    }
  });

  test('REST session viewer rejects a malformed sessionId with 400', async () => {
    // A lane the attacker legitimately owns — the ownership gate passes, so
    // the sessionId guard is the only thing between the request and the fs.
    // Imported here (not statically) so the witness mints its token from the
    // same auth.js instance the router below will verify against — this
    // beforeEach's own resetModules is the boundary that matters.
    const { witnessFor } = await import('../helpers/witness.js');
    await workspace.create('attacker');
    const witness = await witnessFor(root, 'attacker'); // claims owner.json AND mints a paired token

    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', router);

    const res = await request(app).get('/api/v1/workspace/attacker/sessions/bad..id').set(witness.header);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid sessionId/);

    // Encoded-slash traversal never reaches the workspace at all — HTTP
    // normalization collapses it before routing — but it must never 200
    // with another lane's messages either.
    const vic = await request(app).get('/api/v1/workspace/attacker/sessions/..%2F..%2Fvictim%2Fsessions%2Fsession-9').set(witness.header);
    expect(vic.status).not.toBe(200);
    expect(vic.body.messages).toBeUndefined();
  });
});
