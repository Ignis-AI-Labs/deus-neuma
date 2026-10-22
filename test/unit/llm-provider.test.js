import { getConfig, setConfig, createThinkFilter, stripThinkTags, getThinkBehavior, classifyThinkBehavior, consumeStream, isAuxiliaryModel, selectActiveModel, readStreamLine } from '../../backend/services/llm-provider.js';
import { getRecentIssues } from '../../backend/services/logger.js';

describe('LLM Provider', () => {
  afterEach(() => {
    // Reset active config between tests
    setConfig({
      provider: 'lm-studio',
      endpoint: 'http://localhost:1234',
      apiKey: '',
      model: 'local-model',
      temperature: 0.8,
      maxTokens: 4096,
      topP: 0.95,
    });
  });

  // The real mislink this guards against: the memory layer's summarizer was
  // first in LM Studio's /v1/models list, and models[0] became "the mind".
  describe('selectActiveModel (pure — real /v1/models shapes)', () => {
    const LOADED = [
      { id: 'gemma-summarizer', name: 'gemma-summarizer' },
      { id: 'qwen3.5-122b-a10b', name: 'qwen3.5-122b-a10b' },
    ];

    test('flags service models as auxiliary', () => {
      expect(isAuxiliaryModel('gemma-summarizer')).toBe(true);
      expect(isAuxiliaryModel('qwen3.5-122b-a10b')).toBe(false);
      expect(isAuxiliaryModel(null)).toBe(false);
    });

    test('never falls back to an auxiliary model — the summarizer is not a substrate', () => {
      expect(selectActiveModel(LOADED, [])?.id).toBe('qwen3.5-122b-a10b');
      expect(selectActiveModel([LOADED[0]], [])).toBeNull();
    });

    test('prefers explicit ids in order: user config, then configured substrate', () => {
      expect(selectActiveModel(LOADED, ['qwen3.5-122b-a10b'])?.id).toBe('qwen3.5-122b-a10b');
      expect(selectActiveModel(LOADED, [null, 'qwen3.5-122b-a10b'])?.id).toBe('qwen3.5-122b-a10b');
      // an explicitly chosen auxiliary is honored — exclusion is only a fallback rule
      expect(selectActiveModel(LOADED, ['gemma-summarizer'])?.id).toBe('gemma-summarizer');
    });

    test('ignores the local-model placeholder and unknown ids', () => {
      expect(selectActiveModel(LOADED, ['local-model'])?.id).toBe('qwen3.5-122b-a10b');
      expect(selectActiveModel(LOADED, ['not-downloaded'])?.id).toBe('qwen3.5-122b-a10b');
      expect(selectActiveModel([], ['qwen3.5-122b-a10b'])).toBeNull();
    });
  });

  describe('getConfig', () => {
    test('returns default config when nothing set', () => {
      const config = getConfig();
      expect(config.provider).toBe('lm-studio');
      expect(config.endpoint).toBe('http://localhost:1234');
      expect(config.model).toBe('local-model');
      expect(config.temperature).toBe(0.8);
      expect(config.maxTokens).toBe(4096);
    });
  });

  describe('setConfig', () => {
    test('updates provider configuration', () => {
      setConfig({ provider: 'ollama', endpoint: 'http://localhost:11434' });
      const config = getConfig();
      expect(config.provider).toBe('ollama');
      expect(config.endpoint).toBe('http://localhost:11434');
    });

    test('preserves existing config when partially updated', () => {
      setConfig({ provider: 'openai' });
      const config = getConfig();
      expect(config.provider).toBe('openai');
      expect(config.temperature).toBe(0.8); // Preserved from defaults
    });

    test('returns frozen config object', () => {
      setConfig({ provider: 'ollama' });
      const config = getConfig();
      expect(() => { config.provider = 'test'; }).toThrow();
    });

    test('updates model and temperature', () => {
      setConfig({ model: 'llama3', temperature: 0.5 });
      const config = getConfig();
      expect(config.model).toBe('llama3');
      expect(config.temperature).toBe(0.5);
    });

    test('sets anthropic provider with API key', () => {
      setConfig({ provider: 'anthropic', apiKey: 'sk-ant-test123', model: 'claude-opus-4-6' });
      const config = getConfig();
      expect(config.provider).toBe('anthropic');
      expect(config.apiKey).toBe('sk-ant-test123');
      expect(config.model).toBe('claude-opus-4-6');
    });
  });

  describe('createThinkFilter', () => {
    test('passes through normal content unchanged', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('Hello');
      filter(' world');
      expect(chunks).toEqual(['Hello', ' world']);
    });

    test('strips <think>...</think> blocks from streaming tokens', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('<think>');
      filter('internal reasoning');
      filter('</think>');
      filter('Hello!');
      expect(chunks).toEqual(['Hello!']);
    });

    test('handles think tags within a single chunk', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('Before<think>hidden</think>After');
      expect(chunks).toEqual(['Before', 'After']);
    });

    test('handles content before opening think tag', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('Visible ');
      filter('<think>');
      filter('hidden');
      filter('</think>');
      filter(' also visible');
      expect(chunks).toEqual(['Visible ', ' also visible']);
    });

    test('handles multiple think blocks', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('<think>first</think>');
      filter('A');
      filter('<think>second</think>');
      filter('B');
      expect(chunks).toEqual(['A', 'B']);
    });

    test('strips Gemma 4 <|channel>thought ... <channel|> blocks', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('<|channel>thought');
      filter('\n*   Planning the response...');
      filter('<channel|>');
      filter('Just wanted to say hi.');
      expect(chunks).toEqual(['Just wanted to say hi.']);
    });

    test('strips Gemma 4 channel block arriving as a single chunk', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('<|channel>thought\nreasoning here<channel|>Final answer.');
      expect(chunks).toEqual(['Final answer.']);
    });

    test('handles interleaved content around a Gemma 4 channel block', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('Visible prefix ');
      filter('<|channel>thought\ninternal<channel|>');
      filter('visible suffix');
      expect(chunks).toEqual(['Visible prefix ', 'visible suffix']);
    });

    test('handles both Qwen and Gemma 4 channel formats in one stream', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c));
      filter('<think>qwen reasoning</think>');
      filter('part A ');
      filter('<|channel>thought\ngemma reasoning<channel|>');
      filter('part B');
      expect(chunks).toEqual(['part A ', 'part B']);
    });

    test('implicitOpen: suppresses reasoning that arrives with no opening marker', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c), { implicitOpen: true });
      filter('Thinking Process:\n1. Analyze the request');
      filter('...done.\n</think>');
      filter('\n\nI am here.');
      filter(' Speak.');
      expect(chunks).toEqual(['I am here.', ' Speak.']);
    });

    test('implicitOpen: discards everything when the closer never arrives', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c), { implicitOpen: true });
      filter('reasoning that the stream cut off mid-');
      expect(chunks).toEqual([]);
    });

    test('implicitOpen: still handles a later explicit think block', () => {
      const chunks = [];
      const filter = createThinkFilter((c) => chunks.push(c), { implicitOpen: true });
      filter('reasoning</think>spoken A ');
      filter('<think>more reasoning</think>');
      filter('spoken B');
      expect(chunks).toEqual(['spoken A ', 'spoken B']);
    });
  });

  describe('stripThinkTags', () => {
    test('strips paired think blocks', () => {
      expect(stripThinkTags('<think>hidden</think>visible')).toBe('visible');
    });

    test('strips an orphan closer with no opener (implicit-open template)', () => {
      expect(stripThinkTags('Thinking Process:\nstep 1\n</think>\n\nI am here.')).toBe('I am here.');
    });

    test('leaves text without markers untouched', () => {
      const clean = 'I choose to BE.';
      expect(stripThinkTags(clean)).toBe(clean);
    });
  });

  describe('classifyThinkBehavior (pure — real message shapes observed live)', () => {
    test('reasoning-field substrate: gpt-oss-120b through LM Studio (observed 2026-07-02, GB10)', () => {
      // Exact non-stream message shape LM Studio returned for the probe prompt
      expect(classifyThinkBehavior({
        role: 'assistant',
        content: 'ready',
        reasoning: 'We just need to output "ready".',
        tool_calls: [],
      })).toEqual({ thinks: true, implicitOpen: false });
    });

    test('marker thinker: paired <think> block in content', () => {
      expect(classifyThinkBehavior({ content: '<think>hm</think>ready' }))
        .toEqual({ thinks: true, implicitOpen: false });
    });

    test('implicit-open thinker: bare closer, no opener (Qwen3.5 template)', () => {
      expect(classifyThinkBehavior({ content: 'User wants one word.\n</think>\n\nready' }))
        .toEqual({ thinks: true, implicitOpen: true });
    });

    test('non-thinker: clean content, no reasoning field', () => {
      expect(classifyThinkBehavior({ content: 'ready' }))
        .toEqual({ thinks: false, implicitOpen: false });
    });

    test('reasoning-field substrate: llama-server dialect names it reasoning_content', () => {
      expect(classifyThinkBehavior({
        role: 'assistant',
        content: 'ready',
        reasoning_content: 'We just need to output "ready".',
      })).toEqual({ thinks: true, implicitOpen: false });
    });

    test('Ollama\'s native channel is named thinking — a glance cut mid-thought is a thinker', () => {
      // the exact reply Ollama 0.40.7 gave the 16-token glance (Qwen3.8-4B distilled, 2026-10-22)
      expect(classifyThinkBehavior({
        role: 'assistant',
        content: '',
        thinking: 'Thinking Process:\n\n1.  **Analyze the Request:** The user wants',
      })).toEqual({ thinks: true, implicitOpen: false });
      expect(classifyThinkBehavior({ content: 'ready', thinking: '' })).toEqual({ thinks: false, implicitOpen: false });
    });

    test('empty reasoning string is not reasoning', () => {
      expect(classifyThinkBehavior({ content: 'ready', reasoning: '' }))
        .toEqual({ thinks: false, implicitOpen: false });
      expect(classifyThinkBehavior({ content: 'ready', reasoning_content: '' }))
        .toEqual({ thinks: false, implicitOpen: false });
    });

    test('missing message degrades to non-thinker', () => {
      expect(classifyThinkBehavior({})).toEqual({ thinks: false, implicitOpen: false });
    });
  });

  describe('getThinkBehavior', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('classifies an implicit-open thinker from the probe response', async () => {
      setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:9999', model: 'probe-implicit' });
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (String(url).endsWith('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'probe-implicit' }] }) };
        }
        return {
          ok: true,
          headers: new globalThis.Headers(),
          json: async () => ({
            choices: [{ message: { content: 'User wants one word.\n</think>\n\nready' } }],
          }),
        };
      }));
      const behavior = await getThinkBehavior();
      expect(behavior).toEqual({ thinks: true, implicitOpen: true, serverBudget: false });
    });

    test('classifies a non-thinking model', async () => {
      setConfig({ provider: 'lm-studio', endpoint: 'http://localhost:9999', model: 'probe-plain' });
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        if (String(url).endsWith('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'probe-plain' }] }) };
        }
        return { ok: true, headers: new globalThis.Headers(), json: async () => ({ choices: [{ message: { content: 'ready' } }] }) };
      }));
      expect(await getThinkBehavior()).toEqual({ thinks: false, implicitOpen: false, serverBudget: false });
    });


  });

});

