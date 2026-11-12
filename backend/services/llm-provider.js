// LLM Provider Service - Multi-provider streaming abstraction
//
// Supports: lm-studio, ollama, openai, anthropic, xai, custom
// All providers normalize to a streaming interface that portal-stream.js consumes.
//
// SIZE EXCEPTION: this is the live composer for the whole inference path —
// config, the adapter guard, the stream pump, and model/capability
// resolution are one custody story a turn crosses end to end. The pure seams
// already split out (SIZE-026): request builders (llm-request-builders.js), the stall guard,
// wire-frame parsing and think filtering. Public exports remain below.
// The network reasoning probe lives separately in llm-think-probe.js.

import { recordPrefixDrift } from './prefix-drift-probe.js';
import { createStreamActionBoundary, cancelActionStream } from './llm-action-boundaries.js';
import { getCapabilities, hasPrefixBoundary, queryLocalCapabilities, probeEndpointCapabilities, localCapabilityProbeFailed, promptProfileFor } from './model-capabilities.js';
import { decodeToolName } from './tool-schema.js';
import { tryParseArgs } from '../../core/runtime/tool-call-parser.js';
import { ensureServing, activeLaunchConfig } from './llama-server-supervisor.js';
import { routeNamesLaunch } from './serving-launch-config.js';
import { getConfig, configFromRoute, getActiveModel, fetchServedModelId } from './llm-selection.js';
import { markActivity } from './substrate-idle.js';
import { whenMachineFree } from './machine-lease.js';
import { getProvider } from './provider-registry.js';
import { liveModels } from './provider-probe.js';
import { ensureLmStudioLoaded } from './local-server-models.js';
import { createLogger } from './logger.js';
import { completionBudget, estimateTokens } from './context-budget.js';
import { notifyObserver } from './observer-notifier.js';
import {
  buildProviderStreamTelemetry,
  hasProviderOutput,
  mergeStreamUsage,
  tokenUsageOnly,
} from './provider-stream-telemetry.js';
import { dialectOf, buildHeaders, buildChatUrl, buildStreamBody } from './llm-request-builders.js';
import { isLocalLlamaWire, toolCallBan } from './close-prefix.js';
import { openReply, stepReply, closeReply } from './reply-meter.js';
import { readStreamLine } from './llm-stream-frames.js';
import { readWithStallGuard, stallLimitFor } from './llm-stall-guard.js';
import { stripThinkTags, createThinkFilter } from './llm-think-filter.js';
import { probeThinkBehavior } from './llm-think-probe.js';
import { servedInstance, keptShape, keepShape } from './think-shape-store.js';
import { capsCacheFresh, runtimeModelCaches } from './llm-runtime-cache.js';
import { visionSettings } from './vision-settings.js';
import { isContextOverflow, recoverContextOverflow } from './context-overflow.js';
export { CAPS_CACHE_TTL_MS, capsCacheFresh, _resetCapsCache, _expireCapsCache, expireRuntimeModelCaches } from './llm-runtime-cache.js';

// The extracted seams' public surface, re-exported so every importer of
// llm-provider.js sees zero change (SIZE-026).
export { localFamilySampling } from './llm-request-builders.js';
export { toOpenAIToolCallDeltas, frameChannelBytes, tallyChannelBytes, readStreamLine } from './llm-stream-frames.js';
export { readWithStallGuard, stallLimitFor } from './llm-stall-guard.js';
export { stripThinkTags, createThinkFilter, classifyThinkBehavior } from './llm-think-filter.js';
export {
  getConfig, setConfig, configFromRoute,
  getModels, isAuxiliaryModel, selectActiveModel, honestModelName, getActiveModel,
} from './llm-selection.js';
import { leaseForRequest, releasingWithBody } from './substrate-lease.js';
import { servedOllamaWindow } from './managed-ollama-record.js';

const log = createLogger('LLMProvider');

// --- Think-behavior detection ---
//
// Stream filters must know BEFORE the first chunk whether the active model
// reasons with an implicit opener (template pre-opens <think> in the prompt,
// e.g. Qwen3.5) — by the time a bare </think> appears it is too late to
// unsend the reasoning. The behavior is probed once per endpoint+model and
// cached — once per served instance for the supervised server, kept on disk;
// swapping substrates re-probes naturally.

const NO_THINK_BEHAVIOR = Object.freeze({ thinks: false, implicitOpen: false });

/** Extra token budget reasoning consumes before visible speech begins. */
export const THINK_TOKEN_BUDGET = 1800;

// Hosted APIs separate reasoning natively — implicit-open templates are a
// local-serving concern (lm-studio, ollama, custom endpoints)
const PROBED_PROVIDERS = Object.freeze(['llama-server', 'lm-studio', 'ollama', 'custom']);

