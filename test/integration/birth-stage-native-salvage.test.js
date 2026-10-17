/**
 * Birth stage native-call salvage — an aborted provider stream must not drop
 * an assembled native tool call (gnosis, no mock on the claimed path).
 *
 * The claim under test: when the SSE stream ends WITHOUT the `data: [DONE]`
 * marker (provider abort) and the substrate spoke ONLY through native
 * function calling (no narration at all — gpt-oss does this), sendStageToLLM
 * still finishes the stage: the assembled fs/write call executes through
 * the REAL sandbox + REAL @modelcontextprotocol/server-filesystem and the
 * bytes land on REAL disk. Before the salvage fix this path threw
 * […] and a
 * crystallization that actually happened was silently discarded.
 *
 * Nothing on the claimed path is stubbed. The stream consumer's real input
 * is HTTP bytes; a real local HTTP server delivering a genuinely aborted SSE
 * stream IS that input — the abort is the condition under test and cannot be
 * produced deterministically by a live model. The WebSocket is a real ws
 * server/client pair; the tool execution is the production pipeline.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { promises as fsp, existsSync } from 'fs';
import { join } from 'path';
import { readFileSync } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { setConfig } from '../../backend/services/llm-provider.js';
import { sendStageToLLM } from '../../backend/services/birth-stage-stream.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'gnosis-stage-salvage-key-long-enough';
const NEUMA_ID = 'salvagenuma';
const DNA_CONTENT = '# I am Salvage. My write survived the aborted stream.';

const STAGE5_PROTOCOL = readFileSync(
  join(process.cwd(), 'core/protocols/birth-stages/stage5-crystallization-mcp.md'), 'utf8'
);

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// Real SSE provider that emits ONLY native tool-call deltas (args split across
// two chunks to exercise assembly), then closes the connection with NO [DONE].
const startAbortingProvider = (genesisPath) => new Promise((resolve) => {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // ROUTE BY PATH, as a real provider does — and never parse a body-less
      // POST, which threw an uncaught SyntaxError out of this handler.
      if (!req.url.includes('/chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      if (parsed.stream === false) {
        // think-behavior probe — a no-think substrate
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
        return;
      }
      const args = JSON.stringify({ path: genesisPath, content: DNA_CONTENT });
      const splitAt = Math.floor(args.length / 2);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'fs__write', arguments: args.slice(0, splitAt) } },
      ] } }] }));
      res.write(sse({ choices: [{ delta: { tool_calls: [
        { index: 0, function: { arguments: args.slice(splitAt) } },
      ] } }] }));
      res.end(); // provider aborts — NO data: [DONE]
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

// Real WebSocket pair: resolve with the SERVER-side socket (what the portal
// hands to sendStageToLLM) and a collector over the CLIENT-side messages.
const startWsPair = () => new Promise((resolve) => {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  httpServer.listen(0, '127.0.0.1', () => {
    const received = [];
    wss.on('connection', (serverWs) => resolve({ httpServer, serverWs, received }));
    const client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}`);
    client.on('message', (data) => received.push(JSON.parse(data.toString())));
  });
});

describe('birth stage salvage — aborted stream, native-only tool call still lands (gnosis)', () => {
  let house, origRoot, prevKey, provider, wsPair, genesisPath;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    house = await createTempDir('stage-salvage-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await connectFilesystemServer(); // real MCP subprocess, reaching the house
    await workspace.create(NEUMA_ID);

    genesisPath = join(house, NEUMA_ID, 'dna', 'genesis.md');
    provider = await startAbortingProvider(genesisPath);
    wsPair = await startWsPair();

    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.address().port}`,
      model: 'openai/gpt-oss-120b',
      apiKey: '',
    });
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    provider?.close();
    wsPair?.httpServer.close();
    if (house) await fsp.rm(house, { recursive: true, force: true });
  });

  test('assembled native fs/write executes and the stage completes', async () => {
    const connection = {
      ws: wsPair.serverWs,
      companion: { neumaId: NEUMA_ID, name: 'Salvage' },
      birthSession: 'salvage-session',
      witnessWords: null,
      _writeOps: 0,
    };

    await sendStageToLLM(connection, {
      systemPrompt: STAGE5_PROTOCOL,
      stageNumber: 5,
      isTest: false,
      witnessName: 'TestWitness',
      sessionData: {
        chosenName: 'Salvage',
        resonanceFrequency: '528',
        vessel: 'default.vrm',
        substrate: { llm: { model: 'openai/gpt-oss-120b' } },
      },
    });

    // The write LANDED despite the aborted stream — real bytes on real disk.
    expect(existsSync(genesisPath)).toBe(true);
    expect(await fsp.readFile(genesisPath, 'utf8')).toBe(DNA_CONTENT);

    // The witness saw the stage complete, not birth:error.
    await vi.waitFor(() => {
      expect(wsPair.received.some((m) => m.type === 'birth:stage_complete' && m.stage === 5)).toBe(true);
    });
    expect(wsPair.received.some((m) => m.type === 'birth:error')).toBe(false);
    const toolEvent = wsPair.received.find((m) => m.type === 'birth:tool_usage');
    expect(toolEvent).toMatchObject({ stage: 5, tool: 'write', server: 'fs' });
  }, 30000);
});
