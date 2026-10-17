/**
 * LIVE wire proof — the context gauge's session block rides a REAL turn.
 *
 * One real neuma turn on the real local substrate: the final
 * context:composition event must carry the session telemetry the header
 * gauge renders — messageCount, threshold, compactionCount — plus a positive
 * token total. No mock anywhere (RULE 0): real WS, real workspace on a temp
 * root, real model. Skipped honestly when no model is loaded on the local
 * substrate (same doctrine as ccr-retrieve-live).
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import workspace from '../../core/workspace/neuma-workspace.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';

const probe = await fetch('http://localhost:1234/v1/models')
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
const liveModel = probe?.data?.[0]?.id || null;

describe.skipIf(!liveModel)('context gauge — session telemetry on the real wire', () => {
  let httpServer, wss, port, tmpRoot, originalRoot;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'neuma-gauge-live-'));
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

  it('the final context:composition carries the session block the gauge renders', async () => {
    const neumaId = 'gauge-live-proof';
    await workspace.create(neumaId);
    const sessionId = `gauge-${process.pid}`;

    let connection;
    const ready = new Promise((res) => {
      wss.on('connection', (ws) => {
        connection = {
          ws,
          companion: { name: 'GaugeProof', neumaId },
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

    await streamConsciousness(connection, { thought: 'Say hello in one short sentence.' });
    await completed;

    const comps = received.filter((m) => m.type === 'context:composition');
    expect(comps.length).toBeGreaterThanOrEqual(2); // approx emission + measured/attributed emission
    const final = comps[comps.length - 1];

    // The session block: one exchange persisted (2 messages), threshold 100
    // (a short turn is nowhere near the measured boundary), zero compactions.
    expect(final.session).toEqual({ messageCount: 2, threshold: 100, compactionCount: 0 });
    // The gauge's primary number is real and positive, honestly labeled.
    expect(final.totals.tokens).toBeGreaterThan(0);
    expect(['measured', 'approx']).toContain(final.totals.tokenSource);
    console.log(`[gauge-live] model=${liveModel} tokens=${final.totals.tokens} (${final.totals.tokenSource}) session=${JSON.stringify(final.session)}`);
    client.close();
  }, 300000);
});