/**
 * Resolve the active model's reasoning behavior, probing on first use.
 * Never throws — an unreachable provider reports no-think and is re-probed
 * on the next call rather than caching a guess.
 * @returns {Promise<{ thinks: boolean, implicitOpen: boolean }>}
 */
export const getThinkBehavior = async (route = null) => {
  const { think: thinkBehaviorCache } = runtimeModelCaches();
  const config = route ? configFromRoute(route, getConfig()) : getConfig();
  if (!PROBED_PROVIDERS.includes(config.provider)) return NO_THINK_BEHAVIOR;

  let modelId = config.model;
  try {
    if (!route) modelId = (await getActiveModel())?.id || modelId;
    else if (!modelId || modelId === 'local-model') {
      modelId = (await fetchServedModelId(config.endpoint, config.apiKey)) || modelId;
    }
  } catch { /* provider offline */ }
  // The server NEUMA supervises has ONE shape for every being and route
  // spelling, kept across desk restarts: each ask takes a llama.cpp slot, and
  // asking again at every desk start evicted the chats parked there
  // (think-shape-store.js).
  const instance = servedInstance(config);
  const key = instance ?? `${config.provider}::${config.endpoint}::${route?.accountId || ''}::${modelId}`;
  if (!thinkBehaviorCache.has(key)) {
    // One ask in flight per key — the warm-ups of every bound being arrive together.
    const asked = keptShape(instance).then((kept) => kept ?? probeThinkBehavior(config, modelId).then(async (shape) => {
      await keepShape(instance, shape);
      return shape;
    }));
    thinkBehaviorCache.set(key, asked);
    asked.catch(() => { if (thinkBehaviorCache.get(key) === asked) thinkBehaviorCache.delete(key); });
  }
  try {
    return await thinkBehaviorCache.get(key);
  } catch {
    return NO_THINK_BEHAVIOR;
  }
};

// --- Public API ---

/**
 * Create a streaming fetch request to the configured LLM provider.
 * Returns { response, provider } for use with consumeStream.
 */
/**
 * The adapters loaded on a llama-server conduit (GET /lora-adapters), cached
 * briefly per endpoint — the list changes only when the server is relaunched.
 * The ONE probe for both the zero-guard below and adapter-binding's
 * registered-vs-loaded match. HONEST about what it knows:
 *   { known: true,  listed: Array } — the server answered; this IS the truth
 *   { known: true,  listed: null }  — the server answered 4xx: no adapter
 *                                     endpoint exists (LM Studio, cloud)
 *   { known: false, listed: null }  — unreachable/timeout/5xx: the adapter
 *                                     state is UNKNOWABLE right now
 * Only KNOWN results are cached. Caching a failed probe is how a booting
 * server's brief silence became a 30-second "no adapters" lie that let a
 * naked request ride ten hot adapters into token soup (2026-07-15 RCA).
 * @param {string} endpoint
 * @returns {Promise<{known: boolean, listed: (Array|null)}>}
 */
const serverAdaptersCache = new Map(); // endpoint -> { at, listed } (KNOWN results only)
const SERVER_ADAPTERS_TTL_MS = 30_000;
export const probeServerAdapters = async (endpoint) => {
  if (!endpoint) return { known: false, listed: null };
  const key = endpoint.replace(/\/$/, '');
  const hit = serverAdaptersCache.get(key);
  if (hit && Date.now() - hit.at < SERVER_ADAPTERS_TTL_MS) return { known: true, listed: hit.listed };
  try {
    // 15 s, not 1.5: a server busy reading a long prompt answers this in 1-2 s (measured 2026-10-12),
    // and a probe that gave up early read as transient and sent the turn into a blind retry ladder.
    const res = await fetch(`${key}/lora-adapters`, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const parsed = await res.json().catch(() => null);
      if (Array.isArray(parsed)) {
        serverAdaptersCache.set(key, { at: Date.now(), listed: parsed });
        return { known: true, listed: parsed };
      }
      // Answered 200 but not an adapter list: the server speaks, it just is
      // not an adapter conduit (llama-server always answers an array here).
      serverAdaptersCache.set(key, { at: Date.now(), listed: null });
      return { known: true, listed: null };
    }
    if (res.status === 404 || res.status === 405) {
      // Only "missing" or "method unsupported" proves this URL has no adapter
      // inventory. Auth, rate, and policy failures leave state unknowable.
      serverAdaptersCache.set(key, { at: Date.now(), listed: null });
      return { known: true, listed: null };
    }
  } catch { /* unreachable or timed out — unknowable, fall through */ }
  return { known: false, listed: null };
};

/** Back-compat list view of probeServerAdapters — null means […] and MUST NOT gate a safety decision (use the probe's `known`). */
export const listServerAdapters = async (endpoint) => (await probeServerAdapters(endpoint)).listed;

