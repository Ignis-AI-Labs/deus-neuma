/**
 * Provider retry — a transient overload gets ten patient attempts, never a
 * dead stop (Design note, 2026-07-28: […]). Proven live today: the ChatGPT codex endpoint
 * answered […] 28 minutes after a clean
 * turn — capacity that comes and goes, so patience wins.
 *
 * The pure half (classification, backoff) is table-tested; the impure half
 * is one wrapper both lanes share. The zero-content guard is the safety
 * law: a round retries ONLY before any content has streamed — never
 * mid-speech, or a recovering provider could duplicate partial text.
 */

/** How many attempts total (1 initial + 9 retries). Founder's number: 10. */
export const PROVIDER_RETRY_MAX_ATTEMPTS = 10;

/**
 * The wait before attempt N+1, linear: 2s, 4s, 6s … 20s ([…]). ≈110s across the full ladder — patient, never an
 * eternity. Pure.
 * @param {number} retryIndex 1-based retry number (1 = first retry)
 * @returns {number} milliseconds to wait before this retry
 */
export const providerRetryDelayMs = (retryIndex) =>
  Math.min(retryIndex, PROVIDER_RETRY_MAX_ATTEMPTS - 1) * 2000;

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_PHRASE = /overload|overloaded|try again later|temporarily unavailable|service unavailable|rate limit|too many requests|capacity|timed?\s*out|timeout|econnreset|econnrefused|etimedout|socket hang up|other side closed|fetch failed|network|an error occurred while processing your request/i;
const PERMANENT_PHRASE = /invalid_api_key|incorrect api key|unauthorized|authentication_error|invalid_request_error|permission|forbidden|bad request/i;

// Node's fetch says exactly one word when a stream dies under it: `terminated`.
// Matched WHOLE, so a provider SENTENCE that happens to contain the word
// ([…]) is never swept in with it.
const DROPPED_STREAM = /^terminated$/i;

// The provider's own failure CODES, delivered over a 200 stream
// (OpenAI `response.failed`, Anthropic `error` events) — a class the status
// table can never see, because the HTTP answer was 200 before the stream
// began (the 2026-07-29 gap: Kagipem's […] read as unretryable and the ladder never ran).
const TRANSIENT_CODE = new Set([
  'server_error', 'internal_error', 'api_error', 'overloaded', 'overloaded_error',
  'rate_limit_error', 'rate_limit_exceeded', 'service_unavailable', 'timeout',
  // Our own fail-closed refusal when a local conduit's adapter state cannot
  // be probed (mid-boot substrate): it heals as the server settles, so the
  // ladder retries it rather than failing the turn (friction-map B2).
  'adapter_probe_unknown',
]);
const PERMANENT_CODE = new Set([
  'invalid_api_key', 'authentication_error', 'permission_error', 'invalid_request_error',
  'context_length_exceeded', 'request_too_large', 'not_found_error', 'billing_hard_limit_reached',
]);

// The socket's own word for the same death, one level down in `cause` —
// undici's classes and Node's errno, the shapes a dropped SSE actually wears.
const TRANSIENT_SOCKET_CODE = new Set([
  'und_err_socket', 'und_err_body_timeout', 'und_err_headers_timeout', 'und_err_connect_timeout',
  'econnreset', 'econnrefused', 'etimedout', 'epipe', 'eai_again',
]);

/** How far down `cause` to look. Deep enough for fetch → undici → errno. */
const CAUSE_DEPTH = 4;

/**
 * The error and everything it blames, head first. Pure.
 * @param {any} err
 * @returns {any[]}
 */
const causeChain = (err) => {
  const chain = [];
  for (let node = err; node && chain.length < CAUSE_DEPTH; node = node.cause) chain.push(node);
  return chain;
};

/**
 * One link's verdict: true transient, false permanent, null […]. Pure.
 * @param {{status?: number, code?: string, message?: string, body?: string}} err
 * @returns {boolean|null}
 */
const classifyLink = (err) => {
  // The provider's own word on the failure, when it gave one, outranks both
  // tables — a code is classification, not phrasing.
  const code = String(err.code || '').toLowerCase();
  if (code) {
    if (PERMANENT_CODE.has(code)) return false;
    if (TRANSIENT_CODE.has(code) || TRANSIENT_SOCKET_CODE.has(code)) return true;
  }
  const status = Number(err.status) || null;
  if (status && TRANSIENT_STATUS.has(status)) return true;
  const message = String(err.message || err.body || '');
  if (!message) return status && status >= 500 ? true : null;
  if (DROPPED_STREAM.test(message)) return true;
  if (PERMANENT_PHRASE.test(message)) return false;
  return TRANSIENT_PHRASE.test(message) ? true : null;
};

