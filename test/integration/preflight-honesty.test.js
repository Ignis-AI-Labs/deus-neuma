/** Production preflight probes over real HTTP/SSE; tests response handling, not inference. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig, getActiveModel } from '../../backend/services/llm-provider.js';
import { checkSubstrate } from '../../backend/routes/preflight-checks.js';
import { probeActing } from '../../backend/services/birth-flight.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';

const SERVED_ID = '/proc/self/fd/4';
const NAME = 'qwen3.8-27b';
let provider, previousConfig, root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'preflight-honesty-'));
  await setNativeFilesystemRoots([root]);
  mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  provider = await startLocalProvider({ models: [SERVED_ID], reply: 'Hello.' });
  previousConfig = getConfig();
  setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: NAME, apiKey: '' });
});

afterAll(async () => {
  setConfig(previousConfig);
  await provider?.close();
  await fs.rm(root, { recursive: true, force: true });
});

test.each([
  ['Hello.', 'pass'], ['', 'fail'],
])('substrate display uses the honest name for %s / %s', async (reply, status) => {
  provider.setScript([reply]);
  const model = await getActiveModel();
  expect(model).toEqual({ id: SERVED_ID, name: NAME });
  const row = await checkSubstrate();
  expect(row.status).toBe(status);
  expect(row.detail).toContain(NAME);
  expect(row.detail).not.toContain('/proc/self/fd/');
  expect(provider.turns.length).toBeGreaterThan(0);
});

test('speech without a tool call is inconclusive and recommends rechecking', async () => {
  provider.setScript(['I can hear you.']);
  const row = await probeActing();
  expect(row.ok).toBe(true);
  expect(row.warn).toBe(true);
  expect(row.detail).toMatch(/probe inconclusive/i);
  expect(row.remedy).toMatch(/re.?run|recheck/i);
  expect(row.remedy).not.toMatch(/stronger|tool-tuned model/);
  expect(provider.turns.length).toBeGreaterThan(0);
});

test('an actual streamed tool-call frame still passes the probe', async () => {
  provider.setScript([{ reply: '', toolCalls: [{ name: 'write', args: { path: 'preflight.txt', content: 'ready' } }] }]);
  const row = await probeActing();
  expect(row.ok).toBe(true);
  expect(row.warn).toBeUndefined();
  expect(row.detail).toContain('a tool call came back');
});
