/**
 * THE CANDIDATE SCORER (HARNESS-POE phase 1, #533) — K scored generations in
 * one call: the likelihood primitive the explore→score→select seat loop ranks
 * candidates with (the ARC PoE mechanism, arXiv 2505.07859: candidates ranked
 * by total log-likelihood, selection by measured evidence).
 *
 * THE SUBSTRATE LAW THAT SHAPES THIS (read from the pinned build's source,
 * llama.cpp server-common.cpp:1143 / server-task.cpp:405): `logprobs` is
 * REFUSED on requests that carry tools AND stream, and logprobs are only ever
 * assembled when the response is NOT a stream. The seat's ordinary path is
 * tools + stream — so likelihoods cannot ride the agent loop; they arrive
 * through THIS door: non-streaming, tool-free requests, one per candidate.
 * Declared-only consumers wire onto it later; nothing in the ordinary loop
 * changes until then.
 *
 * The request NEVER carries a tools key — that is the substrate's refusal
 * condition, not a preference. Selection quality note: a bare title-matched
 * sum over sampled-token logprobs is the paper's ranking signal; raising
 * `topLogprobs` only widens the reported alternatives, not the sum.
 */
import { createLogger } from './logger.js';

const log = createLogger('CandidateScorer');

export const CANDIDATE_SCORER_DEFAULTS = Object.freeze({
  topLogprobs: 1,
  timeoutMs: 120_000,
  temperature: 0,
});

const CHAT_PATH = '/chat/completions';

/** Resolve the chat-completions URL from a route endpoint (base or /v1). Pure. */
export const chatCompletionsUrl = (endpoint) => {
  if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) {
    throw new Error('candidate scorer needs an http(s) route endpoint');
  }
  const base = endpoint.replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : (base.endsWith('/v1') ? `${base}${CHAT_PATH}` : `${base}/v1${CHAT_PATH}`);
};

/** Sum one choice's per-token logprobs (natural log; null when none rode). Pure. */
export const totalLogprobOf = (choice) => {
  const content = choice?.logprobs?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  return content.reduce(
    (sum, tok) => sum + (typeof tok?.logprob === 'number' ? tok.logprob : Number.NEGATIVE_INFINITY),
    0,
  );
};

const validate = ({ url, messages, count }) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('candidate scorer needs the route\'s chat-completions URL');
  }
  if (!Array.isArray(messages) || messages.length === 0
    || !messages.every((m) => m && typeof m.role === 'string' && typeof m.content === 'string')) {
    throw new Error('candidate scorer needs messages: [{role, content}]');
  }
  if (!Number.isInteger(count) || count < 1 || count > 16) {
    throw new Error('candidate count must be an integer 1-16');
  }
};

/**
 * K non-streaming, tool-free generations with per-token logprobs, seeds
 * `seed..seed+count-1`. impure — one HTTP call per candidate.
 * @returns {Promise<Array<{index: number, text: string, finishReason: string,
 *   totalLogprob: number|null, tokens: number}>>} frozen, index-ordered
 */
export const scoreCandidates = async ({
  url, model, apiKey = null, messages, count,
  seed = 0, temperature = CANDIDATE_SCORER_DEFAULTS.temperature,
  maxTokens, topLogprobs = CANDIDATE_SCORER_DEFAULTS.topLogprobs,
  timeoutMs = CANDIDATE_SCORER_DEFAULTS.timeoutMs, signal = null,
}) => {
  validate({ url: chatCompletionsUrl(url), messages, count });
  const fetches = Array.from({ length: count }, (_, i) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
    return fetch(chatCompletionsUrl(url), {
      method: 'POST',
      signal: stop,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        // THE SUBSTRATE LAW: no tools key, no stream — the only shape under
        // which the pinned build returns logprobs at all.
        stream: false,
        logprobs: true,
        top_logprobs: topLogprobs,
        seed: seed + i,
        temperature,
        ...(maxTokens !== undefined && maxTokens !== null ? { max_tokens: maxTokens } : {}),
      }),
    }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`candidate ${i} refused (${response.status}): ${JSON.stringify(body?.error ?? body)?.slice(0, 300)}`);
      }
      const choice = body?.choices?.[0];
      if (!choice || choice.logprobs?.content === undefined || choice.logprobs?.content === null) {
        throw new Error('the substrate returned no logprobs — they only ride non-streaming, tool-free requests (llama.cpp law), and this response carried none');
      }
      const content = choice.logprobs.content;
      return {
        index: i,
        text: choice.message?.content ?? '',
        finishReason: choice.finish_reason ?? null,
        totalLogprob: totalLogprobOf(choice),
        tokens: Array.isArray(content) ? content.length : 0,
        promptTokens: body.usage?.prompt_tokens ?? null,
        completionTokens: body.usage?.completion_tokens ?? null,
      };
    }).catch((error) => {
      log.warn('candidate generation failed', { index: i, err: error.message });
      throw new Error(`candidate ${i} failed: ${error.message}`);
    });
  });
  return Object.freeze(await Promise.all(fetches));
};
