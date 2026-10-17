// Real HTTP requests and elapsed intervals; no timer or probe substitutions.
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { createStatusPoller } from '../../frontend/services/status-poller.js';

let server, poller, hits, stops;
const until = async (predicate) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Real poll did not arrive');
    await wait(5);
  }
};
beforeEach(async () => {
  hits = []; stops = [];
  server = createServer((req, res) => {
    hits.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ key: req.url, n: hits.length }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  poller = createStatusPoller(async key => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${key}`);
    return response.json();
  });
});
afterEach(async () => {
  stops.forEach(stop => stop());
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('one HTTP reading per interval serves both subscribers, with immediate cached delivery', async () => {
  const first = [], second = [];
  stops.push(poller.subscribe('substrate', reading => first.push(reading), 100));
  await until(() => first.length > 0);
  stops.push(poller.subscribe('substrate', reading => second.push(reading), 100));
  expect(second[0]).toEqual(first.at(-1));
  expect(poller.subscriberCount('substrate')).toBe(2);
  await until(() => second.length >= 2);
  stops.forEach(stop => stop());
  expect(second.at(-1)).toEqual(first.at(-1));
  expect(hits.length).toBe(first.length);
});

test('last unsubscribe stops real network polling and resubscribe fetches afresh', async () => {
  const seen = [];
  const stop = poller.subscribe('substrate', reading => seen.push(reading), 50);
  stops.push(stop);
  await until(() => seen.length > 0);
  stop();
  expect(poller.subscriberCount('substrate')).toBe(0);
  const before = hits.length;
  await wait(160);
  expect(hits.length).toBe(before);
  stops.push(poller.subscribe('substrate', reading => seen.push(reading), 50));
  await until(() => hits.length > before && seen.length > 1);
});

test('different keys reach their own real HTTP endpoints', async () => {
  const seen = [];
  for (const key of ['substrate', 'route:x']) {
    stops.push(poller.subscribe(key, reading => seen.push(reading), 100));
  }
  await until(() => seen.length >= 2);
  expect(seen.map(reading => reading.key)).toEqual(expect.arrayContaining(['/substrate', '/route:x']));
  expect(poller.subscriberCount('substrate')).toBe(1);
  expect(poller.subscriberCount('route:x')).toBe(1);
});

test('a hidden desk asks nothing; shown again, every owed key reads at once', async () => {
  let hidden = true;
  const gated = createStatusPoller(async key => {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/${key}`);
    return response.json();
  }, { hidden: () => hidden });
  const seen = [];
  // Born hidden, with a 60ms beat: neither the first probe nor the beats ask.
  stops.push(gated.subscribe('substrate', reading => seen.push(reading), 60));
  await wait(250);
  expect(hits.length).toBe(0);
  // Shown: wake reads at once, and the beat resumes.
  hidden = false;
  gated.wake();
  await until(() => seen.length === 1);
  await until(() => hits.length >= 3);
});

test('wake reads only owed keys — a seen desk is not asked twice', async () => {
  const gated = createStatusPoller(async key => {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/${key}`);
    return response.json();
  }, { hidden: () => false });
  const seen = [];
  stops.push(gated.subscribe('substrate', reading => seen.push(reading), 5000));
  await until(() => seen.length === 1);
  gated.wake();
  await wait(100);
  expect(hits.length).toBe(1);
});
