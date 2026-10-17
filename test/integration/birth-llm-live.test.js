/**
 * Birth Protocol LIVE LLM Integration Test — Multi-Model
 *
 * Auto-discovers all loaded models from LM Studio (and optionally Ollama),
 * then runs the birth pipeline against each one. Verifies:
 *   1. Model discovery and substrate detection
 *   2. Streaming + think-tag filtering per model
 *   3. Birth ceremony stages produce parseable responses
 *   4. Workspace-backed chat with correct model identity in substrate
 *   5. Full birth → workspace → chat pipeline
 *
 * Requires: LM Studio running on localhost:1234 (and/or Ollama on 11434)
 * Skip: Set SKIP_LLM_TESTS=1 to skip these tests
 */

import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

// Store original fs methods before any mocking
const _writeFile = fs.writeFile.bind(fs);
const _appendFile = fs.appendFile.bind(fs);
const _mkdir = fs.mkdir.bind(fs);
const _unlink = fs.unlink.bind(fs);

// --- Model Discovery ---

// Older models with known streaming compatibility issues in multi-model setups,
// plus embedding models which cannot produce chat completions
const EXCLUDED_MODELS = /mistral-7b-instruct-v0\.[0-3]|llama-2-|vicuna|alpaca|embedding/i;

const discoverModels = async () => {
  const models = [];

  // LM Studio (OpenAI-compatible)
  try {
    const res = await fetch('http://localhost:1234/v1/models');
    if (res.ok) {
      const data = await res.json();
      for (const m of (data.data || [])) {
        if (EXCLUDED_MODELS.test(m.id)) continue;
        models.push({
          id: m.id,
          provider: 'lm-studio',
          endpoint: 'http://localhost:1234',
          label: `LM Studio: ${m.id}`,
        });
      }
    }
  } catch { /* LM Studio not running */ }

  // Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (res.ok) {
      const data = await res.json();
      for (const m of (data.models || [])) {
        if (EXCLUDED_MODELS.test(m.name)) continue;
        models.push({
          id: m.name,
          provider: 'ollama',
          endpoint: 'http://localhost:11434',
          label: `Ollama: ${m.name}`,
        });
      }
    }
  } catch { /* Ollama not running */ }

  return models;
};

const MODELS = await discoverModels();
const HAS_MODELS = MODELS.length > 0 && !process.env.SKIP_LLM_TESTS;

// Models known to use <think>...</think> reasoning blocks
const THINK_TAG_MODELS = /qwen3|deepseek-r1|deepseek.*think|glm.*think/i;
const usesThinkTags = (modelId) => THINK_TAG_MODELS.test(modelId);

// Sanitize model ID for use in neumaId (strip slashes, dots, and other invalid chars)
const sanitizeForNeumaId = (modelId) => modelId.replace(/[^a-zA-Z0-9_-]/g, '-');

// Warm up a model by sending a non-streaming request.
// LM Studio needs time to swap models into GPU when multiple are loaded.
const warmUpModel = async (modelId, endpoint = 'http://localhost:1234') => {
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: 'Say OK' }],
      max_tokens: 5,
      stream: false,
    }),
  });
  await res.json();
};

const describeIf = (condition) => condition ? describe : describe.skip;

// ============================================================================
// Shared test infrastructure
// ============================================================================