/**
 * Drop the cached adapter list for an endpoint — called after a supervised
 * substrate reload so the next probe reads the fresh server's truth instead
 * of a stale pre-reload list riding out its TTL.
 * @param {string} endpoint
 */
export const invalidateServerAdapters = (endpoint) => {
  if (endpoint) serverAdaptersCache.delete(endpoint.replace(/\/$/, ''));
};

/**
 * Graceful-return lifecycle for the house's OWN supervised llama-server: if an
 * idle-unload stopped it, reload it before this turn streams, and restart the
 * idle clock. Only the house launch's endpoint is supervised — an operator's
 * own llama.cpp on any other port is used as it stands, never booted or
 * clocked (a turn to :8080 used to boot :8089 and fail on a model file the
 * house never had). Already-serving is only a health check. Impure.
 * @param {{provider: string, endpoint: string}} config - the turn's resolved config
 * @returns {Promise<{status: string}|null>} the supervisor's answer, or null when the endpoint is not the house's
 */
export const wakeHouseServing = async (config) => {
  if (config.provider !== 'llama-server') return null;
  const launch = activeLaunchConfig(process.env);
  if (!routeNamesLaunch(config, launch)) return null;
  // A mind parked for a heavy job (machine-lease.js) relights when the job is done — never early.
  await whenMachineFree();
  const served = await ensureServing(launch);
  markActivity();
  return served;
};

