// Native process exit, HTTP drain/deadline, signed-session sockets and heartbeat.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import http from 'node:http';
import process from 'node:process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { expect, test } from 'vitest';

const host = fileURLToPath(new URL('../helpers/shutdown-process.js', import.meta.url));

const runShutdown = async (blocked) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shutdown-proof-'));
  const child = fork(host, [], { silent: true, execArgv: [], env: {
    ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', LOG_LEVEL: 'info',
    NEUMA_DATA_ROOT: root, WORKSPACES_ROOT: path.join(root, 'workspaces'),
    AI_WITNESSES_ROOT: path.join(root, 'witnesses'),
  } });
  let output = ''; let request; let response;
  const clients = [];
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'exit');
  const finished = once(child, 'close');
  try {
    const ready = await Promise.race([
      once(child, 'message').then(([value]) => value),
      exited.then(([code]) => { throw new Error(`Shutdown host exited before ready (${code}): ${output}`); }),
    ]);
    for (const route of ['portal', 'portal', 'terminal']) {
      const client = new WebSocket(`ws://127.0.0.1:${ready.port}/${route}`, {
        headers: { Authorization: `Bearer ${ready.token}` },
      });
      clients.push(client);
      await once(client, 'open');
    }
    if (blocked) {
      request = http.get(`http://127.0.0.1:${ready.port}/hold`);
      [response] = await once(request, 'response');
      // An incomplete real response emits ECONNRESET when the child exits.
      response.on('error', (error) => { output += `\nHTTP:${error.code}`; });
      response.resume();
    }
    const closed = clients.map((client) => once(client, 'close'));
    const started = performance.now();
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    const elapsed = performance.now() - started;
    const frames = await Promise.all(closed);
    await finished;
    return { code, signal, elapsed, frames, output };
  } finally {
    request?.destroy();
    response?.destroy();
    for (const client of clients) client.terminate();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await finished;
    await fs.rm(root, { recursive: true, force: true });
  }
};

test('shutdown stops the real heartbeat, closes all peers and exits zero after HTTP drain', async () => {
  const result = await runShutdown(false);
  expect(result.code).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.frames.map(([code, reason]) => [code, reason.toString()])).toEqual([
    [1001, 'Server shutting down'], [1001, 'Server shutting down'], [1001, 'Server shutting down'],
  ]);
  expect(result.output).toContain('Heartbeat started');
  expect(result.output).toContain('Heartbeat stopped');
  expect(result.output).toContain('Server closed — shutdown complete');
  expect(result.output.indexOf('Heartbeat stopped')).toBeLessThan(result.output.indexOf('Server closed — shutdown complete'));
  expect(result.output).not.toContain('forcing exit');
}, 15_000);

test('an actual unfinished HTTP response reaches the real deadline and exits one', async () => {
  const result = await runShutdown(true);
  expect(result.code).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.elapsed).toBeGreaterThanOrEqual(450);
  expect(result.elapsed).toBeLessThan(10_000);
  expect(result.frames.map(([code]) => code)).toEqual([1001, 1001, 1001]);
  expect(result.output).toContain('Heartbeat stopped');
  expect(result.output).toContain('Graceful shutdown timed out — forcing exit');
  expect(result.output).not.toContain('Server closed — shutdown complete');
}, 15_000);