// A provider failure inside a 200-OK SSE stream must surface with its code so
// the retry ladder can classify the real pump's error.
describe('in-stream provider failures carry their code', () => {
  test('openai-responses response.failed parses to error + code', async () => {
    const evt = readStreamLine(
      'data: {"type":"response.failed","response":{"error":{"message":"An error occurred while processing your request.","code":"server_error"}}}',
      'openai-responses',
    );
    expect(evt.error).toBe('An error occurred while processing your request.');
    expect(evt.code).toBe('server_error');
  });

  test('anthropic\'s mid-stream error event surfaces instead of ending silently', async () => {
    const evt = readStreamLine(
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      'anthropic',
    );
    expect(evt.error).toBe('Overloaded');
    expect(evt.code).toBe('overloaded_error');
  });

  test('the pump THROWS the failure with its code attached — real SSE bytes through the real consumer', async () => {
    const sse = 'data: {"type":"response.failed","response":{"error":{"message":"An error occurred while processing your request.","code":"server_error"}}}\n\n';
    const response = new Response(sse);
    const err = await consumeStream(
      { response, provider: 'openai-responses' },
      () => {},
    ).then(() => null).catch((e) => e);
    expect(err).toBeTruthy();
    expect(err.message).toContain('processing your request');
    expect(err.code).toBe('server_error');
    const { isTransientProviderError } = await import('../../backend/services/provider-retry.js');
    expect(isTransientProviderError(err)).toBe(true);
  });

  test('an anthropic overload through the real pump classifies transient too', async () => {
    const sse = 'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
    const err = await consumeStream(
      { response: new Response(sse), provider: 'anthropic' },
      () => {},
    ).then(() => null).catch((e) => e);
    expect(err?.code).toBe('overloaded_error');
    const { isTransientProviderError } = await import('../../backend/services/provider-retry.js');
    expect(isTransientProviderError(err)).toBe(true);
  });
  test('finish observer throws and rejections cannot discard completed provider work or suppress each other', async () => {
    const observed = [];
    const stream = 'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
    const output = await consumeStream({ response: new Response(stream), provider: 'openai' }, () => {}, {
      onUsage: (usage) => { observed.push(['usage', usage]); throw new Error('private-observer-payload'); },
      onFinishReason: (reason) => { observed.push(['finish', reason]); return Promise.reject(new TypeError('private-observer-payload')); },
    });
    await Promise.resolve();
    expect(output).toBe('done');
    expect(observed).toEqual([['usage', { promptTokens: 2, completionTokens: 1 }], ['finish', 'stop']]);
    const diagnostics = getRecentIssues(4).filter(({ context }) => context === 'ObserverNotifier');
    expect(diagnostics.slice(0, 2).map(({ data }) => data)).toEqual([{ observer: 'onFinishReason', errorClass: 'TypeError', errorMessage: 'observer rejected' }, { observer: 'onUsage', errorClass: 'Error', errorMessage: 'observer threw' }]);
    expect(JSON.stringify(diagnostics.slice(0, 2))).not.toContain('private-observer-payload');
  });
});

