/**
 * The operator approves exactly what the act runs (audit C5, 2026-10-19). The
 * approval frame carried only the 600-character preview, so a body past the
 * cut was approved unseen while the act ran it whole. The frame now carries
 * the whole text beside the preview whenever the preview was cut, and the
 * desk's card (stream-card-actions → the real reducer) keeps it for the
 * operator to open. REAL WebSocket pair, the REAL broker; no mock (RULE 0).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { requestToolApproval, resolveToolApproval } from '../../backend/services/tool-approval.js';
import { streamCardAction } from '../../frontend/app/RelinkShell/stream-card-actions.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';

describe('the approval card carries the whole args when the preview is cut', () => {
  let httpServer, wss, serverWs, client;
  const frames = [];

  const nextRequest = (tool) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = frames.find((m) => m.type === 'tool:approval_request' && m.tool === tool);
      if (hit) return resolve(hit);
      if (Date.now() - started > 5000) return reject(new Error('approval frame never arrived'));
      return setTimeout(tick, 10);
    };
    tick();
  });

  beforeAll(async () => {
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => wss.on('connection', (ws) => { serverWs = ws; resolve(); }));
    client = new WebSocket(`ws://127.0.0.1:${port}`);
    client.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await linked;
  });

  afterAll(() => {
    client?.close();
    wss?.close();
    httpServer?.close();
  });

  const connection = () => ({ ws: serverWs, companion: { name: 'FullArgs', neumaId: 'full-args-lane' } });

  test('a body past the preview cut reaches the desk WHOLE, and the card keeps it', async () => {
    const conn = connection();
    const body = `${'a'.repeat(650)}PAST-THE-CUT${'b'.repeat(40)}`;
    const args = { path: 'notes.md', content: body };
    const waiting = requestToolApproval(conn, { tool: 'fs/write', args });
    const request = await nextRequest('fs/write');
    expect(request.args).toContain('[truncated]');
    expect(request.args).not.toContain('PAST-THE-CUT');
    expect(request.fullArgs).toBe(JSON.stringify(args, null, 2));
    expect(request.fullArgs).toContain(body);
    const state = run([{ type: 'USER_SENT', text: 'write it' }, streamCardAction('tool:approval_request', request).action]);
    const card = streamingMsg(state).segments.find((s) => s.kind === 'approval');
    expect(card.fullArgs).toContain('PAST-THE-CUT');
    resolveToolApproval(conn, request.id, 'deny');
    expect(await waiting).toBe('deny');
  });

  test('a short body needs no second copy: the preview is the whole text', async () => {
    const conn = connection();
    const waiting = requestToolApproval(conn, { tool: 'fs/edit', args: { path: 'short.md', content: 'brief' } });
    const request = await nextRequest('fs/edit');
    expect(request.args).toContain('brief');
    expect(request.fullArgs).toBeUndefined();
    resolveToolApproval(conn, request.id, 'deny');
    expect(await waiting).toBe('deny');
  });
});
