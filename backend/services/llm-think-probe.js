// Network boundary for reasoning-shape discovery; filtering stays independent of IO.
import { buildHeaders, buildChatUrl, buildStreamBody } from './llm-request-builders.js';
import { classifyThinkBehavior } from './llm-think-filter.js';

/**
 * The first look's budget. A reasoning channel shows in the first token, so a
 * thinker is known in a handful of tokens instead of a whole reply: at 1024 a
 * CPU-served thinker (Qwen3-4B, -ngl 0, 2026-10-04) outran the 10s bound,
 * read as non-thinking — the thought governor never armed — and re-probed
 * every turn.
 */
export const THINK_PROBE_GLANCE_TOKENS = 16;
const THINK_PROBE_FULL_TOKENS = 1024;

/**
 * Pure — did a glance leave the shape undecided? Only a reply cut at the
 * budget with plain words and no think tag can still be an implicit-open
 * thinker whose closing tag lies further on.
 * @param {Object} message
 * @param {string|null} finishReason
 */
const glanceUndecided = (message, finishReason) => finishReason === 'length'
  && !classifyThinkBehavior(message).thinks
  && !String(message?.content ?? '').includes('<think>');

// impure — one bounded non-streaming completion.
const askReady = async (config, modelId, maxTokens) => {
  // stream_options is stream-only — OpenAI-compat servers reject it on a
  // non-streaming request, so it must not ride into the probe body
  const { stream_options: _streamOptions, ...streamBody } = buildStreamBody(
    config,
    [{ role: 'user', content: 'Reply with only the word: ready' }],
    // resolved id, never the 'local-model' placeholder — a multi-model server
    // rejects the placeholder and the probe would silently report no-think
    { temperature: 0, maxTokens, model: modelId },
  );
  const response = await fetch(buildChatUrl(config), {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({ ...streamBody, stream: false }),
    // Bounded (harness-friction-map B2): the probe is a REAL completion sent
    // inline before the turn's first token — an accepting-but-wedged server
    // must not hang the turn unbounded.
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Think-behavior probe failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return {
    message: data.choices?.[0]?.message ?? data.message ?? {},
    finishReason: data.choices?.[0]?.finish_reason ?? data.done_reason ?? null,
    // llama.cpp names itself on every reply — the server that honors a
    // per-request thinking budget (thought-governor's serverBudget).
    serverBudget: /llama\.cpp/i.test(response.headers.get('server') || ''),
  };
};

// impure — classifies the model's reasoning shape: a glance, then the full
// reply only when the glance cannot tell.
export const probeThinkBehavior = async (config, modelId) => {
  const glance = await askReady(config, modelId, THINK_PROBE_GLANCE_TOKENS);
  const seen = glanceUndecided(glance.message, glance.finishReason)
    ? await askReady(config, modelId, THINK_PROBE_FULL_TOKENS)
    : glance;
  return { ...classifyThinkBehavior(seen.message), serverBudget: seen.serverBudget };
};
