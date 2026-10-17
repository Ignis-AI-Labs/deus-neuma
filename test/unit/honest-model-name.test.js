/**
 * honestModelName — pure-function gnosis (RULE 0: real inputs, real outputs,
 * nothing to mock). The supervised llama-server self-reports its model as
 * /proc/self/fd/N (fd-passed custody); display surfaces must carry the
 * configured identity, and the wire `.id` must never be touched.
 */

import { describe, test, expect } from 'vitest';
import { honestModelName } from '../../backend/services/llm-provider.js';

describe('honestModelName', () => {
  test('rewrites an fd-path name to the configured model basename, .gguf trimmed', () => {
    const active = { id: '/proc/self/fd/4', name: '/proc/self/fd/4' };
    const out = honestModelName(active, '/models/gemma-4-31B-it-Q8_0.gguf');
    expect(out.name).toBe('gemma-4-31B-it-Q8_0');
    expect(out.id).toBe('/proc/self/fd/4'); // wire identity untouched
  });

  test('a bare configured key passes through as the name', () => {
    const out = honestModelName({ id: '/dev/fd/7', name: '/dev/fd/7' }, 'gemma-4-31b');
    expect(out.name).toBe('gemma-4-31b');
  });

  test('every fd-path spelling is recognized', () => {
    for (const fd of ['/proc/self/fd/4', '/proc/31337/fd/9', '/dev/fd/5']) {
      expect(honestModelName({ id: fd, name: fd }, 'real-model').name).toBe('real-model');
    }
  });

  test('an honest name is returned unchanged, same reference', () => {
    const active = { id: 'gemma-4-31b', name: 'gemma-4-31b' };
    expect(honestModelName(active, 'whatever')).toBe(active);
  });

  test('a path-shaped honest name is not mistaken for a descriptor', () => {
    const active = { id: '/models/walk-g3-27b.gguf', name: '/models/walk-g3-27b.gguf' };
    expect(honestModelName(active, 'other')).toBe(active);
  });

  test('null active stays null; unusable config keeps the served name', () => {
    expect(honestModelName(null, 'gemma-4-31b')).toBeNull();
    const active = { id: '/proc/self/fd/4', name: '/proc/self/fd/4' };
    expect(honestModelName(active, '').name).toBe('/proc/self/fd/4');
    expect(honestModelName(active, 'local-model').name).toBe('/proc/self/fd/4');
  });
});