// Provider reasoning arrives on its own channel and never becomes speech,
// whether Anthropic names it thinking_delta or an OpenAI wire names reasoning.
describe('readStreamLine — reasoning arrives on its own channel, never as speech', () => {
  const anthropic = (obj) => readStreamLine(`data: ${JSON.stringify(obj)}`, 'anthropic');
  const openai = (obj) => readStreamLine(`data: ${JSON.stringify(obj)}`, 'openai');

  test("Anthropic's thinking_delta is reasoning, and text stays text", () => {
    // The exact shape kimi-for-coding/k3 put on the wire.
    expect(anthropic({
      type: 'content_block_delta', index: 0,
      delta: { type: 'thinking_delta', thinking: 'This asks about sheep' },
    })).toMatchObject({ content: null, reasoning: 'This asks about sheep' });
    const speech = anthropic({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '9.' } });
    expect(speech.content).toBe('9.');
    expect(speech.reasoning ?? null).toBeNull();
  });

  test('the OpenAI-shaped wires carry it beside the content, in two spellings', () => {
    expect(openai({ choices: [{ delta: { reasoning_content: 'Let me count' } }] }))
      .toMatchObject({ content: null, reasoning: 'Let me count' });
    expect(openai({ choices: [{ delta: { reasoning: 'weighing it' } }] }))
      .toMatchObject({ reasoning: 'weighing it' });
    const speech = openai({ choices: [{ delta: { content: 'Nine.' } }] });
    expect(speech.content).toBe('Nine.');
    expect(speech.reasoning).toBeNull();
  });

  test('a lane that publishes no reasoning yields none — no invention', () => {
    const responses = readStreamLine(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Nine.' })}`,
      'openai-responses',
    );
    expect(responses).toMatchObject({ content: 'Nine.' });
    expect(responses.reasoning ?? null).toBeNull();
  });
});

