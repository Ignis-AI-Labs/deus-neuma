const finiteNonNegative = (value) => (
  Number.isFinite(value) && value >= 0 ? value : null
);

const firstFinite = (...values) => {
  for (const value of values) {
    const normalized = finiteNonNegative(value);
    if (normalized !== null) return normalized;
  }
  return null;
};

const freezeUsage = ({
  promptTokens = null,
  completionTokens = null,
  cachedPromptTokens = null,
  providerPrefillDurationMilliseconds = null,
}) => {
  const normalized = {
    promptTokens: finiteNonNegative(promptTokens),
    completionTokens: finiteNonNegative(completionTokens),
    cachedPromptTokens: finiteNonNegative(cachedPromptTokens),
    providerPrefillDurationMilliseconds: finiteNonNegative(providerPrefillDurationMilliseconds),
  };
  return Object.values(normalized).some((value) => value !== null)
    ? Object.freeze(normalized)
    : null;
};

/** Normalize an OpenAI-compatible final usage payload. Pure. */
export const readOpenAIStreamUsage = (payload) => freezeUsage({
  promptTokens: payload?.usage?.prompt_tokens,
  completionTokens: payload?.usage?.completion_tokens,
  cachedPromptTokens: firstFinite(
    payload?.usage?.prompt_tokens_details?.cached_tokens,
    payload?.usage?.input_tokens_details?.cached_tokens,
  ),
  providerPrefillDurationMilliseconds: firstFinite(
    payload?.usage?.prefill_duration_ms,
    payload?.timings?.prompt_ms,
  ),
});

/** Normalize an OpenAI Responses final usage payload. Pure. */
export const readResponsesStreamUsage = (response) => freezeUsage({
  promptTokens: response?.usage?.input_tokens,
  completionTokens: response?.usage?.output_tokens,
  cachedPromptTokens: response?.usage?.input_tokens_details?.cached_tokens,
  providerPrefillDurationMilliseconds: response?.usage?.prefill_duration_ms,
});

/** Normalize one partial usage event without inventing absent values. Pure. */
export const readPartialStreamUsage = (values) => freezeUsage(values || {});

/** Normalize Ollama's final counters; duration is nanoseconds on its wire. Pure. */
export const readOllamaStreamUsage = (payload) => freezeUsage({
  promptTokens: payload?.prompt_eval_count,
  completionTokens: payload?.eval_count,
  providerPrefillDurationMilliseconds: Number.isFinite(payload?.prompt_eval_duration)
    ? payload.prompt_eval_duration / 1_000_000
    : null,
});

/** Fold partial provider usage events, newest observed value per field. Pure. */
export const mergeStreamUsage = (prior, next) => {
  if (!prior) return next || null;
  if (!next) return prior;
  return freezeUsage({
    promptTokens: next.promptTokens ?? prior.promptTokens,
    completionTokens: next.completionTokens ?? prior.completionTokens,
    cachedPromptTokens: next.cachedPromptTokens ?? prior.cachedPromptTokens,
    providerPrefillDurationMilliseconds:
      next.providerPrefillDurationMilliseconds ?? prior.providerPrefillDurationMilliseconds,
  });
};

/** Keep the longstanding onUsage contract token-only. Pure. */
export const tokenUsageOnly = (usage) => (
  Number.isFinite(usage?.promptTokens) && Number.isFinite(usage?.completionTokens)
    ? Object.freeze({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })
    : null
);

/** True at the first provider-emitted speech, reasoning, or tool delta. Pure. */
export const hasProviderOutput = (event) => Boolean(
  (typeof event?.content === 'string' && event.content.length > 0)
  || (typeof event?.reasoning === 'string' && event.reasoning.length > 0)
  || (Array.isArray(event?.toolCalls) && event.toolCalls.length > 0)
);

/** Build the optional C0 telemetry view; missing provider data stays null. Pure. */
export const buildProviderStreamTelemetry = ({ usage, requestStartedAt, firstOutputAt }) => {
  const providerTtftMilliseconds = Number.isFinite(requestStartedAt)
    && Number.isFinite(firstOutputAt)
    && firstOutputAt >= requestStartedAt
    ? firstOutputAt - requestStartedAt
    : null;
  const cachedPromptTokens = finiteNonNegative(usage?.cachedPromptTokens);
  const providerPrefillDurationMilliseconds = finiteNonNegative(
    usage?.providerPrefillDurationMilliseconds,
  );
  return Object.freeze({
    providerTtftMilliseconds,
    cachedPromptTokens,
    providerPrefillDurationMilliseconds,
    providerCacheTelemetryPresent: cachedPromptTokens !== null
      || providerPrefillDurationMilliseconds !== null,
  });
};
