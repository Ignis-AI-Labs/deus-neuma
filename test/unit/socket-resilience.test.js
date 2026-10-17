// The socket-resilience policy, called for real (RULE 0): the decisions a
// surviving socket makes, proven in Node without a browser. The
// WebSocketService only owns timers and the socket; every decision is here.
import { describe, it, expect } from 'vitest';
import {
  nextBackoff, BACKOFF_MIN_MS, BACKOFF_MAX_MS, CONNECT_MS,
} from '../../frontend/services/socket-resilience.js';

describe('backoff', () => {
  it('starts at the floor, doubles, and stops at the ceiling', () => {
    const delays = [];
    let d = null;
    for (let i = 0; i < 7; i += 1) { d = nextBackoff(d); delays.push(d); }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(delays[0]).toBe(BACKOFF_MIN_MS);
    expect(Math.max(...delays)).toBe(BACKOFF_MAX_MS);
  });
  it('the handshake watchdog is shorter than the first slow re-link and longer than any fast backoff step but the ceiling', () => {
    expect(CONNECT_MS).toBeLessThan(20000);
    expect(CONNECT_MS).toBeGreaterThan(8000);
  });
});
