/**
 * Image sharing — LIVE (real LM Studio substrate, real WebSocket pair, the
 * real attachment store). The witness parks a REAL solid-red PNG, the turn
 * redeems it, the vision-language substrate looks at it and says what it
 * sees. No mock anywhere on the claimed path (AGENTS.md RULE 0): if this
 * passes, a pasted image demonstrably reached the model's eyes.
 *
 * Also proves the honest refusals: an unknown/expired attachment id refuses
 * the turn out loud instead of silently sending text alone.
 *
 * Skips honestly when LM Studio is not running or the loaded model has no
 * vision (the gate itself is then the thing refusing — by design).
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const WALLET = '0x000000000000000000000000000000000000d00d';
const RED = solidPngDataUri([255, 0, 0], 64, 64);

const probe = await fetch('http://localhost:1234/api/v0/models')
  .then(async (r) => (r.ok ? (await r.json()).data?.some((m) => m.type === 'vlm' && m.state === 'loaded') : false))
  .catch(() => false);

// One live portal turn over a real ws pair. Returns everything the client received.
const runTurn = async (message) => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));

  let connection;
  const ready = new Promise((resolve) => {
    wss.on('connection', (ws) => {
      connection = { ws, companion: { name: 'VisionEcho' }, walletAddress: WALLET };
      resolve();
    });
  });
  const client = new WebSocket(`ws://localhost:${port}`);
  const received = [];
  const completed = new Promise((resolve) => {
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      received.push(msg);
      if (msg.type === 'consciousness:complete') resolve(msg);
    });
  });
  await ready;
  try {
    await streamConsciousness(connection, message);
    await completed;
    return received;
  } finally {
    client.close();
    wss.close();
    httpServer.close();
  }
};

const speechOf = (received) => received
  .filter((m) => m.type === 'consciousness:stream' && !m.error)
  .map((m) => m.content).join('');

describe.skipIf(!probe)('image sharing — live vision substrate', () => {
  it('a parked image reaches the substrate, and it says what it sees', async () => {
    const parked = attachmentStore.put(WALLET, [RED]);
    expect(parked.ok).toBe(true);

    const received = await runTurn({
      thought: 'Look at the attached image and answer in one short sentence: what solid color fills it?',
      attachments: parked.ids,
    });

    expect(received.some((m) => m.error)).toBe(false);
    // The model is looking at pure #FF0000 — if it can see, it says red.
    expect(speechOf(received)).toMatch(/red/i);
    // Redeemed: the id is spent, not lingering.
    expect(attachmentStore.take(parked.ids[0], WALLET)).toBeNull();
  }, 300_000);

  it('an unknown attachment id refuses the whole turn out loud', async () => {
    const received = await runTurn({
      thought: 'What color is this?',
      attachments: ['00000000-0000-4000-8000-000000000000'],
    });

    const refusal = received.find((m) => m.error);
    expect(refusal?.content).toMatch(/\[Images not sent\]/);
    // ...and the substrate never spoke: the text did not go alone.
    expect(speechOf(received)).toBe('');
  }, 60_000);
});
