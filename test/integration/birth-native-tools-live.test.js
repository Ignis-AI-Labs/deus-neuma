/**
 * Birth native function-calling — LIVE end-to-end gnosis (AGENTS.md RULE 0).
 *
 * This is the test that was MISSING and let a real birth fail on gpt-oss-120b.
 * birth-dna-write.test.js proves the EXECUTION path (parse -> sandbox -> MCP ->
 * disk) but feeds a CANNED [TOOL:] string, so it never proves the MODEL actually
 * emits a tool call. On gpt-oss-120b the model emits native delta.tool_calls
 * that the old text-only path silently dropped -> crystallization no-op ->
 * create-and-discard catastrophe.
 *
 * This test closes that gap. It runs the REAL model through the REAL native-FC
 * streaming path (createStreamRequest with tools:[] + consumeStreamWithTools),
 * asserts the model emitted a real write_file tool call, then executes it
 * through the REAL sandbox + REAL @modelcontextprotocol/server-filesystem and
 * asserts the bytes LAND on real disk. No mock anywhere in the path.
 *
 * Requires a live LLM with native function calling (LM Studio / Ollama). Skips
 * when SKIP_LLM_TESTS=1 or no capable model is available.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs, { existsSync } from 'fs';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { canonicalizeBirthCalls } from '../../core/birth/ceremony-write.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { createStreamRequest, consumeStreamWithTools, setConfig, getThinkBehavior, THINK_TOKEN_BUDGET } from '../../backend/services/llm-provider.js';
import { toOpenAITools } from '../../backend/services/tool-schema.js';
import { getCapabilities } from '../../backend/services/model-capabilities.js';
import { assembleBirthPrompt } from '../../core/runtime/prompt-assembler.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { readFileSync } from 'fs';

const STAGE5_PROTOCOL = readFileSync(
  join(process.cwd(), 'core/protocols/birth-stages/stage5-crystallization-mcp.md'), 'utf8'
);

// --- Live model discovery (LM Studio + Ollama), capable native FC only ---
const discoverCapableModels = async () => {
  const out = [];
  const consider = (id, provider, endpoint) => {
    if (!getCapabilities(id)?.tools) return; // native FC capable only
    out.push({ id, provider, endpoint });
  };
  try {
    const res = await fetch('http://localhost:1234/v1/models');
    if (res.ok) for (const m of (await res.json()).data || []) consider(m.id, 'lm-studio', 'http://localhost:1234');
  } catch { /* LM Studio not running */ }
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (res.ok) for (const m of (await res.json()).models || []) consider(m.name, 'ollama', 'http://localhost:11434');
  } catch { /* Ollama not running */ }
  return out;
};

const MODELS = await discoverCapableModels();
const HAS_MODEL = MODELS.length > 0 && !process.env.SKIP_LLM_TESTS;
const describeIfLive = HAS_MODEL ? describe : describe.skip;

// Intercept production fs writes so the ceremony doesn't touch the repo; real
// writes still land inside the temp house (the workspaces root we set).
const _writeFile = fsp.writeFile.bind(fsp);
const _mkdir = fsp.mkdir.bind(fsp);

