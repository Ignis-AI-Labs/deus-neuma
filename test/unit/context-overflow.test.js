import { describe, test, expect } from 'vitest';
import {
  isContextOverflow, recoverContextOverflow, contextRecoveryOptions, measuredStandingFor,
} from '../../backend/services/context-overflow.js';
import { FOLDED_RESULT_STUB } from '../../backend/services/working-context.js';

const image = (label) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${label.repeat(1000)}` } });
const head = [
  { role: 'system', content: 'identity and grounding' },
  { role: 'user', content: [{ type: 'text', text: 'review these' }, image('CURRENT')] },
];
const round = [
  { role: 'assistant', content: 'I inspected the first render.', tool_calls: [{ id: 'call-1', function: { name: 'fs/read', arguments: '{"path":"render.png"}' } }] },
  { role: 'tool', tool_call_id: 'call-1', content: 'image bytes returned\n'.repeat(100) },
  { role: 'user', content: [{ type: 'text', text: 'the image is attached' }, image('REVIEW')] },
];

describe('provider context-overflow classification', () => {
  test('recognizes the exact llama-server refusal from the incident', () => {
    const detail = '{"error":{"code":400,"message":"REQUEST (183296 TOKENS) EXCEEDS THE AVAILABLE CONTEXT SIZE (65536 TOKENS)","type":"EXCEED_CONTEXT_SIZE_ERROR"}}';
    expect(isContextOverflow(400, detail)).toBe(true);
    expect(isContextOverflow(400, '{"error":{"type":"context_length_exceeded"}}')).toBe(true);
  });

  test('does not turn unrelated validation or transport failures into a retry', () => {
    expect(isContextOverflow(400, 'invalid sampling parameter')).toBe(false);
    expect(isContextOverflow(401, 'context_length_exceeded')).toBe(false);
    expect(isContextOverflow(500, 'temporary overload')).toBe(false);
  });
});

describe('emergency fold boundaries', () => {
  test('releases every in-turn payload while preserving the head and assistant speech', () => {
    const messages = [...head, ...round];
    const recovery = recoverContextOverflow(messages, 2);
    expect(recovery).not.toBeNull();
    expect(recovery.foldedRounds).toBe(1);
    expect(recovery.freedChars).toBeGreaterThan(5000);
    expect(recovery.messages.slice(0, 2)).toEqual(head);
    expect(recovery.messages[0]).toBe(head[0]);
    expect(recovery.messages[1]).toBe(head[1]);
    expect(recovery.messages[2].content).toBe(round[0].content);
    expect(recovery.messages[3].content).toBe(FOLDED_RESULT_STUB);
    expect(recovery.messages[4].content[0].text).toBe('the image is attached');
    expect(recovery.messages[4].content[1].type).toBe('text');
    expect(recovery.messages[4].content[1].text).toContain('released to free working context');
    expect(messages[4].content[1]).toBe(round[2].content[1]);
  });

  test('a head-only overflow has no lawful recovery and current attachments are never folded', () => {
    expect(recoverContextOverflow(head, 2)).toBeNull();
    expect(recoverContextOverflow([...head, ...round])).toBeNull();
    expect(recoverContextOverflow([...head, ...round], 0)).toBeNull();
  });

  test('both seats receive the same request options', () => {
    const onContextRecovery = () => {};
    expect(contextRecoveryOptions(7, onContextRecovery)).toEqual({ contextHead: 7, onContextRecovery });
  });
});

describe('measured standing context', () => {
  test('uses the settled measurement first', () => {
    expect(measuredStandingFor({ lastMeasuredStanding: { promptTokens: 64000 } })).toEqual({ promptTokens: 64000 });
  });

  test('falls back to a measured or carried composition after interruption', () => {
    for (const source of ['measured', 'carried']) {
      expect(measuredStandingFor({ contextComposition: { usage: { inputTokens: 64500, source } } })).toEqual({ promptTokens: 64500 });
    }
  });

  test('an approximate gauge never triggers session rewriting', () => {
    expect(measuredStandingFor({ contextComposition: { usage: { inputTokens: 65536, source: 'approx' } } })).toBeNull();
    expect(measuredStandingFor({})).toBeNull();
  });
});