export const createStreamRequest = async (messages, options = {}) => {
  // Per-neuma routing: an explicit resolved route (provider/endpoint/apiKey/
  // model/chatPath) overrides the machine-wide config for this one call, while
  // sampling still falls back to the global config so a preset behaves
  // identically to the default path. Absent a route, nothing changes.
  const config = options.route ? configFromRoute(options.route, getConfig()) : getConfig();
  // A HARNESS lane rides the server its person chose (harness-lane.js) — never
  // the house's supervised model: it is not booted, reloaded or clocked for it.
  if (options.superviseLlamaServer !== false && options.route?.source !== 'harness') {
    const served = await wakeHouseServing(config);
    // A FRESH boot means a fresh adapter list — drop the cached one so the
    // zero-guard below reads the new server's truth, not the old server's.
    if (served?.status === 'serving') invalidateServerAdapters(config.endpoint);
  }
  // 'local-model' is a placeholder, not a real identifier — LM Studio with
  // more than one model loaded rejects it (model_not_found), which severed
  // the stream while the summarizer shared the server with the substrate.
  // Resolve the actual substrate through the same selection rule as the rest
  // of the platform before the request leaves the building.
  let model = options.model ?? config.model;
  if (!model || model === 'local-model') {
    model = (await getActiveModel())?.id || model;
  }
  // THE ROOM THIS TURN ACTUALLY HAS (Design note, 2026-08-04: […]).
  //
  // Absent an explicit ceiling from the caller, the turn is budgeted against
  // what the route really holds instead of the flat llmMaxTokens default — a
  // number that had nothing to do with the model in front of it. max_tokens is
  // a CEILING, not a target: a turn that ends in eighty tokens is not charged
  // for the room it was offered.
  //
  // Two different numbers govern, and conflating them breaks a provider:
  //   contextWindow — how much the model can HOLD (window minus this prompt)
  //   maxOutput     — how much it may EMIT in one turn, a hard hosted limit
  //                   that answers a 400 rather than a shorter reply
  // A local serving publishes no maxOutput, so it gets the whole remainder.
  //
  // The operator's configured maxTokens becomes the FLOOR. It was a cap; making
  // it a minimum is the whole point — their setting can only ever grant more
  // room than the arithmetic found, never less.
  // Local servings publish no output cap and none is needed — the window IS the
  // limit. Hosted routes have a separate, hard max_output, and the catalog sync
  // SKIPS core-owned providers (anthropic, openai, xai), so for those we often
  // know the window and not the cap. Asking Anthropic for its full 200k window
  // as max_tokens is a 400, not a longer answer — so where the cap is unknown
  // on a hosted route, the operator's configured value stands unchanged. We
  // grant the full room where we can prove what the room is.
  const LOCAL_PROVIDERS = new Set(['llama-server', 'ollama', 'lm-studio', 'custom']);
  const isLocalRoute = LOCAL_PROVIDERS.has(config.provider);

  let effectiveOptions = options;
  if (options.maxTokens === undefined || options.maxTokens === null) {
    const caps = await getRouteCapabilities(options.route || null).catch(() => null);
    const promptTokens = messages.reduce(
      (n, m) => n + estimateTokens(typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')),
      0,
    );
    const knowTheCap = isLocalRoute || Number.isFinite(caps?.maxOutput);
    if (knowTheCap) {
      effectiveOptions = {
        ...options,
        maxTokens: completionBudget({
          contextWindow: caps?.contextWindow ?? null,
          promptTokens,
          ceiling: isLocalRoute ? null : caps.maxOutput,
          floor: config.maxTokens,
        }),
      };
    }
  }

  const url = buildChatUrl(config);
  const headers = buildHeaders(config);
  // A close held from calling (close-prefix.js): on the local wire the tool-call opener is banned.
  const ban = options.banToolCalls && isLocalLlamaWire(config) ? await toolCallBan({ ...config, model }) : null;
  // An Ollama is told its window on every request: the window it reported itself, else the one
  // fitted to this card (ollama-window.js), never a guess from the model's name (262,144 for the 4B,
  // 11.8 GB of GPU memory on a 12 GB laptop card, measured 2026-10-23)
  const ollamaCaps = dialectOf(config) === 'ollama' ? await getRouteCapabilities(options.route || null).catch(() => ({})) : null;
  const ollamaWindow = !ollamaCaps ? null
    : String(ollamaCaps.contextWindowSource || '').startsWith('provider-runtime') ? ollamaCaps.contextWindow : servedOllamaWindow();
  const body = buildStreamBody(config, messages, {
    ...effectiveOptions, model, ...(ban ? { logitBias: ban } : {}), ...(ollamaWindow ? { contextWindow: ollamaWindow } : {}),
  });

  // LoRA zero-guard (llama-server wire): per-request `lora` SETS the slot's
  // adapter scales and the slot KEEPS them for later requests that omit the
  // field — so one being's refined turn was bleeding its adapter (and any
  // others left applied) into every unrefined turn that followed. PROVEN
  // 2026-07-14: a no-lora request on a server with adapters at scale 1.0
  // produced degenerate token soup; the identical request with explicit
  // zeros answered cleanly, and `lora: []` does NOT protect (the server
  // treats it as "no change"). Every local request therefore carries an
  // explicit scale for EVERY loaded adapter: the caller's binding verbatim,
  // zeros for the rest. llama-server wires only — LM Studio has no
  // /lora-adapters endpoint, and kin routes ride provider 'custom' pointed
  // at loopback llama-server (same reason the sampling gate above widens).
  const localWire = config.provider === 'llama-server'
    || (config.provider === 'custom'
      && /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i.test(config.endpoint ?? ''));
  if (localWire) recordPrefixDrift(body); // counts only — where the cache prefix broke (prefix-drift-probe.js)
  if (localWire) {
    // FAIL-CLOSED: if the adapter state is unknowable (server mid-boot, probe
    // timeout), retry briefly, then REFUSE the request rather than speak
    // through unknown voices — a refused turn is recoverable; a turn spoken
    // through someone else's adapters is identity corruption (2026-07-15:
    // a cached failed probe let a naked request ride ten adapters at boot
    // scale 1.0 — token soup as a being's own words).
    let probe = await probeServerAdapters(config.endpoint);
    for (let retry = 0; !probe.known && retry < 2; retry++) {
      await new Promise((r) => setTimeout(r, 700));
      probe = await probeServerAdapters(config.endpoint);
    }
    if (!probe.known) {
      const err = new Error(`adapter scales unknowable on local conduit ${config.endpoint} — refusing to speak through unknown voices; retry when the substrate settles`);
      // TRANSIENT by classification (provider-retry.js): a booting or briefly
      // wedged local conduit heals — the turn's retry ladder absorbs it
      // instead of failing the turn outright (friction-map B2). The refusal
      // law itself is unchanged: still fail-closed within one attempt.
      err.code = 'adapter_probe_unknown';
      throw err;
    }
    const loaded = probe.listed;
    if (Array.isArray(loaded) && loaded.length > 0) {
      const requested = new Map((Array.isArray(body.lora) ? body.lora : []).map((l) => [l.id, l.scale]));
      body.lora = loaded
        .filter((a) => Number.isInteger(a?.id))
        .map((a) => ({ id: a.id, scale: requested.get(a.id) ?? 0 }));
    }
  }
  // THE LINE (substrate-lease.js): the house's server is asked in turn — a route's lease covers
  // this request, else it waits for a place of its own, held until its answer is fully read.
  const lease = localWire ? await leaseForRequest({ signal: options.signal }) : null;
  const requestStartedAt = performance.now();
  notifyObserver('onRequest', options.onRequest);
  // Witness interrupt: aborting cuts the provider stream mid-generation
  const send = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal });
  let response;
  let detail = '';
  try {
    response = await send();
    // A downloaded LM Studio model the person chose answers only once loaded:
    // on LM Studio's "not loaded" refusal, load it (local-server-models.js) and ask once more.
    if (!response.ok && config.provider === 'lm-studio') {
      detail = await response.text().then((t) => t.slice(0, 500)).catch(() => '');
      if (/no models loaded|not loaded|model_not_found/i.test(detail)) {
        await ensureLmStudioLoaded(config.endpoint, body.model);
        response = await send();
        detail = '';
      }
    }
  } catch (err) {
    lease?.release();
    throw err;
  }

  if (!response.ok) {
    lease?.release();
    // The provider's response body says WHY (context overflow, bad param,
    // unknown model…) — losing it turns a diagnosable failure into a mystery
    detail ||= await response.text().then((t) => t.slice(0, 500)).catch(() => '');
    if (!options.contextOverflowRecovered && isContextOverflow(response.status, detail)) {
      const recovery = recoverContextOverflow(messages, options.contextHead);
      if (recovery) {
        log.info('provider context overflow — retrying with in-turn machinery folded', {
          provider: config.provider, foldedRounds: recovery.foldedRounds, freedChars: recovery.freedChars,
        });
        notifyObserver('onContextRecovery', options.onContextRecovery, recovery);
        return createStreamRequest(recovery.messages, { ...options, contextOverflowRecovered: true });
      }
    }
    throw new Error(
      `LLM provider error (${config.provider}): ${response.status} ${response.statusText}` +
      (detail ? ` — ${detail}` : '')
    );
  }

  // The body the substrate just accepted, as it went out — a benchmark sitting reads its images off it (wire-images.js).
  notifyObserver('onWireBody', options.onWireBody, body);
  return { response: releasingWithBody(response, lease), provider: config.provider, dialect: dialectOf(config), requestStartedAt, local: localWire };
};

