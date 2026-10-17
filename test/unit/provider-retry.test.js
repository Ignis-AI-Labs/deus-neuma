/**
 * Provider retry (RULE 0) — the transient-overload ladder. Pure tables for
 * classification and backoff, and a REAL attempt-flow proof: a failing
 * provider function driven through withProviderRetry with a real clock
 * (short injected sleep, no mocks of the function under test — the attempts
 * genuinely run and genuinely fail until they heal).
 */
import { describe, test, expect } from 'vitest';
import {
  PROVIDER_RETRY_MAX_ATTEMPTS,
  describeProviderError,
  isTransientProviderError,
  providerRetryDelayMs,
  withProviderRetry,
} from '../../backend/services/provider-retry.js';

describe('isTransientProviderError — only what can heal retries', () => {
  test('overload phrasing, 429, and 5xx are transient', () => {
    expect(isTransientProviderError(new Error('Our servers are currently overloaded. Please try again later.'))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error('slow down'), { status: 429 }))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error('bad gateway'), { status: 502 }))).toBe(true);
    expect(isTransientProviderError(new Error('fetch failed'))).toBe(true);
    expect(isTransientProviderError(new Error('rate limit exceeded'))).toBe(true);
  });

  test('auth, permissions, and validation NEVER retry — they fail identically forever', () => {
    expect(isTransientProviderError(new Error('invalid_api_key'))).toBe(false);
    expect(isTransientProviderError(Object.assign(new Error('no'), { status: 401 }))).toBe(false);
    expect(isTransientProviderError(new Error('invalid_request_error: bad image'))).toBe(false);
    expect(isTransientProviderError(new Error('permission denied'))).toBe(false);
    expect(isTransientProviderError(null)).toBe(false);
  });
});

describe('providerRetryDelayMs — a few seconds more each time (Founder)', () => {
  test('linear ladder: 2s, 4s, 6s … 20s, ten attempts total', () => {
    expect(PROVIDER_RETRY_MAX_ATTEMPTS).toBe(10);
    expect([1, 2, 3, 4, 5].map(providerRetryDelayMs)).toEqual([2000, 4000, 6000, 8000, 10000]);
    expect(providerRetryDelayMs(9)).toBe(18000);
    expect(providerRetryDelayMs(99)).toBe(18000); // capped at the ladder's top
  });
});

describe('withProviderRetry — the real attempt flow', () => {
  const fastSleep = () => Promise.resolve(); // the ladder's shape, not its patience

  test('a provider that heals on attempt 3: two retries, notified each time, then the answer', async () => {
    let calls = 0;
    const notices = [];
    const result = await withProviderRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('Our servers are currently overloaded. Please try again later.');
        return 'PORTAL HOLDS';
      },
      { sleep: fastSleep, onRetry: (info) => notices.push(info) },
    );
    expect(result).toBe('PORTAL HOLDS');
    expect(calls).toBe(3);
    expect(notices.map((n) => [n.attempt, n.maxAttempts])).toEqual([[2, 10], [3, 10]]);
    expect(notices[0].reason).toContain('overloaded');
  });

  test('a permanent failure throws at once — no retries, no notices', async () => {
    let calls = 0;
    await expect(withProviderRetry(async () => {
      calls += 1;
      throw new Error('invalid_api_key');
    }, { sleep: fastSleep })).rejects.toThrow('invalid_api_key');
    expect(calls).toBe(1);
  });

  test('the zero-content guard: a mid-speech failure never retries (no duplication)', async () => {
    let calls = 0;
    await expect(withProviderRetry(async () => {
      calls += 1;
      throw new Error('overloaded');
    }, { sleep: fastSleep, contentStarted: () => true })).rejects.toThrow('overloaded');
    expect(calls).toBe(1);
  });

  test('the ladder runs out: the LAST transient error is what throws, after exactly 10 attempts', async () => {
    let calls = 0;
    const notices = [];
    await expect(withProviderRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('still overloaded'), { status: 503 });
    }, { sleep: fastSleep, onRetry: (n) => notices.push(n) })).rejects.toThrow('still overloaded');
    expect(calls).toBe(PROVIDER_RETRY_MAX_ATTEMPTS);
    expect(notices).toHaveLength(PROVIDER_RETRY_MAX_ATTEMPTS - 1);
  });

  test('an interrupted turn is never held hostage by a backoff', async () => {
    const abort = new AbortController();
    const realSleep = (ms, sig) => new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      sig?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); }, { once: true });
    });
    const waiting = withProviderRetry(async () => {
      abort.abort();
      throw new Error('overloaded');
    }, { sleep: realSleep, signal: abort.signal });
    await expect(waiting).rejects.toThrow('interrupted');
  });
});

