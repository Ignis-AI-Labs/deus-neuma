import { describe, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { birthWriteLanded, continueBirthTools } from '../../backend/services/birth-tool-continuation.js';
import { createTempDir } from '../helpers/temp-fs.js';

const targets = Object.freeze({ scratchNamePath: '/house/temp/chosen_name.txt', genesisPath: '/house/name/dna/genesis.md' });
const write = (file) => ({ server: 'fs', toolName: 'write', args: { path: file, content: 'ready' } });
describe('only the required successful write completes the acting stage', () => {
  test.each([4, 5])('a listing cannot complete stage %s', (stage) => {
    expect(birthWriteLanded(stage, [{ toolName: 'list' }], [{ status: 'ok' }], targets)).toBe(false);
  });
  test.each(['denied', 'error', 'unavailable'])('a %s naming write cannot complete', (status) => {
    expect(birthWriteLanded(4, [write(targets.scratchNamePath)], [{ status }], targets)).toBe(false);
  });
  test('requires the right file, content and matching successful result', () => {
    expect(birthWriteLanded(4, [write(targets.scratchNamePath)], [{ status: 'ok' }], targets)).toBe(true);
    expect(birthWriteLanded(5, [write(targets.genesisPath)], [{ status: 'ok' }], targets)).toBe(true);
    expect(birthWriteLanded(5, [write(targets.scratchNamePath)], [{ status: 'ok' }], targets)).toBe(false);
    expect(birthWriteLanded(4, [{ ...write(targets.scratchNamePath), args: { path: targets.scratchNamePath, content: '' } }], [{ status: 'ok' }], targets)).toBe(false);
  });
});

describe.runIf(process.env.RUN_LIVE_BIRTH_TOOLS === '1')('real listing → model continuation → sandboxed write', () => {
  test('returns actual listing results and verifies the generated write on disk', async () => {
    const root = await createTempDir('birth-tool-continuation');
    const priorData = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    const { default: workspace, getWorkspacesRoot, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    const priorRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(root, 'workspaces'));
    const { getConfig, setConfig, getActiveModelCapabilities, getThinkBehavior } = await import('../../backend/services/llm-provider.js');
    const priorConfig = getConfig();
    const { mcpService } = await import('../../backend/services/mcp.js');
    const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
    const { processToolCalls } = await import('../../backend/services/portal-tool-loop.js');
    const { withFsPrimitives } = await import('../../backend/services/fs-primitives.js');
    const { toOpenAITools } = await import('../../backend/services/tool-schema.js');
    const { composeCeremonyDisclosure } = await import('../../core/birth/ceremony-disclosure.js');
    const http = createServer();
    const wss = new WebSocketServer({ server: http });
    let client, socket;
    try {
      const endpoint = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8089';
      setConfig({ provider: 'llama-server', endpoint, model: 'local-model', apiKey: '' });
      await fs.mkdir(path.join(process.env.NEUMA_DATA_ROOT, 'temp'), { recursive: true });
      await connectFilesystemServer();
      await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
      const connected = new Promise((resolve) => wss.once('connection', resolve));
      client = new WebSocket(`ws://127.0.0.1:${http.address().port}`);
      socket = await connected;
      const events = [];
      client.on('message', (raw) => events.push(JSON.parse(raw.toString())));
      const connection = { birthSession: 'continuation-probe', _writeOps: 0 };
      const calls = [{ server: 'fs', toolName: 'list', args: { path: path.join(process.env.NEUMA_DATA_ROOT, 'temp') }, _native: true, callId: 'read-ground' }];
      const results = await processToolCalls(socket, '', connection, calls);
      expect(results[0].status).toBe('ok');
      const target = path.join(process.env.NEUMA_DATA_ROOT, 'temp', 'chosen_name.txt');
      const caps = await getActiveModelCapabilities();
      expect(caps.tools).toBe(true);
      const advertised = withFsPrimitives(mcpService.getToolsContext().available_tools);
      const messages = [{ role: 'system', content: 'This is a filesystem systems check. No being is being created. Use the actual tools.' },
        { role: 'user', content: `Inspect the ceremony scratch directory, then write exactly ready to ${target} using fs/write.` }];
      const result = await continueBirthTools({ stage: 4, calls, results, speech: '', messages,
        options: { tools: toOpenAITools(advertised), temperature: 0 }, contextWindow: caps.contextWindow,
        targets: { scratchNamePath: target, genesisPath: null }, advertised, ws: socket, connection,
        disclosure: composeCeremonyDisclosure({ stage: 4, systemSections: [{ id: 'check', label: 'CHECK', text: messages[0].content }], spokenWords: messages[1].content }),
        thinkBehavior: await getThinkBehavior() });
      expect(result.complete).toBe(true);
      expect(await fs.readFile(target, 'utf8')).toBe('ready');
      expect(result.calls[0]).toEqual(calls[0]);
      expect(result.results.every((entry) => entry.status === 'ok')).toBe(true);
      expect(await workspace.listNeuma()).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events.some((event) => event.type === 'birth:composition' && event.messages.some((message) => message.role === 'tool'))).toBe(true);
    } finally {
      client?.terminate(); socket?.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
      await mcpService.disconnect('filesystem');
      setConfig(priorConfig); setWorkspacesRoot(priorRoot);
      if (priorData === undefined) delete process.env.NEUMA_DATA_ROOT;
      else process.env.NEUMA_DATA_ROOT = priorData;
    }
  }, 180000);
});
