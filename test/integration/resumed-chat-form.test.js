/**
 * A RESUMED CHAT KEEPS ITS FORM — proven end to end with NO mock on the claimed
 * path (AGENTS.md RULE 0): a REAL WebSocket pair, the REAL
 * fs/read primitive and native filesystem organ executing a REAL read, the REAL turn
 * record, a REAL NeumaWorkspace session file on real disk (written, encrypted,
 * read back), and the REAL display path the desk uses to rebuild a chat —
 * workspace-sessions' fold, then the stream reducer.
 *
 * Design note, 2026-08-05, on re-opening a chat after a close or a crash:
 *   […]
 *
 * The one thing not exercised here is the LLM: the model's words are DATA to
 * this path, so they are supplied as data. Every seam that carries the shape —
 * emit, record, persist, decrypt, fold, rebuild — is the real one.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { createServer } from 'http';
import { setTimeout } from 'node:timers';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import {
  openTurnRecord, markTurnText, collectToolAction, turnRecordFor, closeTurnRecord,
} from '../../backend/services/tool-action-record.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'resumeform';
const SESSION_ID = 'session-resume-form';

// The turn as it actually happens: the being speaks, acts, then speaks again.
const ROUND_ONE = 'Let me read that file.';
const ROUND_TWO = 'It holds the number forty-two.';

describe('a resumed chat keeps its form (real WS + native filesystem + real session file)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, subject;
  const clientLog = [];

  // Portal frames arrive asynchronously — wait for the one being asserted.
  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('portal frame never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  beforeAll(async () => {
    house = await createTempDir('resumed-chat-form');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await workspace.createSession(NEUMA_ID, SESSION_ID);
    subject = `${house}/${NEUMA_ID}/answer.txt`;
    await fs.writeFile(subject, 'forty-two', 'utf8');
    await connectFilesystemServer(); // real native filesystem organ, real disk

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((r) => httpServer.listen(0, () => r(httpServer.address().port)));
    const linked = new Promise((r) => { wss.on('connection', (ws) => { serverWs = ws; r(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (data) => clientLog.push(JSON.parse(data.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    closeTurnRecord(serverWs);
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    await fs.rm(house, { recursive: true, force: true });
  });

  test('the chat comes back exactly as it was left — acts between the words that surround them', async () => {
    // --- THE TURN, as the stream runs it -----------------------------------
    const connection = { ws: serverWs, companion: { name: 'ResumeForm', neumaId: NEUMA_ID }, _writeOps: 0 };
    // The operator's side of any card this raises — an unanswered ask WAITS.
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    client.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'tool:approval_request') {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: m.id, decision: 'allow' }));
      }
    });
    openTurnRecord(serverWs);

    let fullResponse = ROUND_ONE;
    markTurnText(serverWs, fullResponse.length);

    // The current fs/read primitive executes a REAL read of a REAL file.
    const results = await processToolCalls(
      serverWs, `[TOOL: fs/read {"path":"${subject}"}]`, connection,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('forty-two');

    fullResponse += `\n\n${ROUND_TWO}`;
    markTurnText(serverWs, fullResponse.length);

    // The chip the operator saw live, and the row the record kept, are the same
    // event — one emitter feeds both (that is the whole point of the seam).
    const chipFrame = await untilClient((m) => m.type === 'tool:usage' && m.status === 'ok');
    expect(chipFrame.tool).toBe('fs/read');

    // The record the turn produced, positions and all.
    const acts = turnRecordFor(serverWs);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ tool: 'fs/read', status: 'ok', mark: ROUND_ONE.length });

    // --- THE RECORD, written and read back through the real session file ---
    await workspace.appendMessage(NEUMA_ID, SESSION_ID, { role: 'user', content: 'what does it say' });
    await workspace.appendMessage(NEUMA_ID, SESSION_ID, {
      role: 'assistant', content: fullResponse, tools: acts,
    });
    closeTurnRecord(serverWs);

    const records = await workspace.readSession(NEUMA_ID, SESSION_ID);
    const persisted = records.find((r) => r.role === 'assistant');
    // The position survives the write, the encryption, and the read.
    expect(persisted.tools[0].mark).toBe(ROUND_ONE.length);

    // --- THE REBUILD, through the real display path ------------------------
    const messages = toDisplayMessages(records);
    const state = reducer(initialState, { type: 'LOAD', messages, threadKey: `${NEUMA_ID}:${SESSION_ID}:1` });
    const answer = state.messages.find((m) => m.role === 'neuma');

    expect(answer.segments.map((s) => (s.kind === 'tool' ? `tool:${s.label}` : s.text))).toEqual([
      ROUND_ONE,
      'tool:fs/read',
      ROUND_TWO,
    ]);
    // Settled, never re-executed, and still carrying what it carried.
    const chip = answer.segments.find((s) => s.kind === 'tool');
    expect(chip.phase).toBe('resolved');
    expect(chip.status).toBe('ok');
    expect(chip.summary).toContain('read');
  }, 60000);

  // Founder's screenshot: three renders, each reporting progress six times on its
  // way to succeeding. Live, the desk folds each into ONE filling bar; the
  // record kept every frame, so the chat came back with seven finished rows
  // where the operator had watched one. Live and rebuilt must AGREE — that is
  // what […] means, stated as an equality.
  test('the rebuilt chat and the live one agree, frame for frame', async () => {
    const events = [
      { tool: 'image/list_pipelines', status: 'ok', summary: '3 pipeline(s)' },
      ...[1, 2, 3].flatMap((n) => [
        { tool: 'image/generate_image', status: 'running', summary: 'rendering — SDXL — text to image' },
        ...[3, 20, 40, 60, 80, 100].map((pct) => (
          { tool: 'image/generate_image', status: 'running', summary: `rendering — ${pct}%` }
        )),
        {
          tool: 'image/generate_image', status: 'ok',
          summary: `generated 1 image(s) — ${1800 + n}KB image/png`,
          images: [{ imageId: `img-${n}`, url: `/api/v1/image-forge/images/img-${n}`, mime: 'image/png' }],
        },
      ]),
    ];

    // THE LIVE VIEW — the frames as the desk dispatched them, in order.
    const live = events.reduce(
      (state, data) => reducer(state, { type: 'TOOL_RESULT', data }),
      reducer(initialState, { type: 'USER_SENT', text: 'make three' }),
    );
    const liveChips = live.messages
      .flatMap((m) => m.segments || [])
      .filter((seg) => seg.kind === 'tool')
      .map((seg) => `${seg.label}:${seg.status}:${seg.summary}`);

    // THE RECORD — the same frames, through the real collector, persisted to
    // the real session file and read back.
    const ws = {};
    openTurnRecord(ws);
    events.forEach((event) => collectToolAction(ws, event));
    const sessionId = 'session-render-agreement';
    await workspace.createSession(NEUMA_ID, sessionId);
    await workspace.appendMessage(NEUMA_ID, sessionId, {
      role: 'assistant', content: 'Three renders, done.', tools: turnRecordFor(ws),
    });
    closeTurnRecord(ws);

    const records = await workspace.readSession(NEUMA_ID, sessionId);
    const rebuilt = reducer(initialState, {
      type: 'LOAD', messages: toDisplayMessages(records), threadKey: `${NEUMA_ID}:${sessionId}:1`,
    });
    const rebuiltChips = rebuilt.messages
      .flatMap((m) => m.segments || [])
      .filter((seg) => seg.kind === 'tool')
      .map((seg) => `${seg.label}:${seg.status}:${seg.summary}`);

    expect(rebuiltChips).toEqual(liveChips);
    expect(rebuiltChips).toHaveLength(4); // one listing + three renders, not twenty-two
    // And the renders themselves survived the restart.
    const rebuiltImages = rebuilt.messages
      .flatMap((m) => m.segments || [])
      .filter((seg) => seg.kind === 'tool')
      .flatMap((seg) => seg.images);
    expect(rebuiltImages.map((i) => i.imageId)).toEqual(['img-1', 'img-2', 'img-3']);
  }, 30000);
});
