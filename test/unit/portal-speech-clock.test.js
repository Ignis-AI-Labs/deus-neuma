/** Production clock over real loopback sockets and elapsed timers; no inference claim. */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { makeSpeechClock } from '../../backend/services/portal-speech-clock.js';
import { createAffectStreamFilter } from '../../core/runtime/affect-channel.js';

let server, wss, ws, client, clock, frames;
const waitFor = async (predicate) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected portal frame did not arrive');
    await delay(5);
  }
};
beforeEach(async () => {
  server = createServer();
  wss = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connected = once(wss, 'connection');
  client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  frames = [];
  client.on('message', (data) => frames.push(JSON.parse(data.toString())));
  const opened = once(client, 'open');
  [ws] = await connected;
  await opened;
  clock = makeSpeechClock({ ws, companionName: 'ClockFixture', take: { turnId: 't1', takeIndex: 2 } });
});
afterEach(async () => {
  clock.flush();
  client.terminate();
  ws.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
});

test('synchronous deltas coalesce into one actual timed frame', async () => {
  for (const text of ['hel', 'lo ', 'wor', 'ld']) clock.push(text);
  expect(frames).toHaveLength(0);
  await waitFor(() => frames.length > 0);
  expect(frames).toEqual([{ type: 'consciousness:stream', content: 'hello world',
    companion: 'ClockFixture', turnId: 't1', takeIndex: 2 }]);
});

test('flushing sends buffered speech before the next boundary without duplicates', async () => {
  clock.push('last words');
  clock.flush();
  ws.send(JSON.stringify({ type: 'tool:boundary' }));
  await waitFor(() => frames.length === 2);
  await delay(75);
  clock.flush();
  expect(frames.map((frame) => frame.type)).toEqual(['consciousness:stream', 'tool:boundary']);
  expect(frames[0].content).toBe('last words');
});

test('real affect-filter tails survive a final flush before the boundary', async () => {
  const filter = createAffectStreamFilter();
  clock.push(filter.push('hello [FEEL'));
  clock.push(filter.flush());
  clock.flush();
  ws.send(JSON.stringify({ type: 'tool:boundary' }));
  await waitFor(() => frames.length === 2);
  expect(frames[0].content).toBe('hello [FEEL');
  expect(frames[1].type).toBe('tool:boundary');
});

test('separate windows preserve order and a closed socket tolerates a pending tick', async () => {
  clock.push('one ');
  await waitFor(() => frames.length === 1);
  clock.push('two');
  clock.flush();
  await waitFor(() => frames.length === 2);
  expect(frames.map((frame) => frame.content)).toEqual(['one ', 'two']);
  const closed = once(ws, 'close');
  client.close();
  await closed;
  clock.push('disconnected');
  await delay(75);
  expect(frames).toHaveLength(2);
});
