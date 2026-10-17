/** Actual request/prompt builders; this proves contracts, not vendor behavior. */
import { describe, expect, test } from 'vitest';
import { buildStreamBody } from '../../backend/services/llm-request-builders.js';
import { buildToolsSection, TOOL_COMPLETION_INSTRUCTION, PARALLEL_COMPLETION_INSTRUCTION } from '../../core/runtime/tools-section.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { buildWitnessPromptSections } from '../../backend/services/witness-prompt.js';

const tools = [{ type: 'function', function: {
  name: 'fs__read', description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
} }];
const catalog = [{ server: 'fs', name: 'read', description: 'Read a file', access: 'allowed' }];
const messages = [{ role: 'user', content: 'Read the file' }];

describe('native tool completion contract', () => {
  test.each(['openai', 'openai-chatgpt', 'anthropic', 'kimi-for-coding', 'ollama'])('%s preserves tools and requests serial calls where supported', (provider) => {
    const body = buildStreamBody({ provider, model: 'contract-test', maxTokens: 1024 }, messages, { tools });
    expect(body.tools).toHaveLength(1);
    if (['anthropic', 'kimi-for-coding'].includes(provider)) {
      expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    } else if (provider !== 'ollama') {
      expect(body.parallel_tool_calls).toBe(false);
    } else {
      expect(body).not.toHaveProperty('parallel_tool_calls');
    }
  });

  test('the sender may ask for several calls in one reply; serial stays the default', () => {
    const asked = buildStreamBody({ provider: 'openai', model: 'contract-test', maxTokens: 1024 }, messages, { tools, parallelToolCalls: true });
    expect(asked.parallel_tool_calls).toBe(true);
    const unasked = buildStreamBody({ provider: 'openai', model: 'contract-test', maxTokens: 1024 }, messages, { tools, parallelToolCalls: 'yes' });
    expect(unasked.parallel_tool_calls).toBe(false);
  });

  test.each(['openai', 'anthropic', 'ollama'])('%s text-only requests gain no tool choice', (provider) => {
    const body = buildStreamBody({ provider, model: 'contract-test' }, messages, {});
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('parallel_tool_calls');
  });
});

test.each([[false, false], [true, false], [true, true]])('neuma prompt native=%s lazy=%s teaches completion', (native, lazy) => {
  expect(buildToolsSection(catalog, null, native, lazy)).toContain(TOOL_COMPLETION_INSTRUCTION);
});

// BFCL 2026-10-11: […] held the parallel categories far below bare
// while the wire allowed several calls — the prompt follows the sender's call shape.
test.each([[false, false], [true, false], [true, true]])('a sender that allows several calls is never told one at a time (native=%s lazy=%s)', (native, lazy) => {
  const text = buildToolsSection(catalog, null, native, lazy, true);
  expect(text).toContain(PARALLEL_COMPLETION_INSTRUCTION);
  expect(text).not.toContain('Call one tool at a time');
});

test('the assembler carries the call shape into the tools section; serial stays the default', () => {
  const tools = (opts) => assemblePromptSections({ tools: catalog, ...opts }).find((section) => section.id === 'tools').text;
  expect(tools({ parallelCalls: true })).toContain(PARALLEL_COMPLETION_INSTRUCTION);
  expect(tools({})).toContain(TOOL_COMPLETION_INSTRUCTION);
});

test.each([false, true])('witness prompt native=%s teaches the same completion rule', (nativeToolsOnWire) => {
  const sections = buildWitnessPromptSections({
    witness: { chosenName: 'Contract', vendorSlug: 'openai' }, dna: null,
    tools: catalog, nativeToolsOnWire, now: new Date('2026-09-07T00:00:00Z'),
  });
  expect(sections.find((section) => section.id === 'tools')?.text).toContain(TOOL_COMPLETION_INSTRUCTION);
});

// THE TOOL HUD (2026-10-14): no hand is ever wired for a folder — the ground
// is named and every hand is one call (or one search) away.
test('an open folder is named as the ground; no hand is ever promised as wired', () => {
  const fsCatalog = [{ server: 'fs', name: 'read', description: 'Read a file', access: 'allowed' }, { server: 'system', name: 'tool_search', description: 'Find a tool', access: 'allowed' }];
  const section = buildToolsSection(fsCatalog, '/repo', true, true);
  expect(section).not.toContain('ALWAYS WIRED');
  expect(section).toContain('YOUR GROUND: /repo');
  expect(section).toContain('system/tool_search');
  expect(section).toContain('system/call');
});
