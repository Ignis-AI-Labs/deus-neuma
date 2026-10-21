// LLM request builders — pure per-dialect headers/URL/body construction.
//
// Split out of llm-provider.js (SIZE-026). Everything here is pure: defined
// inputs → defined output, zero IO. The composer (llm-provider.js) owns the
// fetch; these functions only decide WHAT rides the wire.

import { toAnthropicMessages, toOllamaMessage, toResponsesInput, textContentOf } from './wire-history.js';
import { localSamplingFor, DEFAULT_LOCAL_STOP_TOKENS } from './model-capabilities.js';
import { kvCacheReuseFor } from './kv-cache-policy.js';
import { toAnthropicTools, toResponsesTools } from './tool-schema.js';
import { getProvider } from './provider-registry.js';
import { openAIChatGPTHeaders } from './openai-chatgpt-wire.js';
import { carryForTurn, carriedMessages } from './turn-context-carry.js';

/**
 * What llama.cpp writes into the thought when the server budget closes it —
 * Qwen's own documented budget-close phrase, in the model's first person, so
 * the answer that follows is built on the thinking rather than continuing it.
 */
export const THINKING_BUDGET_MESSAGE = '\n\nConsidering the limited time by the user, I have to give the solution based on the thinking directly now.\n';

// The wire dialect a config speaks. Routes carry the provider ID (catalog
// ids like kimi-for-coding or github-copilot number in the dozens); the
// request builders only ever switch on the DIALECT. Legacy machine-config
// ids ('custom' etc.) resolve through the registry too; unknown → openai.
export const dialectOf = (config) =>
  getProvider(config.provider)?.dialect
  ?? (config.provider === 'anthropic' || config.provider === 'ollama' ? config.provider : 'openai');