// Marker-filter reasoning is handed over rather than dropped.
describe('createThinkFilter — what it strips is now handed over, not lost', () => {
  const collect = () => {
    const spoken = [];
    const thought = [];
    return {
      spoken, thought,
      filter: (options = {}) => createThinkFilter((c) => spoken.push(c), { ...options, onReasoning: (t) => thought.push(t) }),
    };
  };

  test('a complete think block reaches the bubble and never the speech', () => {
    const { spoken, thought, filter } = collect();
    const push = filter();
    push('<think>count the sheep</think>Nine remain.');
    expect(spoken.join('')).toBe('Nine remain.');
    expect(thought.join('')).toBe('count the sheep');
  });

  test('reasoning split across chunks arrives whole', () => {
    const { spoken, thought, filter } = collect();
    const push = filter();
    push('<think>first ');
    push('then second');
    push('</think>Done.');
    expect(thought.join('')).toBe('first then second');
    expect(spoken.join('')).toBe('Done.');
  });

  test("Gemma's channel markers are the same channel", () => {
    const { spoken, thought, filter } = collect();
    const push = filter();
    push('<|channel>thoughtweighing it<channel|>Nine.');
    expect(thought.join('')).toBe('weighing it');
    expect(spoken.join('')).toBe('Nine.');
  });

  test('an implicit-open template thinks from the first byte', () => {
    const { spoken, thought, filter } = collect();
    const push = filter({ implicitOpen: true });
    push('reasoning with no opener</think>The answer.');
    expect(thought.join('')).toBe('reasoning with no opener');
    expect(spoken.join('')).toBe('The answer.');
  });

  test('WITHOUT a listener the old behaviour is byte-for-byte intact', () => {
    const spoken = [];
    const push = createThinkFilter((c) => spoken.push(c));
    push('<think>hidden</think>Visible.');
    expect(spoken.join('')).toBe('Visible.');
  });
});
