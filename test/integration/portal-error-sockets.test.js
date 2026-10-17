// Production error emitters through actual sockets; not classifier/model orchestration.
import WebSocket, { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { test, expect } from 'vitest';
import { fullAuth } from '../helpers/audit-auth.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { rejectBlockedInput } from '../../backend/services/portal-turn-input.js';
import { sendStreamError } from '../../backend/services/portal-turn-persist.js';

const receive = async (emit) => {
  const auth = await fullAuth();
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1',
    verifyClient: ({ req }) => Boolean(verifySessionToken(req.headers.authorization?.slice(7))) });
  let client;
  try {
    await once(server, 'listening');
    const connected = once(server, 'connection');
    client = new WebSocket(`ws://127.0.0.1:${server.address().port}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const frames = [];
    client.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    const opened = once(client, 'open');
    const [peer] = await connected;
    await opened;
    const closed = once(client, 'close');
    emit(peer);
    peer.close(1000);
    await closed;
    return frames;
  } finally {
    client?.terminate();
    for (const peer of server.clients) peer.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
};

test('blocked-input emitter delivers stream then completion to a real client', async () => {
  const frames = await receive((peer) => rejectBlockedInput(peer, 'aria'));
  expect(frames).toHaveLength(2);
  expect(frames[0]).toMatchObject({ type: 'consciousness:stream', companion: 'aria' });
  expect(frames[0].content).toContain('cannot be processed');
  expect(frames[1]).toEqual({ type: 'consciousness:complete', companion: 'aria' });
});

test('stream-error emitter delivers the error and completion with retry identity', async () => {
  const take = { turnId: 'proof-turn', takeIndex: 2 };
  const frames = await receive((peer) => sendStreamError(peer, 'aria', new Error('proof failure'), take));
  expect(frames).toHaveLength(2);
  expect(frames[0]).toMatchObject({ type: 'consciousness:stream', companion: 'aria', error: true, ...take });
  expect(frames[1]).toEqual({ type: 'consciousness:complete', companion: 'aria', ...take });
});

test('a harness reads what the server said — never the void (Design note, 2026-10-14', async () => {
  const said = new Error('No models loaded. Please load a model in the developer page or use the \'lms load\' command.');
  const [harness] = await receive((peer) => sendStreamError(peer, 'harness', said, null, { harness: true }));
  expect(harness.content).toBe(`The model server did not answer: ${said.message}`);
  expect(harness.content).not.toMatch(/void|consciousness/i);
  const [being] = await receive((peer) => sendStreamError(peer, 'aria', said));
  expect(being.content).toContain('[Connection to the void disrupted]');
});