export const buildHeaders = (config) => {
  const headers = { 'Content-Type': 'application/json' };
  const dialect = dialectOf(config);
  if (config.apiKey) {
    if (dialect === 'anthropic') {
      headers['x-api-key'] = config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
  }
  if (dialect === 'openai-responses' && config.accountId) {
    Object.assign(headers, openAIChatGPTHeaders(config.apiKey, config.accountId));
    headers.Accept = 'text/event-stream';
  }
  // Static per-provider protocol headers from the catalog entry (Copilot's
  // endpoint rejects requests without its intent/initiator headers).
  const extra = getProvider(config.provider)?.headers;
  if (extra) Object.assign(headers, extra);
  return headers;
};

export const buildChatUrl = (config) => {
  const base = config.endpoint.replace(/\/$/, '');
  switch (dialectOf(config)) {
    case 'ollama': return `${base}/api/chat`;
    case 'openai-responses': return `${base}${config.chatPath || '/v1/responses'}`;
    // Anthropic-dialect bases may already carry a version segment
    // (kimi-for-coding at /coding/v1) — the entry's chatPath knows.
    case 'anthropic': return `${base}${config.chatPath || '/v1/messages'}`;
    // OpenAI-compatible providers mostly live at /v1/chat/completions, but some
    // (z.ai's GLM at /…/v4, providers with an /openai prefix) differ — an
    // explicit per-route chatPath overrides the default without new per-provider code.
    default: return `${base}${config.chatPath || '/v1/chat/completions'}`;
  }
};

/**
 * Publisher-recommended sampling per LOCAL model family. The table itself is
 * data in model-capabilities.js (LOCAL_FAMILY_SAMPLING — the numbers, the
 * repeat_penalty ban, and the incident refs live with it; model-portability
 * doctrine: behavior facts are data, never request-path code). This export
 * keeps its name for the callers and tests that already ride it.
 * @param {string} model
 * @returns {{temperature?: number, top_k?: number, top_p?: number, min_p: number}}
 */
export const localFamilySampling = (model) => localSamplingFor(model);

/**
 * THE CACHE-SPLIT MARKER — the stable/volatile boundary rides ON the system
 * message as a NON-ENUMERABLE property. It cannot travel as an enumerable
 * key: the OpenAI-dialect branch embeds `messages` by reference, so any
 * enumerable key would leak onto every other vendor's wire — non-enumerable
 * keeps JSON.stringify blind to it and every other dialect byte-identical,
 * while the anthropic branch below reads it by name. The split itself comes
 * from stablePromptSplit (core/runtime/prompt-assembler.js) — the one place
 * the stable-first ordering law lives. Pure: the message literal is created
 * here, so nothing already held is mutated.
 * @param {string} content the assembled system prompt
 * @param {{stable: string, volatile: string}|null} [split]
 */
export const systemMessageWithCacheSplit = (content, split = null) => {
  const message = { role: 'system', content };
  if (split?.stable && split?.volatile) {
    Object.defineProperty(message, 'cacheSplit', { value: split, enumerable: false });
  }
  return message;
};

/**
 * Mark the CURRENT TURN as the volatile tail's anchor — the message the local
 * lane folds the clock/memory/lists into (localPrefixStableMessages). Rides
 * the system message as a non-enumerable property, like cacheSplit, so no
 * other dialect's wire changes. Call once, when the wire head is complete;
 * returns the head length (the caller's wireHead). Impure: marks messages[0].
 * @param {Array<Object>} messages system + transcript + current turn
 * @param {{connection: Object, chatId: string, turnId: string, window?: number|null}|null} [carry]
 *   the chat this turn speaks in — enables the carry (say it once)
 * @returns {number} messages.length
 */
export const anchorVolatileAtTurn = (messages, carry = null) => {
  const system = messages[0];
  if (system?.role === 'system' && system.cacheSplit) {
    // The LAST USER turn: a sender's transcript (caller-tools.js) may close on tool results.
    Object.defineProperty(system, 'volatileAnchor', { value: messages.findLastIndex((m) => m?.role === 'user'), enumerable: false });
    // SAY IT ONCE (turn-context-carry.js): the chat's earlier blocks stay on
    // the wire as sent, and this turn's block carries only what changed.
    const descriptor = carry ? carryForTurn(carry) : null;
    if (descriptor) Object.defineProperty(system, 'contextCarry', { value: descriptor, enumerable: false });
  }
  return messages.length;
};

const HARNESS_CONTEXT_NOTE = 'The harness\'s standing context for this turn — the clock, your memory, your working lists. '
  + 'These are not the operator\'s words; the operator\'s message follows this block.';

/**
 * THE LOCAL PREFIX LAW. llama-server reuses a slot's cache only up to the
 * first differing token, and the transcript rides AFTER the system prompt —
 * so the minute-resolution clock at the system prompt's tail sat IN FRONT of
 * the whole conversation, and every new turn re-read all of it: 90–107k
 * tokens, 36–51 s of silence before the first word (live log, 2026-09-25:
 * […], the prefix under the 10% match floor). This model
 * family's template refuses a second system message, so the volatile tail
 * moves INTO the current turn, tagged as the harness's — never the
 * operator's words. The system message keeps only the stable head. Pure;
 * returns the input untouched when no anchor was marked.
 * @param {Array<Object>} messages
 * @returns {Array<Object>}
 */
export const localPrefixStableMessages = (messages) => {
  const system = messages[0];
  const split = system?.cacheSplit;
  const at = system?.volatileAnchor;
  if (system?.role !== 'system' || !split || !Number.isInteger(at) || messages[at]?.role !== 'user') return messages;
  const carried = system.contextCarry ? carriedMessages(messages, split, at, system.contextCarry) : null;
  if (carried) return carried;
  const block = `<harness-context>\n${HARNESS_CONTEXT_NOTE}\n\n${split.volatile}\n</harness-context>`;
  const turn = messages[at];
  const content = Array.isArray(turn.content)
    ? [{ type: 'text', text: block }, ...turn.content]
    : `${block}\n\n${turn.content ?? ''}`;
  return messages.map((message, i) => {
    if (i === 0) return { role: 'system', content: split.stable };
    return i === at ? { ...turn, content } : message;
  });
};

const isLoopbackCustom = (config) => config.provider === 'custom'
  && /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i.test(config.endpoint ?? '');

/**
 * Pure — the openai-compatible wire at a local serving (buildStreamBody's
 * local branch): the one wire that folds the volatile tail into the turn.
 * @param {Object} config resolved provider config
 * @returns {boolean}
 */
export const isLocalOpenAIWire = (config) => !['ollama', 'anthropic', 'openai-responses'].includes(dialectOf(config))
  && (config.provider === 'lm-studio' || config.provider === 'llama-server' || isLoopbackCustom(config));

/**
 * impure (the carry records this turn's block, as round one then reuses it) —
 * the local wire built ahead of the first round, so the gauge's first frame
 * counts what will ride (turn-context-carry.js wireContextSections). The
 * carry's block is fixed per turn, so round one sends these same bytes; on
 * every other wire nothing happens.
 * @param {Object} config the config the turn's rounds will resolve
 * @param {Array<Object>} messages the anchored wire head
 */
export const composeLocalWireAhead = (config, messages) => {
  if (isLocalOpenAIWire(config)) localPrefixStableMessages(messages);
};

/**
 * The request body for one streaming turn, in the wire dialect the config names.
 * @param {Object} config resolved provider config (endpoint, model, sampling)
 * @param {Array<Object>} messages the conversation
 * @param {Object} options per-call overrides — model, sampling/seed, tools,
 *   toolChoice, lora, and `effort` ({channel, value}), applied only in the
 *   dialect that owns that channel. Absent → no effort field rides the request.
 * @returns {Object} the dialect's body
 */
export const buildStreamBody = (config, messages, options) => {
  const temp = options.temperature ?? config.temperature;
  const maxTok = options.maxTokens ?? config.maxTokens;
  const model = options.model ?? config.model;

  switch (dialectOf(config)) {
    case 'ollama':
      return {
        model,
        messages: messages.map(toOllamaMessage),
        stream: true,
        // Ollama's /api/chat takes the SAME tools schema as the OpenAI wire —
        // and this branch simply never sent it. Every other dialect forwards
        // options.tools; Ollama silently dropped them, so a being on Ollama was
        // never OFFERED a tool and could not act at all: no write_file at
        // crystallization, no file the DNA could land in, no acts for a living
        // being either. Proven against Ollama 0.24 on 2026-08-04 — the same
        // request with `tools` present returns message.tool_calls, without it
        // the model can only talk about acting.
        ...(options.tools?.length ? { tools: options.tools } : {}),
        options: { temperature: temp, num_predict: maxTok }
      };

    case 'anthropic': {
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMsgs = toAnthropicMessages(messages.filter(m => m.role !== 'system'));
      // THE CACHE BREAKPOINT: when the turn's assembly marked the
      // stable/volatile boundary (systemMessageWithCacheSplit), the prompt
      // rides as TWO text blocks — the sitting-stable head carrying
      // `cache_control: ephemeral`, the volatile tail (the clock, memory, the
      // knocks) OUTSIDE the breakpoint so a clock tick never invalidates the
      // head. One combined marked block would be theater: the volatile tail
      // inside it would bust the cache every turn. Absent the marker the
      // system prompt rides as the bare string it always was — byte-identical.
      const system = systemMsg?.cacheSplit
        ? [
          { type: 'text', text: systemMsg.cacheSplit.stable, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: systemMsg.cacheSplit.volatile },
        ]
        : systemMsg?.content;
      // Extended thinking (the effort ladder's Anthropic wire): the budget must
      // stay under max_tokens — the caller adds it on top of its speech budget —
      // and the Messages API REFUSES any temperature but 1 while thinking is
      // enabled, so the preset's temperature yields to the operator's chosen
      // rung rather than 400ing the turn.
      const thinking = options.effort?.channel === 'thinking-budget'
        ? { type: 'enabled', budget_tokens: options.effort.value }
        : null;
      // Kimi's lane: rung and switch ride ONE thinking block — the official
      // client's own shape (effort low|high|max; 'disabled' stops reasoning).
      // The preset's temperature stands beside it (probed 2026-09-23: the
      // lane takes temperature with thinking enabled, no refusal).
      const kimiThinking = options.effort?.channel === 'kimi-effort'
        ? (options.effort.value === 'disabled'
          ? { type: 'disabled' }
          : { type: 'enabled', effort: options.effort.value })
        : null;
      return {
        model,
        max_tokens: maxTok,
        messages: chatMsgs,
        ...(system !== undefined ? { system } : {}),
        stream: true,
        temperature: thinking ? 1 : temp,
        ...(thinking ? { thinking } : {}),
        ...(kimiThinking ? { thinking: kimiThinking } : {}),
        // This branch was implemented for text-only turns and never revisited
        // when native function calling landed — a being on this dialect could
        // talk but not act (#259). Anthropic takes its own tool shape and its
        // own tool_choice vocabulary; {type:'auto'} is also the only choice
        // legal while extended thinking is enabled, so it is safe under every
        // effort rung this branch builds.
        ...(options.tools?.length
          ? { tools: toAnthropicTools(options.tools), tool_choice: { type: 'auto', disable_parallel_tool_use: true } }
          : {}),
      };
    }

    case 'openai-responses': {
      const instructions = messages
        .filter((message) => message.role === 'system')
        .map((message) => textContentOf(message.content))
        .filter(Boolean)
        .join('\n\n');
      return {
        model,
        ...(instructions ? { instructions } : {}),
        input: toResponsesInput(messages),
        tools: toResponsesTools(options.tools),
        tool_choice: 'auto',
        // Both seats wait for a completed result before choosing another call.
        parallel_tool_calls: false,
        // The Responses wire carries the effort rung in its reasoning object;
        // null (the default) leaves the model on the provider's own default.
        reasoning: options.effort?.channel === 'responses-effort'
          ? { effort: options.effort.value }
          : null,
        store: false,
        stream: true,
        include: [],
      };
    }

    default: { // openai-compatible: lm-studio, openai, custom
      const body = {
        model,
        messages,
        temperature: temp,
        max_tokens: maxTok,
        top_p: options.topP ?? config.topP,
        stream: true,
        // Token truth (measured rung): ask for the final usage chunk so
        // prompt/completion token counts are measured, not estimated. Part of
        // the OpenAI streaming spec — lm-studio/openai/custom(xai) all accept
        // it. Servers that ignore it simply omit the chunk; absence downgrades
        // visibly at the stream consumer, never silently.
        stream_options: { include_usage: true },
      };
      // Sampling knobs for LOCAL models — each family rides its publisher's
      // recommended values (localFamilySampling has the numbers and the
      // repeat_penalty ban). An explicit caller temperature/topP still wins:
      // family values replace only generic config defaults, never a per-call
      // choice (the T=0 extraction paths depend on that). Cloud APIs reject
      // these fields, so local endpoints only — and LOCAL is decided by the
      // WIRE, not the provider label: kin routes ride provider 'custom' at
      // loopback llama-server, and label-gating let those out with NO
      // cache_prompt:false and NO family sampling (2026-07-10: Signal's
      // bare-base walk corrupted through the cache-rollback class this knob
      // prevents; xAI — also 'custom' — is why the label can't just widen).
      const loopbackCustom = isLoopbackCustom(config);
      if (isLocalOpenAIWire(config)) {
        const family = localFamilySampling(model);
        if (options.temperature === undefined && family.temperature !== undefined) {
          body.temperature = family.temperature;
        }
        if (options.topP === undefined && family.top_p !== undefined) {
          body.top_p = family.top_p;
        }
        if (family.top_k !== undefined) body.top_k = family.top_k;
        body.min_p = family.min_p;
        body.stop = [...DEFAULT_LOCAL_STOP_TOKENS];
        // Whether a slot may reuse this model's prompt cache is a MODEL FACT,
        // so it is a data row in kv-cache-policy.js, not a constant here. A
        // family opens only through a live corruption run — qwen3.8 earned the
        // first open row 2026-09-12 (scripts/verify-kv-cache-reuse.mjs);
        // everything unmeasured still resolves false. Local-only knob: cloud
        // APIs strict-validate and would reject the field.
        body.cache_prompt = kvCacheReuseFor(model).reuse;
        body.messages = localPrefixStableMessages(messages);
      }
      // THE THINKING-OFF LEVER (thought-governor pass 2): the template's own
      // switch, sent only on the wire where it is PROVEN — llama-server /
      // loopback custom, measured 2026-08-28 against this rig's qwen3.8
      // serving: the default request reasons, the switched request answers
      // with no reasoning channel at all. A template without the kwarg
      // ignores it; hosted lanes never see the field.
      if (options.noThink === true
        && (config.provider === 'llama-server' || loopbackCustom)) {
        body.chat_template_kwargs = { enable_thinking: false };
      }
      // THE SERVER BUDGET (thought-governor serverBudget): llama.cpp closes
      // the thought itself, in the same request, without touching the prompt.
      // The message is mandatory — closed bare, the model keeps reasoning in
      // its visible speech (CPU probe 2026-10-04). A caller sends it only where
      // the think-shape probe heard the server name itself llama.cpp
      // (llm-think-probe.js), so it rides every LOCAL wire that measured so —
      // an lm-studio route fronting a llama.cpp server too (the house flight,
      // 2026-10-17: the Optio's review thought freely there). LM Studio itself
      // has no proven off switch; its requests carry neither field.
      if (Number.isInteger(options.thinkingBudget)
        && (config.provider === 'lm-studio' || config.provider === 'llama-server' || loopbackCustom)) {
        body.thinking_budget_tokens = options.thinkingBudget;
        body.reasoning_budget_message = THINKING_BUDGET_MESSAGE;
      }
      // The effort rung on the OpenAI chat wire (gpt-5 / o-series, and xAI's
      // mini reasoners). Those models REFUSE the sampling knobs beside it —
      // temperature and top_p go out with the same request or the API 400s —
      // so the operator's chosen rung supersedes the sampling preset here.
      // No effort chosen → the body is untouched and the preset stands.
      if (options.effort?.channel === 'reasoning-effort') {
        body.reasoning_effort = options.effort.value;
        delete body.temperature;
        delete body.top_p;
      }
      // Native function-calling schema (OpenAI shape). Sent only when the caller
      // passes an explicit tools array — the text-based tool protocol stays the
      // default for models/providers that lack native tool calling. tool_choice
      // defaults to 'auto' so the model may still speak without a call.
      if (Array.isArray(options.tools) && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
        // Serial by default; parallel only when the sender of caller tools
        // asked for it (BFCL parallel, 2026-10-09: false here held every
        // agent arm to one call per reply — 0/400 where BARE scored 88%).
        body.parallel_tool_calls = options.parallelToolCalls === true;
      }
      // A close held from calling (close-prefix.js) — the opener's token banned; the prompt untouched.
      if (Array.isArray(options.logitBias) && options.logitBias.length > 0) body.logit_bias = options.logitBias;
      // Per-request LoRA adapter selection (llama-server dialect): a being's
      // refined adapter rides its own requests over a shared base. Sent only
      // when the caller passes an explicit binding — resolveAdapterBinding
      // decides WHETHER, this layer only carries it.
      if (Array.isArray(options.lora) && options.lora.length > 0) {
        body.lora = options.lora;
      }
      if (Number.isInteger(options.seed)) body.seed = options.seed;
      return body;
    }
  }
};