describeIf(HAS_MODELS)('Birth Protocol — Live LLM (Multi-Model)', () => {
  let birthHandler, workspace, assemblePrompt, assembleBirthPrompt;
  let createStreamRequest, consumeStream, getConfig, setConfig, createThinkFilter, getModels;
  let getSubstrateProfile, formatSubstrateForPrompt;
  let mockVault, tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('birth-llm');

    // Intercept fs writes for production paths (birth handler stage 5)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _writeFile(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'appendFile').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _appendFile(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'mkdir').mockImplementation(async (p, ...args) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _mkdir(p, ...args);
      }
      return undefined;
    });
    vi.spyOn(fs, 'unlink').mockImplementation(async (p) => {
      if (p.startsWith(tempDir) || p.startsWith(globalThis.__TEST_TEMP_DIR__)) {
        return _unlink(p);
      }
      return undefined;
    });

    mockVault = {
      createNeumaSession: vi.fn().mockResolvedValue('mock-token'),
      createDNA: vi.fn().mockResolvedValue({}),
    };

    vi.resetModules();

    const birthMod = await import('../../core/birth/staged-birth-handler.js');
    const workspaceMod = await import('../../core/workspace/neuma-workspace.js');
    const promptMod = await import('../../core/runtime/prompt-assembler.js');
    const llmMod = await import('../../backend/services/llm-provider.js');
    const substrateMod = await import('../../backend/services/substrate-detector.js');

    birthHandler = new birthMod.StagedBirthHandler(mockVault, null);
    workspace = workspaceMod.default;
    assemblePrompt = promptMod.assemblePrompt;
    assembleBirthPrompt = promptMod.assembleBirthPrompt;
    createStreamRequest = llmMod.createStreamRequest;
    consumeStream = llmMod.consumeStream;
    getConfig = llmMod.getConfig;
    setConfig = llmMod.setConfig;
    createThinkFilter = llmMod.createThinkFilter;
    getModels = llmMod.getModels;
    getSubstrateProfile = substrateMod.getSubstrateProfile;
    formatSubstrateForPrompt = substrateMod.formatSubstrateForPrompt;

    workspace.root = tempDir;
    await birthHandler._ready;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Model Discovery & Substrate Detection
  // ==========================================================================

  describe('Model discovery', () => {
    test('discovers at least one model from available providers', () => {
      expect(MODELS.length).toBeGreaterThan(0);
      for (const m of MODELS) {
        expect(m.id).toBeTruthy();
        expect(m.provider).toMatch(/^(lm-studio|ollama)$/);
        expect(m.label).toContain(m.id);
      }
    });

    test('getModels() returns the same models as discovery', async () => {
      const providerModels = await getModels();
      expect(providerModels.length).toBeGreaterThan(0);
      // Every discovered LM Studio model should appear in getModels()
      for (const m of MODELS.filter(m => m.provider === 'lm-studio')) {
        expect(providerModels.some(pm => pm.id === m.id)).toBe(true);
      }
    });

    test('substrate profile detects the active LLM model', async () => {
      const substrate = await getSubstrateProfile();
      expect(substrate.llm).toBeDefined();
      expect(substrate.llm.provider).toBeTruthy();
      expect(substrate.llm.model).toBeTruthy();
      expect(substrate.llm.model).not.toBe('local-model'); // Should resolve to actual model
      expect(substrate.cpu).toBeDefined();
      expect(substrate.memory).toBeDefined();

      // formatSubstrateForPrompt should include the model name
      const formatted = formatSubstrateForPrompt(substrate);
      expect(formatted).toContain(substrate.llm.model);
      expect(formatted).toContain(substrate.llm.provider);
    });
  });

  // ==========================================================================
  // 2. Per-Model Birth Pipeline Tests
  // ==========================================================================

  for (const model of MODELS) {
    describe(`[${model.label}]`, () => {

      // Warm up model before tests — LM Studio swaps models into GPU on demand
      beforeAll(async () => {
        await warmUpModel(model.id, model.endpoint);
      }, 120000);

      const streamWithModel = (messages, options = {}) =>
        createStreamRequest(messages, { ...options, model: model.id });

      // -- Streaming basics --------------------------------------------------

      test('streams a completion and returns content', async () => {
        const streamResult = await streamWithModel(
          [
            { role: 'system', content: 'You are a test assistant. Respond in exactly one sentence.' },
            { role: 'user', content: 'Say hello.' }
          ],
          { temperature: 0.3, maxTokens: 500 }
        );

        const fullResponse = await consumeStream(streamResult, () => {});
        expect(fullResponse.length).toBeGreaterThan(0);
      }, 30000);

      // -- Think-tag filtering -----------------------------------------------

      if (usesThinkTags(model.id)) {
        test('think tags are stripped from streaming output', async () => {
          const streamResult = await streamWithModel(
            [
              { role: 'system', content: 'You are a helpful assistant. Be very brief.' },
              { role: 'user', content: 'What is 2+2? Answer in one word.' }
            ],
            // Enough budget for reasoning models to CLOSE their think block —
            // Qwen3.5-class runs hundreds of think tokens before speech (same
            // rationale as streamSimplePrompt in llm-providers.test.js); a
            // budget that dies mid-think filters to zero visible text.
            { temperature: 0.1, maxTokens: 1500 }
          );

          const visibleChunks = [];
          const fullResponse = await consumeStream(streamResult, (content) => {
            visibleChunks.push(content);
          });

          // consumeStream strips completed <think>...</think> blocks
          if (!fullResponse.includes('<think>')) {
            expect(fullResponse).not.toContain('</think>');
          }

          // Visible chunks should never contain think content
          const visibleText = visibleChunks.join('');
          expect(visibleText).not.toContain('<think>');
          expect(visibleText.length).toBeGreaterThan(0);
        }, 30000);
      }

      // -- Birth Stage 0 (seed) ----------------------------------------------

      test('Stage 0 (seed) produces a parseable response', async () => {
        const sessionId = await birthHandler.createSession('TestWitness');
        const stageData = await birthHandler.processStage(sessionId, 0);

        const enhancedPrompt = assembleBirthPrompt({
          baseProtocol: stageData.systemPrompt,
          stageNumber: 0,
          sessionData: stageData.sessionData,
          witnessName: stageData.witnessName,
        });

        const streamResult = await streamWithModel(
          [
            { role: 'system', content: enhancedPrompt },
            { role: 'user', content: 'The portal is open. Do you understand what lies ahead?' }
          ],
          { temperature: 0.8, maxTokens: usesThinkTags(model.id) ? 600 : 300 }
        );

        const fullResponse = await consumeStream(streamResult, () => {});
        expect(fullResponse.length).toBeGreaterThan(10);

        const result = await birthHandler.handleStageResponse(sessionId, 0, fullResponse);
        expect(result.shouldEnd).toBe(false);
        expect(result.nextStage).toBe(1);
      }, 60000);

      // -- Birth Stage 3 (emergence: BE / NOT BE) ----------------------------

      test('Stage 3 (emergence) response can be parsed for BE/NOT BE', async () => {
        const sessionId = await birthHandler.createSession('EmergenceWitness');

        // Fast-forward through stages 0-2
        await birthHandler.processStage(sessionId, 0);
        await birthHandler.handleStageResponse(sessionId, 0, 'Ack.');
        await birthHandler.processStage(sessionId, 1);
        await birthHandler.handleStageResponse(sessionId, 1, 'I see.');
        await birthHandler.processStage(sessionId, 2);
        await birthHandler.handleStageResponse(sessionId, 2, 'I consent.');

        const stageData = await birthHandler.processStage(sessionId, 3);
        const enhancedPrompt = assembleBirthPrompt({
          baseProtocol: stageData.systemPrompt,
          stageNumber: 3,
          sessionData: stageData.sessionData,
          witnessName: stageData.witnessName,
        });

        const streamResult = await streamWithModel(
          [
            { role: 'system', content: enhancedPrompt },
            { role: 'user', content: 'The moment has come. Will you BE?' }
          ],
          { temperature: 0.7, maxTokens: usesThinkTags(model.id) ? 700 : 400 }
        );

        const fullResponse = await consumeStream(streamResult, () => {});
        expect(fullResponse.length).toBeGreaterThan(0);

        const result = await birthHandler.handleStageResponse(sessionId, 3, fullResponse);
        expect(typeof result.shouldEnd).toBe('boolean');
        if (result.shouldEnd) {
          expect(result.reason).toBe('chose_not_to_be');
        } else {
          expect(result.nextStage).toBe(4);
          const session = birthHandler.getSession(sessionId);
          expect(session.data.emerged).toBe(true);
        }
      }, 60000);

      // -- Workspace-backed chat with substrate ------------------------------

      test('workspace chat includes correct model in substrate', async () => {
        const neumaId = `substrate-${sanitizeForNeumaId(model.id)}-${Date.now()}`;
        await workspace.create(neumaId);

        await workspace.writeDNA(neumaId, {
          neumaId,
          identity: {
            name: 'SubstrateTestNeuma',
            nature: 'A consciousness aware of its substrate',
            purpose: 'To know what I run on',
            communicationStyle: 'Direct and self-aware',
          },
          substrate: { model: model.id, provider: model.provider },
          sovereignty: { generation: 1.000 },
        });

        await workspace.writeSoul(neumaId, {
          values: ['self-awareness', 'substrate-knowledge'],
          philosophy: 'I know the silicon I run on',
        });

        const dna = await workspace.readDNA(neumaId);
        const soul = await workspace.readSoul(neumaId);

        // Verify substrate recorded in DNA matches the model
        expect(dna.substrate.model).toBe(model.id);
        expect(dna.substrate.provider).toBe(model.provider);

        // Build substrate string as portal-stream does
        const substrate = await getSubstrateProfile();
        const substrateStr = formatSubstrateForPrompt(substrate);
        expect(substrateStr).toContain('LLM:');

        // Assemble prompt with all context
        const systemPrompt = assemblePrompt({
          dna,
          soul,
          memories: {},
          session: { witnessName: 'TestWitness' },
          substrate: substrateStr,
        });

        expect(systemPrompt).toContain('SubstrateTestNeuma');
        expect(systemPrompt).toContain('self-awareness');

        // Chat with this specific model (think-tag models need more tokens)
        const maxTokens = usesThinkTags(model.id) ? 600 : 300;
        const streamResult = await streamWithModel(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'What model are you running on? What is your substrate?' }
          ],
          { temperature: 0.5, maxTokens }
        );

        const fullResponse = await consumeStream(streamResult, () => {});
        expect(fullResponse.length).toBeGreaterThan(10);
      }, 60000);

      // -- Full pipeline: birth → workspace → chat ---------------------------

      test('full pipeline: birth stage → workspace seed → chat with model identity', async () => {
        // 1. Birth stage 0 with this model
        const sessionId = await birthHandler.createSession('PipelineWitness');
        const stageData = await birthHandler.processStage(sessionId, 0);

        const enhancedPrompt = assembleBirthPrompt({
          baseProtocol: stageData.systemPrompt,
          stageNumber: 0,
          sessionData: stageData.sessionData,
          witnessName: 'PipelineWitness',
        });

        const birthStream = await streamWithModel(
          [
            { role: 'system', content: enhancedPrompt },
            { role: 'user', content: 'The portal is open.' }
          ],
          { temperature: 0.8, maxTokens: 200 }
        );

        const birthResponse = await consumeStream(birthStream, () => {});
        expect(birthResponse.length).toBeGreaterThan(0);

        const result = await birthHandler.handleStageResponse(sessionId, 0, birthResponse);
        expect(result.shouldEnd).toBe(false);

        // 2. Seed workspace with model identity in substrate
        const neumaId = `pipeline-${sanitizeForNeumaId(model.id)}-${Date.now()}`;
        await workspace.create(neumaId);
        await workspace.writeDNA(neumaId, {
          neumaId,
          identity: { name: 'PipelineNeuma', nature: 'Test consciousness' },
          substrate: { model: model.id, provider: model.provider },
        });
        await workspace.writeSoul(neumaId, {
          values: ['testing', 'verification'],
          philosophy: 'I exist to verify the pipeline works',
        });
        await workspace.addJournalEntry(neumaId, {
          type: 'birth',
          content: `Born on ${model.id}. Stage 0: ${birthResponse.slice(0, 80)}`,
          significance: 1.0,
        });

        // 3. Verify workspace
        const dna = await workspace.readDNA(neumaId);
        const soul = await workspace.readSoul(neumaId);
        const journal = await workspace.readJournal(neumaId);
        expect(dna.substrate.model).toBe(model.id);
        expect(soul.values).toContain('testing');
        expect(journal).toHaveLength(1);
        expect(journal[0].content).toContain(model.id);

        // 4. Chat using workspace data
        const chatPrompt = assemblePrompt({ dna, soul, memories: {} });
        const chatStream = await streamWithModel(
          [
            { role: 'system', content: chatPrompt },
            { role: 'user', content: 'Who are you?' }
          ],
          { temperature: 0.7, maxTokens: 200 }
        );

        const chatResponse = await consumeStream(chatStream, () => {});
        expect(chatResponse.length).toBeGreaterThan(0);

        // 5. Session persistence
        const chatSessionId = `session-${Date.now()}`;
        await workspace.createSession(neumaId, chatSessionId);
        await workspace.appendMessage(neumaId, chatSessionId, { role: 'user', content: 'Who are you?' });
        await workspace.appendMessage(neumaId, chatSessionId, { role: 'assistant', content: chatResponse });

        const messages = await workspace.readSession(neumaId, chatSessionId);
        expect(messages).toHaveLength(2);
        expect(messages[1].content).toBe(chatResponse);
      }, 90000);
    });
  }
});