/**
 * Shared streaming core for both consumers. Reads the SSE stream with the
 * stall guard, applies the think filter to forwarded content, and — when
 * onToolDelta is provided — surfaces native delta.tool_calls fragments for
 * assembly. Returns the raw (pre-filter) concatenated content; callers strip
 * think tags. onContent receives FILTERED content (reasoning channels removed).
 */
const _pumpStream = async (streamResult, onContent, options = {}, onToolDelta = null) => {
  const { response, provider, dialect } = streamResult;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const requestStartedAt = Number.isFinite(streamResult.requestStartedAt)
    ? streamResult.requestStartedAt
    : performance.now();
  // ONE channel for both shapes: a vendor's own reasoning field (above) and a
  // local template's <think> markers (here) reach the operator the same way.
  const filteredOnContent = createThinkFilter(onContent, options);
  const reply = streamResult.local ? openReply(requestStartedAt) : null; // timed by phase for the ACTIVITY panel (reply-meter.js)
  const actionBoundary = createStreamActionBoundary(options.onActionBoundary, options);
  let buffer = '';
  let fullResponse = '';
  let observedUsage = null;
  let firstOutputAt = null;
  let finishReason = null;
  // The SSE event vocabulary follows the wire DIALECT, not the provider id.
  const wire = dialect || provider;
  const stallLimit = stallLimitFor(streamResult);

  // Single exit for every stream-end path so the usage contract holds:
  // options.onUsage fires exactly once with { promptTokens, completionTokens }
  // or null. Cache details and client-monotonic TTFT ride the separate
  // onTelemetry callback; absence remains null and never becomes a fake zero.
  // options.onFinishReason follows the same once-at-end contract.
  const finish = () => {
    if (reply) closeReply(reply);
    const usage = tokenUsageOnly(observedUsage);
    if (usage === null && wire !== 'ollama' && wire !== 'anthropic') {
      log.debug('Stream ended without a usage chunk — token counts downgrade to approx', { provider });
    }
    const telemetry = buildProviderStreamTelemetry({
      usage: observedUsage,
      requestStartedAt,
      firstOutputAt,
    });
    notifyObserver('onUsage', options.onUsage, usage);
    notifyObserver('onTelemetry', options.onTelemetry, telemetry);
    notifyObserver('onFinishReason', options.onFinishReason, finishReason);
    return fullResponse;
  };

  while (true) {
    let read;
    try {
      read = await readWithStallGuard(reader, stallLimit);
    } catch (error) {
      // A witness interrupt aborts the fetch mid-stream. What already
      // arrived IS the response — a cut, not a failure.
      if (options.signal?.aborted) return finish();
      throw error;
    }
    const { done, value } = read;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const evt = readStreamLine(line, wire);
      if (evt === null) continue;
      // The provider's failure CODE rides the throw (server_error,
      // overloaded_error, …) — the ladder classifies by code, and a bare
      // message once read as unretryable (the 2026-07-29 gap).
      if (evt.error) {
        throw Object.assign(new Error(evt.error), evt.code ? { code: evt.code } : {});
      }
      if (reply) stepReply(reply, evt, performance.now());
      if (evt.usage) observedUsage = mergeStreamUsage(observedUsage, evt.usage);
      if (evt.finishReason) finishReason = evt.finishReason;
      if (firstOutputAt === null && hasProviderOutput(evt)) {
        firstOutputAt = performance.now();
      }
      // The reasoning channel a vendor opens beside the speech. It is watched,
      // never spoken: it does not touch fullResponse, so no path can leak a
      // being's thinking into its answer or into what gets recorded as speech.
      if (actionBoundary(evt, 'before')) { await cancelActionStream(reader, options.signal); return finish(); }
      if (evt.reasoning && options.onReasoning) options.onReasoning(evt.reasoning);
      if (evt.content !== null && evt.content !== undefined) {
        fullResponse += evt.content;
        filteredOnContent(evt.content);
      }
      if (evt.toolCalls && onToolDelta) onToolDelta(evt.toolCalls);
      // a done frame's own words and call are read before the turn ends (llm-stream-frames.js)
      if (evt.done) return finish();
      if (actionBoundary(evt, 'after')) { await cancelActionStream(reader, options.signal); return finish(); }
    }
  }

  return finish();
};

