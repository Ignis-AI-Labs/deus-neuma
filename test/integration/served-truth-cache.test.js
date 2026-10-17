/** Actual endpoint identity, simultaneous HTTP requests and cache invalidation. */
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, expect, test } from 'vitest';
import { isServing, expireServedTruth } from '../../backend/services/served-model-truth.js';

const servers = [];
const pending = new Set();
const start = async (handle, host = '127.0.0.1', port = 0) => {
  const server = createServer((req, res) => {
    pending.add(res);
    res.once('close', () => pending.delete(res));
    handle(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  servers.push(server);
  return server.address().port;
};
const answer = (res, serving) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: serving ? 'ok' : 'loading' }));
};
afterEach(async () => {
  for (const res of pending) answer(res, false);
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections(); server.close(resolve);
  })));
  expireServedTruth();
});

test('simultaneous reads share one real request', async () => {
  let hits = 0;
  const port = await start((_req, res) => { hits++; answer(res, true); });
  expect(await Promise.all(Array.from({ length: 4 }, () => isServing(port)))).toEqual([true, true, true, true]);
  expect(hits).toBe(1);
  expect(await isServing(port)).toBe(true);
  expect(hits).toBe(1);
});

test('different loopback hosts on one port never share a health result', async () => {
  const port = await start((_req, res) => answer(res, true));
  await start((_req, res) => answer(res, false), '127.0.0.2', port);
  expect(await isServing(port, '127.0.0.1')).toBe(true);
  expect(await isServing(port, '127.0.0.2')).toBe(false);
});

test('a response finishing after expiration cannot overwrite newer health', async () => {
  let release;
  let received;
  let hits = 0;
  const arrived = new Promise((resolve) => { received = resolve; });
  const port = await start((_req, res) => {
    hits++;
    if (hits === 1) { release = () => answer(res, true); received(); }
    else answer(res, false);
  });
  const old = isServing(port);
  await arrived;
  expireServedTruth();
  expect(await isServing(port)).toBe(false);
  release();
  expect(await old).toBe(true);
  expect(await isServing(port)).toBe(false);
  expect(hits).toBe(2);
});

test('completed entries expire after real elapsed time and explicit invalidation', async () => {
  let hits = 0;
  let healthy = false;
  const port = await start((_req, res) => { hits++; answer(res, healthy); });
  expect(await isServing(port)).toBe(false);
  healthy = true;
  expect(await isServing(port)).toBe(false);
  await delay(1600);
  expect(await isServing(port)).toBe(true);
  expect(hits).toBe(2);
  expireServedTruth();
  expect(await isServing(port)).toBe(true);
  expect(hits).toBe(3);
});
