import { describe, expect, test } from 'vitest';
import { serializeToolIdentity } from '../../core/runtime/tool-call-identity.js';
import { toolCallKey } from '../../backend/services/witness-tool-epochs.js';

describe('semantic JSON tool identity', () => {
  test('normalizes nested objects without mutating arguments', () => {
    const first = { z: [{ b: 2, a: 1 }], a: { y: 'value', x: null } };
    const before = JSON.stringify(first);
    expect(serializeToolIdentity(first)).toBe(serializeToolIdentity({ a: { x: null, y: 'value' }, z: [{ a: 1, b: 2 }] }));
    expect(JSON.stringify(first)).toBe(before);
  });
  test('preserves array ordering and distinct scalar values', () => {
    expect(serializeToolIdentity([1, 2])).not.toBe(serializeToolIdentity([2, 1]));
    expect(serializeToolIdentity({ value: 1 })).not.toBe(serializeToolIdentity({ value: '1' }));
  });
  test('preserves prototype-shaped JSON keys as ordinary argument data', () => {
    const args = JSON.parse('{"z":1,"__proto__":{"safe":true}}');
    expect(serializeToolIdentity(args)).toBe('{"__proto__":{"safe":true},"z":1}');
    expect({}.safe).toBeUndefined();
  });
  test('keeps execution epochs significant', () => {
    const call = { server: 'coding', toolName: 'execute', args: { command: 'pwd' } };
    expect(toolCallKey(call, 1)).not.toBe(toolCallKey(call, 2));
  });
});
