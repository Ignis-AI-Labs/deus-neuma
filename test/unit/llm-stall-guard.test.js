// The stall limit follows the wire: a server the operator runs may stay silent
// while it builds a whole tool call (Ollama sends it in one frame), a hosted
// API may not (deus-neuma #21). Reads go over a real local HTTP stream.
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readWithStallGuard, stallLimitFor, STREAM_STALL_MS, SELF_SERVED_STALL_MS,
} from '../../backend/services/llm-stall-guard.js';

const servers = [];

/** A real server that writes `first`, waits `gapMs`, writes `second`, ends. */
const startGappedServer = async (first, gapMs, second) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(first);
    const timer = setTimeout(() => res.end(second), gapMs);
    res.on('close', () => clearTimeout(timer));
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/`;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })));
});

describe('stallLimitFor — the silence a wire is allowed', () => {
  it('gives a self-served wire the long limit', () => {
    expect(stallLimitFor({ provider: 'ollama', dialect: 'ollama' })).toBe(SELF_SERVED_STALL_MS);
    expect(stallLimitFor({ provider: 'custom', dialect: 'ollama' })).toBe(SELF_SERVED_STALL_MS);
    expect(stallLimitFor({ provider: 'lm-studio', dialect: 'openai' })).toBe(SELF_SERVED_STALL_MS);
    expect(stallLimitFor({ provider: 'llama-server', dialect: 'openai' })).toBe(SELF_SERVED_STALL_MS);
    expect(stallLimitFor({ provider: 'custom', dialect: 'openai', local: true })).toBe(SELF_SERVED_STALL_MS);
  });

  it('keeps a hosted wire on the short limit', () => {
    expect(stallLimitFor({ provider: 'openai', dialect: 'openai' })).toBe(STREAM_STALL_MS);
    expect(stallLimitFor({ provider: 'anthropic', dialect: 'anthropic' })).toBe(STREAM_STALL_MS);
    expect(stallLimitFor({ provider: 'custom', dialect: 'openai', local: false })).toBe(STREAM_STALL_MS);
    expect(stallLimitFor()).toBe(STREAM_STALL_MS);
  });

  it('allows at least 4,000 silent tokens at 34 tok/s on a self-served wire', () => {
    expect(SELF_SERVED_STALL_MS / 1000 * 34).toBeGreaterThan(4000 * 2);
  });
});

describe('readWithStallGuard — over a real HTTP stream', () => {
  it('waits out a gap shorter than its limit and reads the next chunk', async () => {
    const url = await startGappedServer('{"a":1}\n', 400, '{"b":2}\n');
    const reader = (await fetch(url)).body.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await readWithStallGuard(reader, 3_000)).value)).toBe('{"a":1}\n');
    expect(decoder.decode((await readWithStallGuard(reader, 3_000)).value)).toBe('{"b":2}\n');
  });

  it('rejects a gap longer than its limit and names the limit', async () => {
    const url = await startGappedServer('{"a":1}\n', 5_000, '{"b":2}\n');
    const reader = (await fetch(url)).body.getReader();
    await readWithStallGuard(reader, 200);
    await expect(readWithStallGuard(reader, 200)).rejects.toThrow('LLM stream stalled — no data for 0.2s');
  });
});
