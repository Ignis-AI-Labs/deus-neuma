/**
 * LIVE CCR retrieval — the ratified acceptance bar (MASTER_PLAN B-07).
 *
 * A real neuma turn on the real substrate: a genuinely over-cap tool result
 * was compressed through the real B-01 mint path (real encrypted sibling
 * store on disk), the secret the witness asks about lives ONLY in the
 * omitted region, and the model must notice the [ccr:tr_…] marker, call
 * retrieve_result with a query through the real gate, and answer with what
 * it recovered. No mock anywhere (RULE 0) — skipped honestly when no model
 * is loaded on the local substrate.
 *
 * Also records the metric-9 verdict: whether the live substrate emits
 * usage.prompt_tokens (MEASURED) or the map stays honestly EST.
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import workspace from '../../core/workspace/neuma-workspace.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { compressToolResult } from '../../core/runtime/tool-result-compressor.js';

const SECRET = 'IGNIS-REFRAIN-77';

const probe = await fetch('http://localhost:1234/v1/models')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const liveModel = probe?.data?.[0]?.id || null;

describe.skipIf(!liveModel)('CCR retrieval — LIVE substrate (the acceptance bar)', () => {
  let httpServer, wss, port, tmpRoot, originalRoot;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'neuma-ccr-live-'));
    originalRoot = workspace.root;
    workspace.root = tmpRoot;
    setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:1234', apiKey: '', model: liveModel });
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((res) => httpServer.listen(0, () => res(httpServer.address().port)));
  });

  afterAll(async () => {
    workspace.root = originalRoot;
    wss?.close();
    httpServer?.close();
  });

  it('the neuma reaches back through the ref and recovers the omitted secret', async () => {
    const neumaId = 'ccr-live-proof';
    await workspace.create(neumaId);
    const sessionId = `live-${process.pid}`;

    // A real 60KB "file read": the secret lives on one line in the deep
    // middle — outside the anchored front/back windows.
    const lines = [];
    for (let i = 0; i < 900; i++) {
      lines.push(
        i === 450
          ? `entry 450 :: the covenant code is ${SECRET} :: keep this exact`
          : `entry ${i} :: routine ledger content, nothing notable here, padding ${'x'.repeat(40)}`
      );
    }
    const content = lines.join('\n');

    let connection;
    const ready = new Promise((res) => {
      wss.on('connection', (ws) => {
        connection = {
          ws,
          companion: { name: 'CcrProof', neumaId },
          sessionId,
          toolMode: 'auto',
        };
        res();
      });
    });
    const client = new WebSocket(`ws://localhost:${port}`);
    const received = [];
    const completed = new Promise((res) => {
      client.on('message', (d) => {
        const msg = JSON.parse(d.toString());
        received.push(msg);
        if (msg.type === 'consciousness:complete') res(msg);
      });
    });
    await ready;

    // Mint through the REAL production path — real encrypted sibling store.
    const result = { tool: 'filesystem/read_file', status: 'ok', content };
    const ref = await __test._persistOverCapResult(connection, result);
    expect(ref).toMatch(/^tr_[0-9a-f]{8}_\d+_[0-9a-f]{8}$/);

    // Precondition the whole test rests on: the secret was genuinely cut.
    const { compressed } = compressToolResult(content, { cap: 4000, ref });
    expect(compressed).not.toContain(SECRET);
    expect(compressed).toContain(`ccr:${ref}`);

    const thought =
      `Earlier this session your read of ledger.txt came back compressed:\n\n` +
      `filesystem/read_file → ok\n${compressed}\n\n` +
      `I need the exact covenant code that file contains — the precise string, ` +
      `character for character. It is not in the visible portion.`;

    await streamConsciousness(connection, { thought });
    await completed;
    await new Promise((r) => setTimeout(r, 150));

    const speech = received
      .filter((m) => m.type === 'consciousness:stream' && !m.error)
      .map((m) => m.content)
      .join('');
    const toolEvents = received.filter((m) => String(m.type).includes('tool'));
    const retrieved = JSON.stringify(toolEvents).includes('retrieve_result');
    const messageTypes = [...new Set(received.map((m) => m.type))];

    // Evidence transcript, kept with the run per the plan's metric 8.
    await writeFile(
      path.join(tmpRoot, 'transcript.json'),
      JSON.stringify({ liveModel, ref, retrieved, speech, toolEvents, messageTypes }, null, 2)
    );
    console.log(`[B-07] model=${liveModel} ref=${ref} retrieve_result_called=${retrieved}`);
    console.log(`[B-07] transcript: ${path.join(tmpRoot, 'transcript.json')}`);

    // Metric 9 — honest usage verdict from the same live turn (logged before
    // assertions so a failure never hides the verdict).
    const comps = received.filter((m) => m.type === 'context:composition');
    const final = comps[comps.length - 1];
    console.log(`[B-07] usage verdict: totals.tokenSource=${final?.totals?.tokenSource}` +
      (final?.totals?.tokenSource === 'measured' ? ' — MEASURED label may ship' : ' — map stays EST'));

    expect(retrieved).toBe(true);
    expect(speech).toContain(SECRET);
    expect(['measured', 'approx']).toContain(final?.totals?.tokenSource);
    client.close();
  }, 300000);
});