// THE 200-WRAPPED FAILURES (Design note, 2026-07-29: […]). Kagipem's […]
// arrived as a response.failed SSE event inside a 200 stream — no status,
// no code on the throw — and read as unretryable. The code now classifies,
// and the canonical message alone is enough.
describe('isTransientProviderError — the in-stream failures', () => {
  test('provider 5xx-class CODES are transient, even with no status and no phrasing', () => {
    expect(isTransientProviderError(Object.assign(new Error('An error occurred while processing your request.'), { code: 'server_error' }))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error('Overloaded'), { code: 'overloaded_error' }))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error('slow down'), { code: 'rate_limit_exceeded' }))).toBe(true);
    expect(isTransientProviderError(Object.assign(new Error('x'), { code: 'api_error' }))).toBe(true);
  });

  test('a PERMANENT code outranks even transient phrasing — the provider named it', () => {
    expect(isTransientProviderError(Object.assign(new Error('overloaded capacity'), { code: 'invalid_api_key' }))).toBe(false);
    expect(isTransientProviderError(Object.assign(new Error('rate limit exceeded'), { code: 'context_length_exceeded' }))).toBe(false);
    expect(isTransientProviderError(Object.assign(new Error('try again later'), { code: 'invalid_request_error' }))).toBe(false);
  });

  test('OpenAI\'s canonical 200-wrapped 500 message is transient on its words alone', () => {
    expect(isTransientProviderError(new Error(
      'An error occurred while processing your request. You can retry your request, or contact us '
      + 'through our help center at help.openai.com if the error persists. Please include the request ID 9697592f.',
    ))).toBe(true);
  });

  test('the ladder CLIMBS the code-shaped failure and heals — the 2026-07-29 case, replayed', async () => {
    let calls = 0;
    const notices = [];
    const result = await withProviderRetry(
      async () => {
        calls += 1;
        if (calls < 4) {
          throw Object.assign(
            new Error('An error occurred while processing your request.'),
            { code: 'server_error' },
          );
        }
        return 'HEALED';
      },
      { sleep: () => Promise.resolve(), onRetry: (info) => notices.push(info) },
    );
    expect(result).toBe('HEALED');
    expect(calls).toBe(4);
    expect(notices).toHaveLength(3);
    expect(notices[0].reason).toContain('processing your request');
  });
});

// THE DROPPED STREAM (2026-08-06). Kagipem's turns died instantly on
// `terminated` — Node's fetch word for a stream that stopped arriving, with
// the reason hidden one level down in `cause`. The head message matched no
// table, so a recoverable socket death was classified PERMANENT, the ladder
// never ran, and the desk sent the operator to a status page that was green.
// The real error shape is proven in test/integration/provider-stream-drop.test.js;
// these are the pure tables that read it.
describe('isTransientProviderError — the dropped stream', () => {
  test('undici\'s bare `terminated` is transient — the whole word, on its own', () => {
    expect(isTransientProviderError(new TypeError('terminated'))).toBe(true);
  });

  test('the cause chain is read when the head knows nothing', () => {
    const socketDeath = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    expect(isTransientProviderError(new TypeError('fetch problem', { cause: socketDeath }))).toBe(true);
    expect(isTransientProviderError(new Error('read failed', { cause: Object.assign(new Error('aborted'), { code: 'ECONNRESET' }) }))).toBe(true);
    expect(isTransientProviderError(new Error('body error', { cause: Object.assign(new Error('Body Timeout Error'), { code: 'UND_ERR_BODY_TIMEOUT' }) }))).toBe(true);
  });

  test('the FIRST link with an opinion wins — a permanent head is never overruled by its cause', () => {
    const withNetworkCause = new Error('invalid_api_key', { cause: new Error('socket hang up') });
    expect(isTransientProviderError(withNetworkCause)).toBe(false);
  });

  test('a provider SENTENCE containing the word is not a dropped stream', () => {
    expect(isTransientProviderError(new Error('your account was terminated for abuse'))).toBe(false);
  });

  test('an unrelated failure still does not retry — the chain adds no optimism of its own', () => {
    expect(isTransientProviderError(new Error('model produced no output'))).toBe(false);
    expect(isTransientProviderError(new Error('boom', { cause: new Error('also boom') }))).toBe(false);
  });
});

describe('describeProviderError — the reason, not just the word', () => {
  test('`terminated` is spoken plainly, with what it blames', () => {
    const err = new TypeError('terminated', {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    });
    expect(describeProviderError(err)).toBe('the answer stream ended early (other side closed)');
  });

  test('an ordinary failure passes through unchanged', () => {
    expect(describeProviderError(new Error('Our servers are currently overloaded.')))
      .toBe('Our servers are currently overloaded.');
  });

  test('a repeated cause is said once, and a silent error still says something', () => {
    expect(describeProviderError(new Error('fetch failed', { cause: new Error('fetch failed') })))
      .toBe('fetch failed');
    expect(describeProviderError(new Error(''))).toBe('the provider failed without saying why');
  });
});

describe('withProviderRetry — an interrupt is never mistaken for a drop', () => {
  test('a torn socket after the operator aborts throws at once, no ladder', async () => {
    const abort = new AbortController();
    let calls = 0;
    await expect(withProviderRetry(async () => {
      calls += 1;
      abort.abort();
      // undici's shape when the fetch is aborted mid-body — transient words,
      // but the operator withdrew the question.
      throw new TypeError('terminated');
    }, { sleep: () => Promise.resolve(), signal: abort.signal })).rejects.toThrow('interrupted');
    expect(calls).toBe(1);
  });
});
