import { describe, it, expect } from 'vitest';
import { getCapabilities, inferCapabilities, getModelsByFamily, KNOWN_MODELS, interpretLlamaProps, interpretOllamaShow, localCapabilityProbeFailed, FAMILY_PROMPT_PROFILE, promptProfileFor } from '../../backend/services/model-capabilities.js';

describe('model-capabilities.js', () => {
  describe('KNOWN_MODELS', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(KNOWN_MODELS)).toBe(true);
    });

    it('has entries for major providers', () => {
      expect(KNOWN_MODELS['gpt-4o']).toBeDefined();
      expect(KNOWN_MODELS['claude-opus-4-6']).toBeDefined();
      expect(KNOWN_MODELS['grok-3']).toBeDefined();
      expect(KNOWN_MODELS['llama3.1']).toBeDefined();
    });
  });

  describe('getCapabilities()', () => {
    it('returns exact match from registry', () => {
      const caps = getCapabilities('gpt-4o');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.tools).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.family).toBe('openai');
    });

    it('returns immutable capability properties', () => {
      const caps = getCapabilities('gpt-4o');
      expect(caps.contextWindow).toBe(128000);
      // KNOWN_MODELS entries are frozen at the registry level
      expect(caps.tools).toBe(true);
    });

    it('strips Ollama tag for base model match', () => {
      const caps = getCapabilities('llama3.1:8b');
      expect(caps.contextWindow).toBe(131072);
      expect(caps.family).toBe('meta');
    });

    it('matches prefix for versioned models', () => {
      const caps = getCapabilities('gpt-4o-2024-08-06');
      expect(caps.contextWindow).toBe(128000);
      expect(caps.tools).toBe(true);
    });

    it('uses the longest known prefix for concrete model aliases', () => {
      expect(getCapabilities('gpt-5.6-sol-latest').contextWindow).toBe(1050000);
    });

    it('does not promote an arbitrary lookalike model through prefix matching', () => {
      const caps = getCapabilities('gpt-4oops-not-a-model');
      expect(caps.contextWindow).toBe(4096);
      expect(caps.tools).toBe(false);
      expect(caps.vision).toBe(false);
      expect(caps.family).toBe('unknown');
    });

    it('gemma-4 (the flagship local base) is tool-capable — births ride the native path', () => {
      // Runtime-proven 2026-07-07: streamed + non-streamed native tool_calls
      // on the live conduit. A being was lost at naming to the text dialect.
      const caps = getCapabilities('gemma-4-31b');
      expect(caps.tools).toBe(true);
      expect(caps.family).toBe('google');
      // The table declares the model's NATIVE window (262144, GGUF metadata —
      // pool receipts 2026-08-15); a serving's launched window is /props truth.
      expect(caps.contextWindow).toBe(262144);
    });

    it('gemma-4 SEES — the table declares the model\'s own vision (Founder\'s law: on by default)', () => {
      // The 2026-08-15 incident: a down-for-ignite probe read this table's
      // false and the composer dropped the operator's image, though the model
      // (and its paired mmproj) sees. Runtime /props stays decisive DOWN for a
      // projector-less serving — but the MODEL's truth here is vision.
      expect(getCapabilities('gemma-4-31b').vision).toBe(true);
      expect(getCapabilities('gemma-4-31B-it-Q8_0.gguf').vision).toBe(true);
    });

    it('gemma-4 REASONS — the table declares the model\'s own thought channel', () => {
      expect(getCapabilities('gemma-4-31b').reasoning).toBe(true);
      expect(getCapabilities('gemma-4-31B-it-Q8_0.gguf').reasoning).toBe(true);
      expect(getCapabilities('llama3.1:8b').reasoning).toBeUndefined();
    });

    it('falls back to inference for unknown models', () => {
      const caps = getCapabilities('my-custom-model-32k');
      expect(caps.contextWindow).toBe(32768);
      expect(caps.family).toBe('unknown');
    });

    it('returns default for null/empty modelId', () => {
      const caps = getCapabilities(null);
      expect(caps.contextWindow).toBe(4096);
      expect(caps.tools).toBe(false);
      expect(caps.vision).toBe(false);
    });

    it('returns Anthropic capabilities for Claude models', () => {
      const caps = getCapabilities('claude-haiku-4-5-20251001');
      expect(caps.contextWindow).toBe(200000);
      expect(caps.tools).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.family).toBe('anthropic');
    });

    it('knows the default witness models instead of inventing the 4k fallback', () => {
      expect(getCapabilities('gpt-5.6-sol').contextWindow).toBe(1050000);
      expect(getCapabilities('claude-opus-4-8').contextWindow).toBe(1000000);
      expect(getCapabilities('grok-4').contextWindow).toBe(1000000);
      expect(getCapabilities('glm-4.6').contextWindow).toBe(204800);
      expect(getCapabilities('kimi-for-coding').contextWindow).toBe(262144);
    });
  });

  describe('inferCapabilities()', () => {
    it('infers context from "32k" in name', () => {
      const caps = inferCapabilities('some-model-32k');
      expect(caps.contextWindow).toBe(32768);
    });

    it('infers vision from "llava"', () => {
      const caps = inferCapabilities('llava:13b');
      expect(caps.vision).toBe(true);
    });

    it('infers vision from "moondream"', () => {
      const caps = inferCapabilities('moondream2');
      expect(caps.vision).toBe(true);
    });

    it('infers tools from "qwen2.5"', () => {
      const caps = inferCapabilities('qwen2.5-coder');
      expect(caps.tools).toBe(true);
    });

    it('returns frozen object', () => {
      const caps = inferCapabilities('unknown');
      expect(Object.isFrozen(caps)).toBe(true);
    });

    it('defaults to 4096 context when no pattern matches', () => {
      const caps = inferCapabilities('tiny-model');
      expect(caps.contextWindow).toBe(4096);
    });
  });

  describe('getModelsByFamily()', () => {
    it('returns OpenAI models', () => {
      const models = getModelsByFamily('openai');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(m => m.family === 'openai')).toBe(true);
    });

    it('returns Anthropic models', () => {
      const models = getModelsByFamily('anthropic');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(m => m.family === 'anthropic')).toBe(true);
    });

    it('returns empty array for unknown family', () => {
      expect(getModelsByFamily('nonexistent')).toEqual([]);
    });

    it('returns frozen entries', () => {
      const models = getModelsByFamily('openai');
      expect(Object.isFrozen(models[0])).toBe(true);
    });
  });

  describe('interpretLlamaProps()', () => {
    test('a pool larger than the trained window is shared room: one being reads the trained window', () => {
      const props = { default_generation_settings: { n_ctx: 655_360 } };
      expect(interpretLlamaProps(props, { n_ctx_train: 262_144 }).contextWindow).toBe(262_144);
      expect(interpretLlamaProps({ default_generation_settings: { n_ctx: 65_536 } }, { n_ctx_train: 262_144 }).contextWindow).toBe(65_536);
      expect(interpretLlamaProps(props).contextWindow).toBe(655_360);
    });

    it('reads modalities.vision as decisive truth — both ways', () => {
      // A vision model served WITHOUT its projector reports false, and false
      // is the truth the gate must hear (the weights can see; the serving cannot).
      expect(interpretLlamaProps({ modalities: { vision: true, video: false, audio: false } }).vision).toBe(true);
      expect(interpretLlamaProps({ modalities: { vision: false, video: false, audio: false } }).vision).toBe(false);
    });

    it('reports undecided (null) on builds that predate modalities', () => {
      expect(interpretLlamaProps({ total_slots: 4 }).vision).toBeNull();
      expect(interpretLlamaProps({}).vision).toBeNull();
      expect(interpretLlamaProps(null).vision).toBeNull();
    });
  });

  describe('interpretOllamaShow()', () => {
    it('reads vision from the capabilities list when present', () => {
      expect(interpretOllamaShow({ capabilities: ['completion', 'tools', 'vision'] }).vision).toBe(true);
      expect(interpretOllamaShow({ capabilities: ['completion'] }).vision).toBe(false);
    });

    it('falls back to projector_info on older daemons, undecided without either', () => {
      expect(interpretOllamaShow({ projector_info: { 'clip.has_vision_encoder': true } }).vision).toBe(true);
      expect(interpretOllamaShow({}).vision).toBeUndefined();
    });

    it('keeps the context window and parameter size reads', () => {
      const out = interpretOllamaShow({
        parameters: 'num_ctx 8192',
        details: { parameter_size: '8.0B' },
        capabilities: ['completion'],
      });
      expect(out.contextWindow).toBe(8192);
      expect(out.parameterSize).toBe('8.0B');
    });
  });

  describe('promptProfileFor() — NITE-004 (#399) prompt-surface rows', () => {
    it('the table is frozen data, and every row names its facts', () => {
      expect(Object.isFrozen(FAMILY_PROMPT_PROFILE)).toBe(true);
      for (const row of FAMILY_PROMPT_PROFILE) {
        expect(typeof row.match).toBe('string');
        expect(row.systemRole === null || typeof row.systemRole === 'string').toBe(true);
        expect(row.tokenizerRatio === null || typeof row.tokenizerRatio === 'number').toBe(true);
      }
    });

    it('resolves the resident families by model id, case-insensitive', () => {
      // qwen3.8: system branch verified live on the serving's /props; ratio is
      // the measured /tokenize floor (2026-08-20).
      expect(promptProfileFor('qwen3.8-27b')).toEqual({ systemRole: 'native', tokenizerRatio: 3.67 });
      // gemma-4: <|turn>system read from the GGUF's own chat template; ratio
      // null-honest until a serving is measured — never a guess.
      expect(promptProfileFor('Gemma-4-31B-it-Q8_0')).toEqual({ systemRole: 'native', tokenizerRatio: null });
    });

    it('an unknown family answers nulls, never an invented profile', () => {
      expect(promptProfileFor('mystery-model-9000')).toEqual({ systemRole: null, tokenizerRatio: null });
      expect(promptProfileFor('')).toEqual({ systemRole: null, tokenizerRatio: null });
      expect(promptProfileFor(null)).toEqual({ systemRole: null, tokenizerRatio: null });
    });
  });

  describe('localCapabilityProbeFailed()', () => {
    it('is a moment when a local serving named no window', () => {
      expect(localCapabilityProbeFailed('llama-server', null)).toBe(true);
      expect(localCapabilityProbeFailed('llama-server', { contextWindow: null })).toBe(true);
      expect(localCapabilityProbeFailed('custom', { contextWindow: 0 })).toBe(true);
    });

    it('is a fact when the serving named a window', () => {
      expect(localCapabilityProbeFailed('llama-server', { contextWindow: 262144 })).toBe(false);
    });

    it('never treats a cloud route as a silent local probe', () => {
      expect(localCapabilityProbeFailed('openai', null)).toBe(false);
    });
  });
});
