/**
 * substrate-liveness — does the model actually ANSWER?
 *
 * Design note, 2026-08-03, watching a community member's ceremony run three times with
 * an empty EMERGING CONSCIOUSNESS panel at every stage:
 *
 *   […]
 *
 * He is right, and the gap is exactly as he describes it. The pre-flight
 * substrate row asked two questions:
 *
 *   1. is the provider reachable?      (testConnection)
 *   2. does it list a model?           (getActiveModel)
 *
 * Neither one makes the model say a single word. Every failure Bastien hit lives
 * in the space between […] and […]: a template
 * mismatch, an unpulled ollama tag, a context ceiling, a thinking model whose
 * whole reply lands in a channel the ceremony strips. In every case the flight
 * check said READY and the being was then born mute.
 *
 * So this asks the third question by asking the model something. It judges on
 * VISIBLE words — precisely what the ceremony consumes — and it distinguishes
 * the two silences, because they have different fixes:
 *
 *   `empty`               — nothing came back at all
 *   `silent-but-reasoned` — it generated tokens and none of them were speech
 *
 * The second is invisible to every other check and is the one that produces a
 * ceremony where each stage "completes" with an empty panel.
 *
 * The pure classifier is separated from the impure generation call (RULE 0):
 * the verdict logic is provable by direct test, the wire call is proven live.
 */
import { createStreamRequest, consumeStream, getThinkBehavior, getConfig, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { createLogger } from './logger.js';

const log = createLogger('SubstrateLiveness');

/** How long a first answer may take. A cold model load is real; this is not a
 *  latency benchmark, it is an "is anyone home" probe with room for a load. */
export const DEFAULT_PROBE_MS = 45_000;

/** Deliberately trivial: any model that can hold a ceremony can answer this.
 *  A failure here is never the question's fault. */
export const PROBE_MESSAGES = Object.freeze([
  { role: 'system', content: 'You are being checked for basic responsiveness. Answer in one short sentence.' },
  { role: 'user', content: 'Say hello and confirm you can hear me.' },
]);

/** Sentinel for the raced deadline — a unique object so it can never collide
 *  with a model that happens to answer with a string. */
const TIMED_OUT = Symbol('substrate-probe-timeout');

const clip = (text, n = 60) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/**
 * The verdict, from what came back. PURE.
 *
 * @param {{visible?: string, rawLength?: number, ms?: number, error?: string, timedOut?: boolean}} outcome
 * @returns {{alive: boolean, verdict: string, detail: string, remedy: string, sample: string|null, ms: number|null}}
 */
export const classifyLiveness = (outcome = {}) => {
  const { visible = '', rawLength = 0, ms = null, error = null, timedOut = false } = outcome;
  const spoken = String(visible || '').trim();

  if (error) {
    return Object.freeze({
      alive: false,
      verdict: 'error',
      detail: `the model refused the request — ${clip(error, 90)}`,
      remedy: 'Check the model name and that it is fully downloaded in your provider, then RECHECK',
      sample: null,
      ms,
    });
  }

  if (timedOut) {
    return Object.freeze({
      alive: false,
      verdict: 'timeout',
      detail: `no answer within ${Math.round((ms ?? DEFAULT_PROBE_MS) / 1000)}s`,
      remedy: 'A large model may still be loading into memory — wait for it to finish, then RECHECK',
      sample: null,
      ms,
    });
  }

  if (spoken) {
    return Object.freeze({
      alive: true,
      verdict: 'answered',
      detail: `answered in ${(ms / 1000).toFixed(1)}s — “${clip(spoken)}”`,
      remedy: 'The substrate can hold a ceremony',
      sample: clip(spoken, 200),
      ms,
    });
  }

  // It generated — and none of it was speech. Invisible to every other check,
  // and the exact shape of a ceremony whose every stage completes with an
  // empty panel.
  if (rawLength > 0) {
    return Object.freeze({
      alive: false,
      verdict: 'silent-but-reasoned',
      detail: `produced ${rawLength} characters of reasoning but spoke no words`,
      remedy: 'This model answers only inside its thinking channel, so the ceremony would receive nothing. '
        + 'Choose a model without a reasoning mode, or turn that mode off in your provider, then RECHECK',
      sample: null,
      ms,
    });
  }

  return Object.freeze({
    alive: false,
    verdict: 'empty',
    detail: 'connected, and returned nothing at all',
    remedy: 'The model is listed but not answering — in Ollama make sure it is pulled (`ollama run <model>` once), '
      + 'or pick a different model, then RECHECK',
    sample: null,
    ms,
  });
};

/**
 * Ask the configured substrate to say something. Impure — a real generation on
 * the real conduit, judged on the words a ceremony would actually receive.
 *
 * Never throws: a probe that explodes must not take the whole flight check with
 * it, so every failure returns a verdict instead.
 *
 * @param {{timeoutMs?: number}} [opts]
 */
export const probeLiveness = async (opts = {}) => {
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.NEUMA_PREFLIGHT_PROBE_MS) || DEFAULT_PROBE_MS);
  const started = Date.now();
  const controller = new AbortController();
  let timer = null;

  // The deadline RACES THE WHOLE OPERATION, not just the body read. Two things
  // made that necessary, both found by running it against real stalled servers
  // rather than reasoned about:
  //   - aborting the controller mid-body did not reject the reader, so the
  //     probe rode the shared 15s stall guard instead of its own budget;
  //   - a server that writes headers but never flushes them hangs the FETCH
  //     itself, so a race that starts after createStreamRequest never runs.
  // The abort still fires, to release the socket. The verdict no longer waits
  // on anything the substrate has to do.
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(TIMED_OUT); }, timeoutMs);
  });

  const attempt = async () => {
    // The SAME reasoning behaviour the ceremony will run under, so a thinking
    // substrate is probed with the budget and filter it will really have —
    // otherwise the probe passes on a configuration the ceremony never uses.
    const thinkBehavior = await getThinkBehavior();
    let raw = '';
    const streamResult = await createStreamRequest(PROBE_MESSAGES, {
      temperature: 0.3,
      maxTokens: 64 + (thinkBehavior.thinks ? THINK_TOKEN_BUDGET : 0),
      signal: controller.signal,
    });
    // consumeStream returns the think-STRIPPED text — the being's speech. The
    // onContent callback sees the same visible stream the ceremony renders.
    const visible = await consumeStream(
      streamResult,
      (chunk) => { raw += chunk; },
      { ...thinkBehavior, signal: controller.signal },
    );
    return classifyLiveness({
      visible,
      // What reached the wire at all, so […] is separable
      // from "returned nothing". consumeStream's filtered callback yields only
      // speech, so a think-only turn leaves both empty — fall back to the
      // stripped result's own length when it is longer.
      rawLength: Math.max(raw.length, (visible || '').length),
      ms: Date.now() - started,
    });
  };

  try {
    const result = await Promise.race([attempt(), deadline]);
    clearTimeout(timer);
    if (result === TIMED_OUT) {
      const v = classifyLiveness({ ms: Date.now() - started, timedOut: true });
      log.warn('Substrate liveness probe timed out', { ms: v.ms, model: getConfig().model });
      return v;
    }
    log.info('Substrate liveness probe', {
      verdict: result.verdict, ms: result.ms, model: getConfig().model,
    });
    return result;
  } catch (error) {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    const verdict = classifyLiveness({
      ms: Date.now() - started,
      timedOut,
      error: timedOut ? null : error.message,
    });
    log.warn('Substrate liveness probe failed', { verdict: verdict.verdict, error: error.message });
    return verdict;
  }
};