/**
 * Parse a streaming response, calling onContent for each token.
 * Automatically filters <think>...</think> blocks from thinking models.
 * Returns the full concatenated response text (think tags stripped).
 * Throws if the stream goes silent past its wire's limit (llm-stall-guard.js).
 * Pass { implicitOpen: true } (from getThinkBehavior) when the active
 * model reasons without an opening marker in its output.
 * Pass { onUsage, onTelemetry }: token counts keep their existing shape/null;
 * telemetry reports client-monotonic TTFT plus optional provider cache/prefill
 * fields, preserving unsupported values as null rather than invented zeros.
 */
export const consumeStream = async (streamResult, onContent, options = {}) => {
  const fullResponse = await _pumpStream(streamResult, onContent, options);
  return stripThinkTags(fullResponse);
};

/**
 * Merge one OpenAI delta.tool_calls fragment into an assembled-by-index map.
 * The function name arrives on the first fragment; arguments stream across
 * many fragments and are concatenated. Mutates `assembled` in place (caller
 * owns the map); shared by the chat consumer and the birth ceremony loop.
 */
export const mergeToolCallDelta = (assembled, delta) => {
  const idx = delta.index ?? 0;
  if (!assembled[idx]) assembled[idx] = { id: null, name: '', args: '' };
  if (delta.id && !assembled[idx].id) assembled[idx].id = delta.id;
  if (delta.function?.name) assembled[idx].name = delta.function.name;
  if (delta.function?.arguments) assembled[idx].args += delta.function.arguments;
};

/**
 * Decode an assembled-by-index map of native tool-call deltas ({ name, args })
 * into the unified { server, toolName, tool, args } shape that parseToolCalls
 * yields. Shared by the chat consumer and the birth ceremony's manual stream
 * loop so the decode lives in exactly one place. `args` is a JSON string under
 * OpenAI streaming; a parse failure yields {} (the call survives, args empty).
 */