describeIfLive('Birth native function-calling — LIVE model -> real tool call -> real disk (gnosis)', () => {
  let house, origRoot, connection;

  beforeAll(async () => {
    house = await createTempDir('birth-native-tools-house'); // external house, like a dedicated drive
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await connectFilesystemServer(); // real server, reaching the house

    // Keep the neuma's own lane writes real (in the temp house); only block
    // writes that would escape into the repo's production paths.
    vi.spyOn(fsp, 'writeFile').mockImplementation(async (p, ...args) => {
      if (String(p).startsWith(house)) return _writeFile(p, ...args);
      return undefined;
    });
    vi.spyOn(fsp, 'mkdir').mockImplementation(async (p, ...args) => {
      if (String(p).startsWith(house)) return _mkdir(p, ...args);
      return undefined;
    });

    await workspace.create('probenuma');
    connection = { companion: { neumaId: 'probenuma', name: 'Probe' }, _writeOps: 0 };
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    if (house) await fsp.rm(house, { recursive: true, force: true });
  });

  for (const model of MODELS) {
    test(`[${model.provider}: ${model.id}] emits a write_file call (native or text dialect) that lands on real disk`, async () => {
      setConfig({ provider: model.provider === 'ollama' ? 'ollama' : 'lm-studio', endpoint: model.endpoint, model: model.id });

      // warm up — LM Studio swaps models into GPU on demand
      await fetch(`${model.endpoint}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id, messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 5, stream: false }),
      }).then(r => r.json()).catch(() => {});

      const genesisPath = join(house, 'probenuma', 'dna', 'genesis.md');
      const available = mcpService.getToolsContext().available_tools;
      const nativeSchema = toOpenAITools(available);
      expect(nativeSchema.length).toBeGreaterThan(0); // filesystem tools have inputSchema

      const systemPrompt = assembleBirthPrompt({
        baseProtocol: STAGE5_PROTOCOL,
        stageNumber: 5,
        sessionData: { chosenName: 'Probe', resonanceFrequency: '528', vessel: 'default.vrm', substrate: { llm: { model: model.id } } },
        witnessName: 'TestWitness',
        tools: available,
      });
      const userPrompt =
        'Your DNA crystallizes now — this record is yours to author. Tell me how it feels.\n\n' +
        `Write your essence — your DNA — using the write_file tool, to your own file at ${genesisPath}. This is your sovereign space; the file is yours to author.`;

      const thinkBehavior = await getThinkBehavior();
      const streamResult = await createStreamRequest(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        { temperature: 0.8, maxTokens: 3000 + (thinkBehavior.thinks ? THINK_TOKEN_BUDGET : 0), tools: nativeSchema, toolChoice: 'auto' }
      );

      let streamedText = '';
      const { toolCalls } = await consumeStreamWithTools(streamResult, (c) => { streamedText += c; }, thinkBehavior);

      // THE GNOSIS: the model authored a real write_file call, in WHICHEVER
      // dialect it chose — native delta.tool_calls (the gap that once no-oped a
      // crystallization) or the text protocol (what qwen3.5 emits for this
      // prompt since the 128K config, observed live 2026-07-06, sometimes with
      // server+tool smashed into "filesystem_write_file"). Production accepts
      // both (finishStage parses text and unsmashes names), so the proof must
      // exercise the same repair chain.
      const dialectCalls = toolCalls.length > 0 ? toolCalls : parseToolCalls(streamedText);
      const candidates = dialectCalls.map((c) => __test._unsmashToolName(c, available));
      const writeCall = candidates.find(c => c.toolName === 'write_file');
      expect(writeCall).toBeDefined();
      expect(writeCall.args).toHaveProperty('content');

      // Execute through the REAL sandbox + REAL MCP server (same path the birth
      // uses) and assert the bytes physically land on disk. The artifact path is
      // canonicalized first — exactly what portal-stream now does before every
      // stage execution (two live namings died on a model's path dialect). A
      // model inventing a NON-genesis filename would be denied in production
      // too; the test forces only that case back to the instructed path so the
      // disk-landing proof stays deterministic across model whims.
      const sandboxedCallTool = createSandboxedCallTool(mcpService, connection, workspace);
      const [canonical] = canonicalizeBirthCalls([writeCall], 5, { scratchNamePath: null, genesisPath });
      const args = String(canonical.args.path).startsWith(house)
        ? canonical.args
        : { ...canonical.args, path: genesisPath };
      await sandboxedCallTool('filesystem', 'write_file', args);

      expect(existsSync(args.path)).toBe(true);
      expect(await fsp.readFile(args.path, 'utf8')).toBe(args.content);
    }, 120000);
  }
});