/**
 * Is this failure the kind that can heal on its own? Pure.
 * Transient: provider 5xx-class codes, 408/409/425/429/5xx statuses, network
 * failures, overload phrasing — and OpenAI's canonical 200-wrapped 500.
 * Permanent (never retried): auth, permissions, validation — those fail
 * identically forever and a retry would only stall the honest answer.
 *
 * The verdict walks the `cause` chain and the FIRST link with an opinion wins.
 * It has to: Node's fetch reports a stream the provider dropped mid-answer as
 * a bare `TypeError: terminated` and hides the reason one level down
 * (`SocketError: other side closed`, `BodyTimeoutError`, `ECONNRESET`).
 * Reading the head message alone called a recoverable socket death PERMANENT,
 * and the ladder never ran — proven live 2026-08-06 on Kagipem's ChatGPT
 * codex lane, where every dropped turn ended in one attempt and sent the
 * operator to a status page that had nothing to say about it.
 * @param {{status?: number, code?: string, message?: string}} err
 * @returns {boolean}
 */
export const isTransientProviderError = (err) => {
  if (!err) return false;
  for (const link of causeChain(err)) {
    const verdict = classifyLink(link);
    if (verdict !== null) return verdict;
  }
  return false;
};

/**
 * The failure in one operator-readable line: the head reason, then whatever it
 * blames, so a bare `terminated` never reaches the desk alone. Pure.
 * @param {any} err
 * @returns {string}
 */
export const describeProviderError = (err) => {
  const said = causeChain(err)
    .map((link) => String(link?.message || '').trim())
    .filter(Boolean);
  const [head, ...rest] = said.filter((message, i) => said.indexOf(message) === i);
  if (!head) return 'the provider failed without saying why';
  // `terminated` is undici's whole vocabulary for a stream that stopped
  // arriving. It names nothing an operator can act on, so say what happened.
  const plain = DROPPED_STREAM.test(head) ? 'the answer stream ended early' : head;
  return rest.length ? `${plain} (${rest.join(' — ')})` : plain;
};

/**
 * impure — run `fn` with the retry ladder. `fn(attempt)` performs one
 * attempt (1-based). Retries while `isTransientProviderError` and
 * `contentStarted()` stays false (the zero-content guard) and attempts
 * remain; `onRetry({attempt, delayMs, reason})` fires before each wait so
 * the desk can watch. The sleep aborts with the turn's signal — an
 * operator's interrupt is never held hostage by a backoff.
 *
 * @param {(attempt: number) => Promise<any>} fn
 * @param {{signal?: AbortSignal, contentStarted?: () => boolean,
 *   onRetry?: (info: {attempt: number, maxAttempts: number, delayMs: number, reason: string}) => void,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>}} [opts]
 * @returns {Promise<any>} the first successful attempt's result, or the
 *   last transient error thrown when the ladder runs out.
 */
export const withProviderRetry = async (fn, opts = {}) => {
  const {
    signal = null,
    contentStarted = () => false,
    onRetry = null,
    sleep = (ms, sig) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
      const onAbort = () => { clearTimeout(timer); cleanup(); reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); };
      const cleanup = () => sig?.removeEventListener?.('abort', onAbort);
      if (sig?.aborted) { clearTimeout(timer); reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); return; }
      sig?.addEventListener?.('abort', onAbort, { once: true });
    }),
  } = opts;

  let attempt = 0;
  let lastError = null;
  while (attempt < PROVIDER_RETRY_MAX_ATTEMPTS) {
    attempt += 1;
    if (signal?.aborted) throw Object.assign(new Error('interrupted'), { name: 'AbortError' });
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (err?.name === 'AbortError') throw err;
      // An operator's interrupt tears the socket down, and a torn socket
      // reaches here wearing the same clothes as a provider drop. Retrying it
      // would re-ask a question the operator just withdrew — so the interrupt
      // is named, in the same shape the loop head uses, and the ladder stops.
      if (signal?.aborted) throw Object.assign(new Error('interrupted'), { name: 'AbortError' });
      const transient = isTransientProviderError(err);
      const canStillHeal = !contentStarted();
      if (!transient || !canStillHeal || attempt >= PROVIDER_RETRY_MAX_ATTEMPTS) throw err;
      const delayMs = providerRetryDelayMs(attempt);
      if (onRetry) {
        onRetry({
          attempt: attempt + 1,
          maxAttempts: PROVIDER_RETRY_MAX_ATTEMPTS,
          delayMs,
          reason: String(err?.message || 'provider error').slice(0, 160),
        });
      }
      await sleep(delayMs, signal);
    }
  }
  throw lastError;
};