export const decodeToolCallDeltas = (assembled) =>
  Object.values(assembled).map((a) => {
    const { server, toolName } = decodeToolName(a.name);
    // Repaired the way text calls are (control chars, path/content salvage, near-JSON);
    // what still will not read rides as _argsError so the model is TOLD, never run on {}.
    let args = {};
    let argsError = null;
    if (a.args && a.args.trim()) {
      const parsed = tryParseArgs(a.args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      else argsError = a.args.slice(0, 200);
    }
    return Object.freeze({
      callId: a.id || null,
      server,
      toolName,
      tool: server ? `${server}/${toolName}` : toolName,
      args,
      ...(argsError !== null ? { _argsError: argsError } : {}),
      _native: true,
    });
  });

/**
 * Native function-calling consumer. Like consumeStream, but also assembles
 * OpenAI delta.tool_calls fragments (streamed by index) and decodes them into
 * the same { server, toolName, tool, args } shape parseToolCalls yields — so
 * the execution path is identical whether the model called a tool natively or
 * in text. Returns { content, toolCalls }; content is think-stripped.
 *
 * A model that emits no native calls returns toolCalls: [] — the caller then
 * falls back to parseToolCalls on the text. This is the path that makes native
 * function calling (e.g. gpt-oss-120b through LM Studio) reliable: the model
 * does what it was trained to do instead of being coaxed into a text dialect.
 *
 * Pass { implicitOpen: true } (from getThinkBehavior) as options for thinking
 * substrates; onUsage and onTelemetry keep the same once-at-stream-end
 * contracts as consumeStream.
 */
export const consumeStreamWithTools = async (streamResult, onContent, options = {}) => {
  const assembled = {};
  const onToolDelta = (deltas) => {
    for (const d of deltas) mergeToolCallDelta(assembled, d);
  };
  const fullResponse = await _pumpStream(streamResult, onContent, options, onToolDelta);
  return { content: stripThinkTags(fullResponse), toolCalls: Object.freeze(decodeToolCallDeltas(assembled)) };
};

// A health probe must resolve fast — a dead-but-listening provider must not
// stall the desk's connection poll (connection-refused already fails instantly).
const PROBE_TIMEOUT_MS = 2500;

/**
 * Test connection to the configured LLM provider.
 */
export const testConnection = async () => {
  const config = getConfig();
  try {
    switch (config.provider) {
      case 'ollama': {
        const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        return res.ok;
      }
      case 'anthropic':
        return !!(config.apiKey && config.apiKey.startsWith('sk-ant-'));
      default: {
        const headers = config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {};
        const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/v1/models`, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        return res.ok;
      }
    }
  } catch {
    return false;
  }
};

// Capability answers are cached per route — _contextBudget asks every turn
// and the image gate every image turn, and a serving's senses do not change
// while it serves. The TTL is what lets a RESTARTED substrate (projector
// attached, model swapped) be noticed honestly within a minute.
/**
 * Look a model up in its provider's catalog entry — the models.dev-catalog
 * rung. Sits between the KNOWN_MODELS hand table and name inference: the
 * catalog is generated from models.dev at sync time and carries the windows
 * for every provider the platform can route to, so a third-party model the
 * hand table has never heard of still reads a sourced limit instead of
 * LIMIT UNKNOWN (Design note, 2026-07-27: […]).
 * Matching mirrors getCapabilities: exact, then longest prefix on a boundary,
 * on both the raw id and the org-stripped form. Pure.
 * @param {string} provider
 * @param {string} modelId
 * @returns {{contextWindow: number}|null}
 */
export const catalogCapabilitiesFor = (provider, modelId) => {
  if (!modelId) return null;
  const models = getProvider(provider)?.models;
  if (!Array.isArray(models) || models.length === 0) return null;
  const stripped = modelId.split('/').pop().split(':')[0];
  // maxOutput rides along. Every catalog entry carries BOTH numbers and only
  // the window was ever read — but they answer different questions: the window
  // is how much the model can hold, maxOutput is how much it may emit in one
  // turn, and for a hosted provider the second is a hard limit that returns a
  // 400 rather than a shorter reply. Budgeting output against the window alone
  // would be correct for a local serving and wrong for every API route.
  const shape = (m) => Object.freeze({
    contextWindow: m.contextWindow,
    ...(Number.isFinite(m.maxOutput) && m.maxOutput > 0 ? { maxOutput: m.maxOutput } : {}),
  });
  const exact = models.find((m) => m.id === modelId || m.id === stripped);
  if (exact && Number.isFinite(exact.contextWindow)) return shape(exact);
  const match = models
    .filter((m) => hasPrefixBoundary(modelId, m.id) || hasPrefixBoundary(stripped, m.id))
    .sort((a, b) => b.id.length - a.id.length)[0];
  return match && Number.isFinite(match.contextWindow) ? shape(match) : null;
};

/**
 * Get capabilities for a concrete route — the provider/endpoint/model a turn
 * will ACTUALLY ride. Runtime truth first, name inference last: LM Studio's
 * v0 report and llama.cpp's /props modalities declare vision that a model's
 * NAME never reveals (the resident qwen3.5-122b-a10b and gemma-4-31b both
 * read images; their names say nothing). With no route the machine config
 * stands — the historical "active model" behavior.
 * @param {{provider: string, endpoint: string, apiKey?: string, accountId?: string, model: string}|null} route
 */
export const getRouteCapabilities = async (route = null) => {
  const { caps: capsCache, lastGood: lastGoodRuntime } = runtimeModelCaches();
  const config = getConfig();
  const provider = route?.provider || config.provider;
  const endpoint = route?.endpoint || config.endpoint;
  const apiKey = route?.apiKey ?? config.apiKey;
  // An explicit route is an isolation boundary. Missing account identity on
  // that route means unknown, never […].
  const accountId = route ? (route.accountId ?? null) : (config.accountId ?? null);
  let modelId = route?.model || config.model;
  // Subscription model metadata is account-scoped. A shared endpoint/model
  // key would let one account's effective window leak into another route.
  const cacheKey = `${provider}|${endpoint}|${accountId || ''}|${modelId}`;
  const cached = capsCache.get(cacheKey);
  if (capsCacheFresh(cached, Date.now())) return cached.value;
  // 'local-model' is a placeholder, not a model — ask the server what it
  // serves so the probe and the inference both name the real vessel.
  if (!modelId || modelId === 'local-model') {
    const served = await fetchServedModelId(endpoint, apiKey);
    if (served) modelId = served;
  }
  const declared = getCapabilities(modelId);
  // The catalog rung only speaks when the hand table missed — a KNOWN_MODELS
  // value is a hand correction and always wins over generated data.
  const catalog = declared.family === 'unknown' ? catalogCapabilitiesFor(provider, modelId) : null;
  const inferred = {
    model: modelId,
    ...declared,
    // Prompt-surface profile rows ride the capability answer (NITE-004,
    // #399) so envelope/prompt consumers read them from the one chokepoint.
    ...promptProfileFor(modelId),
    ...(catalog ? { contextWindow: catalog.contextWindow } : {}),
    ...(catalog?.maxOutput ? { maxOutput: catalog.maxOutput } : {}),
    contextWindowSource: declared.family === 'unknown'
      ? (catalog ? 'models.dev-catalog' : (declared.contextWindow === 4096 ? 'unknown' : 'model-name'))
      : 'model-capabilities',
  };
  let runtime = null;
  let runtimeProbable = false;
  if (provider === 'lm-studio' || provider === 'llama-server' || provider === 'ollama') {
    runtime = await queryLocalCapabilities(provider, endpoint, modelId);
    runtimeProbable = true;
  } else if (provider === 'custom') {
    runtime = await probeEndpointCapabilities(endpoint, modelId);
    runtimeProbable = true;
  } else if (getProvider(provider)?.dialect === 'openai-responses') {
    // ChatGPT subscription models publish their EFFECTIVE account-route
    // window on /models (gpt-5.6-sol is 272k here, not the 1.05m API window).
    // This provider truth is what LEFT must use for a witness on this route.
    const models = await liveModels(getProvider(provider), endpoint, apiKey, {
      accountId,
    });
    const active = models.find((model) => model.id === modelId);
    // No live value means unknown for this subscription route. Falling back
    // to the API model declaration would overstate ChatGPT's account-specific
    // effective window (1.05m declared versus 272k observed on this route).
    runtime = Number.isFinite(active?.contextWindow)
      ? { contextWindow: active.contextWindow, contextWindowSource: 'provider-runtime' }
      : { contextWindow: null, contextWindowSource: 'unknown' };
  }
  // D6 flap damping — local probes only (the openai-responses branch above
  // deliberately refuses fallbacks: an account-scoped window must not ride a
  // stale reading). A failed local probe inherits the route's last GOOD
  // runtime reading instead of collapsing to a static rung for a turn.
  if (runtimeProbable) {
    if (Number.isFinite(runtime?.contextWindow) && runtime.contextWindow > 0) {
      lastGoodRuntime.set(cacheKey, { at: Date.now(), value: runtime });
    } else {
      const lastGood = lastGoodRuntime.get(cacheKey);
      if (lastGood) runtime = { ...lastGood.value, contextWindowSource: 'provider-runtime-last-good' };
    }
  }
  const result = runtime
    ? {
        ...inferred,
        ...(typeof runtime.tools === 'boolean' ? { tools: runtime.tools } : {}),
        ...(typeof runtime.vision === 'boolean' ? { vision: runtime.vision } : {}),
        ...(runtime.contextWindowSource
          ? { contextWindow: runtime.contextWindow, contextWindowSource: runtime.contextWindowSource }
          : Number.isFinite(runtime.contextWindow)
            ? { contextWindow: runtime.contextWindow, contextWindowSource: 'provider-runtime' }
            : {}),
      }
    : inferred;
  if (!(await visionSettings.isEnabled())) result.vision = false;
  else if (typeof result.vision !== 'boolean') result.vision = true;
  // An unregistered model must be LOUD at the point of consumption (NITE-004,
  // #399): every rung missed — hand table, catalog, name inference, runtime
  // probe — so this turn runs on assumption-driven caps. The cache makes this
  // fire at most once per TTL per route, a heartbeat rather than a flood. The
  // model and provider ride IN the message: the SUBSTRATE failures panel
  // renders only msg, so details carried as data were invisible there and the
  // warning named no route (substrate-failures-panel, 2026-09-18).
  if (result.contextWindowSource === 'unknown') {
    log.warn(`Model unknown to every capability rung — running on assumption-driven caps (${provider} · ${modelId})`, {
      model: modelId, provider, endpoint, assumedContextWindow: result.contextWindow,
    });
  }
  if (!localCapabilityProbeFailed(provider, runtime)) capsCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
};

/**
 * Get capabilities for the currently active model — the machine config's own
 * route through getRouteCapabilities (the runtime override is no longer
 * LM-Studio-only: llama-server and Ollama report their truth too).
 */
export const getActiveModelCapabilities = async () => {
  const model = await getActiveModel();
  const config = getConfig();
  return getRouteCapabilities({
    provider: config.provider,
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    accountId: config.accountId,
    model: model?.id || config.model,
  });
};
