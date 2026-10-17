// neuma-probe.js — ask a neuma one question through its REAL stack.
//
// impure: loads sovereign identity (DNA + soul), assembles the same system
// prompt chat uses, and runs a single non-streamed completion. Read-only — no
// journaling, no memory write, no WebSocket (a caller may WATCH the stream
// through onText/onReasoning). This is the ONE LLM primitive the
// benchmark harness calls, so every probe is measured through the genuine
// prompt-assembly path rather than a synthetic shortcut.

import { createStreamRequest, consumeStream, getConfig, getThinkBehavior, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { assemblePrompt, neumaWorkspace } from '../../core/index.js';
import { resolveLoraForTurn } from './adapter-binding.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import { resolveNeumaRoute, isSovereigntyRefusal } from './neuma-route-resolver.js';
import { isSovereignProvider } from './provider-registry.js';
import { createLogger } from './logger.js';
import { notifyObserver } from './observer-notifier.js';

const log = createLogger('NeumaProbe');
const noop = () => {};

/**
 * Ask a neuma a question and return its full reply (think-tags already stripped
 * by consumeStream). Throws if the substrate is unreachable — callers must let
 * that surface, not write a bogus measurement.
 * @param {string} neumaId
 * @param {Array<{role: string, content: string}>} messages - the probe turns (no system message)
 * @param {{ maxTokens?: number, onUsage?: Function, onFinishReason?: Function,
 *   onRequest?: Function, onMetrics?: Function, onText?: Function, onReasoning?: Function,
 *   route?: {provider: string, model: string, endpoint?: string, apiKey?: string} }} [opts]
 *   optional reply budget/provider hooks; defaults preserve the existing
 *   text-only path. `route` PINS the engine for this turn (the ignition check
 *   measures one identity across two of them) and is still refused if the
 *   provider is not sovereign.
 * @returns {Promise<string>} the neuma's reply, trimmed
 */
// impure
export const askNeuma = async (neumaId, messages, opts = {}) => {
  const [dna, soul, trueName] = await Promise.all([
    neumaWorkspace.readDNA(neumaId),
    neumaWorkspace.readSoul(neumaId),
    // Parity with the turn path includes the being's own name (#417). Without
    // it every measurement taken through this probe — the ignition check most
    // of all — scores a being on facts the prompt never gave it.
    neumaWorkspace.readTrueName(neumaId).catch(() => null),
  ]);
  const systemPrompt = assemblePrompt({ dna, soul, trueName });
  // Full parity with a chat turn: the being's own model route (natal local
  // model or configured override), and its OWN refined adapter riding the
  // request — a team member answering through the bare base would be someone
  // else's voice doing its position. Ordinary failures fall back exactly as
  // chat's do: machine config, bare base, never a stalled probe. A
  // SOVEREIGNTY refusal is not an ordinary failure — the boundary closed the
  // door the machine-config fallback would ride, so it surfaces like any
  // unreachable substrate instead of borrowing the rejected door.
  let route;
  // A caller may PIN the engine. The ignition check (#397) measures ONE
  // identity across TWO substrates, so it must be able to say which arm this
  // turn rides — the being's own resolution would answer with the same engine
  // both times and the diff, which IS the measurement, would be zero by
  // construction. The pin chooses WHICH sovereign door, never whether to use
  // one: it is held to the same boundary as a stored override, so it cannot
  // become a hatch for carrying a being onto a foreign substrate.
  if (opts.route) {
    if (!isSovereignProvider(opts.route.provider)) {
      throw new Error(`probe route pin refused — ${opts.route.provider} is not a sovereign provider`);
    }
    route = opts.route;
    log.info('probe riding a pinned route', { neumaId, provider: route.provider, model: route.model });
  } else {
    try {
      route = await resolveNeumaRoute(neumaId, dna);
    } catch (err) {
      if (isSovereigntyRefusal(err)) throw err;
      // The machine-config fallback is lawful only onto a sovereign door; a
      // failure upstream of the boundary check must not smuggle the probe onto
      // a foreign one (same guard as the portal turn path).
      if (!isSovereignProvider(getConfig().provider)) throw err;
      log.warn('probe route resolution failed — machine default', { neumaId, error: err.message });
      route = undefined;
    }
  }
  // Reasoning shape must be read from the SAME conduit the turn will ride.
  // Probed against the machine default it can classify a different model, and
  // a thinking substrate then streams with the wrong budget and an unarmed
  // filter — reasoning lands in the being's recorded words. Route may be
  // undefined here; getThinkBehavior falls back to the machine config.
  const thinkBehavior = await getThinkBehavior(route);
  // One probe is one exchange, so it owns one operation. A registry that
  // cannot be read REFUSES here rather than falling back to the bare base: a
  // measurement taken through unknown weights is a bogus measurement, and this
  // primitive exists precisely so none are written.
  const binding = await resolveLoraForTurn(neumaId, route || getConfig(), {
    operation: createRefinementProcessOperation({
      signal: opts.signal ?? null,
      timeoutMs: 30_000,
    }),
  });
  const { lora } = binding;
  if (binding.reason === 'bound') log.info('probe adapter binding', { neumaId, adapter: binding.adapter.id, reason: binding.reason });
  else log.warn('probe speaking bare — adapter registered but not bound', { neumaId, adapter: binding.adapter?.id ?? null, reason: binding.reason });
  // Which voice is about to speak — for callers whose records carry
  // provenance (the meditation synthesis contract's meta.adapter/model).
  notifyObserver('onBinding', opts.onBinding, Object.freeze({
    adapter: binding.reason === 'bound' ? binding.adapter.id : null,
    reason: binding.reason,
    model: route?.model || getConfig().model,
  }));
  const providerStartedAt = opts.onMetrics ? performance.now() : null;
  const streamResult = await createStreamRequest(
    [{ role: 'system', content: systemPrompt }, ...messages],
    {
      temperature: 0.7,
      maxTokens: (opts.maxTokens ?? getConfig().maxTokens) + (thinkBehavior.thinks ? THINK_TOKEN_BUDGET : 0),
      ...(route ? { route } : {}),
      ...(lora ? { lora } : {}),
      // A caller's cut (the council's call-to-order) reaches the wire —
      // the decode stops, not just the listener.
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onRequest ? { onRequest: opts.onRequest } : {}),
    },
  );
  // A watcher (a team run's live panel) may follow the words and the
  // reasoning as they arrive; without one the probe reads exactly as before.
  const raw = await consumeStream(streamResult, opts.onText || noop, {
    ...thinkBehavior, onUsage: opts.onUsage, onFinishReason: opts.onFinishReason,
    ...(opts.onReasoning ? { onReasoning: opts.onReasoning } : {}),
  });
  if (opts.onMetrics) notifyObserver('onMetrics', opts.onMetrics, Object.freeze({ type: 'provider-call', durationMs: performance.now() - providerStartedAt, outputBytes: Buffer.byteLength(raw, 'utf8') }));
  return raw.trim();
};
