import { describe, expect, it } from 'vitest';
import { httpErrorFromResponse } from '../../frontend/utils/http.js';

describe('HTTP refusal metadata from parsed response bodies', () => {
  it('keeps status and a usable message for null or scalar JSON error bodies', () => {
    for (const data of [null, undefined, false, 0, 'unavailable', [], {}]) {
      const error = httpErrorFromResponse(data, 503);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Request failed (503)');
      expect(error.http).toBe(503);
      expect(error.code).toBeUndefined();
      expect(error.retryAfterMs).toBeUndefined();
    }
  });

  it('retains the server refusal code and its retry interval', () => {
    const data = Object.freeze({ error: 'Wait for the current request', code: 'BUSY', retryAfterMs: 2500 });
    expect(httpErrorFromResponse(data, 429)).toMatchObject({
      message: 'Wait for the current request', code: 'BUSY', http: 429, retryAfterMs: 2500,
    });
  });

  it('uses caller punctuation only for the fallback message', () => {
    const options = { errorPrefix: 'Social channels request failed', errorSuffix: '.' };
    expect(httpErrorFromResponse(null, 502, options).message).toBe('Social channels request failed (502).');
    expect(httpErrorFromResponse({ error: 'Unknown channel' }, 404, options).message).toBe('Unknown channel');
  });

  it('keeps a fixed client message without losing server metadata', () => {
    const error = httpErrorFromResponse({ error: 'Private server detail', code: 'DENIED', retryAfterMs: 0 }, 403, {
      errorPrefix: 'Could not read remote status', useServerError: false,
    });
    expect(error).toMatchObject({ message: 'Could not read remote status (403)', code: 'DENIED', http: 403, retryAfterMs: 0 });
  });

  it('unwraps the structured refusal shape — {error: {code, message}} never reads "[object Object]"', () => {
    const data = Object.freeze({ error: Object.freeze({ code: 'BENCH_RIG_LOCKED', message: 'the rig is locked by pid 42 — one benchmark at a time' }) });
    expect(httpErrorFromResponse(data, 409)).toMatchObject({
      message: 'the rig is locked by pid 42 — one benchmark at a time', code: 'BENCH_RIG_LOCKED', http: 409,
    });
    // A top-level code still wins when present; a message-less object falls back.
    expect(httpErrorFromResponse({ error: { message: 'm' }, code: 'TOP' }, 400).code).toBe('TOP');
    expect(httpErrorFromResponse({ error: {} }, 503, { errorPrefix: 'Bench request failed' }).message)
      .toBe('Bench request failed (503)');
  });
});
