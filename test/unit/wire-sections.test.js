/**
 * WHAT RIDES BESIDE THE PROMPT, COUNTED (wire-sections.js) — Design note, 2026-11-20: […] The measured total is split over the counted sections by their characters,
 * so the tool definitions — uncounted — were spread over the rest: every section read larger than it was. Real
 * composition builder, real wire shapes.
 */
import { describe, expect, test } from 'vitest';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { besideTurnSections, keepToolsOnWire, toolDefinitionsOf, wireSectionsOf } from '../../backend/services/wire-sections.js';

const tool = (name) => ({ type: 'function', function: { name, description: `The ${name} hand. `.repeat(40), parameters: { type: 'object', properties: { path: { type: 'string', description: 'where' } } } } });

describe('the messages beside the operator\'s words', () => {
  test('each is its own section, measured; an image counts as its estimate, never its bytes', () => {
    const image = { role: 'user', content: [{ type: 'text', text: 'the chart' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(600_000)}` } }] };
    const queued = { role: 'user', content: 'Recent completed actions before the queued message arrived:\n\nsales/stage ok' };
    const tail = [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'found it' }];
    const wire = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'before' }, { role: 'assistant', content: 'reply' }, image, queued, { role: 'user', content: 'the words' }, ...tail];
    const sections = besideTurnSections(wire, { transcript: 2, priorImages: [image], queued: [queued], echo: [] });
    expect(sections.map((s) => [s.id, s.label])).toEqual([
      ['priorImages', 'EARLIER IMAGES (1, ~1300 TOKENS EACH, ESTIMATED)'],
      ['queuedActions', 'ACTIONS FINISHED BEFORE THIS MESSAGE'],
      ['callerTail', 'THE SENDER\'S TOOL RESULTS'],
    ]);
    expect(sections[0].chars).toBe('the chart'.length + 1300 * 4);
    expect(sections[1].chars).toBe(queued.content.length);
    expect(sections[2].chars).toBe(JSON.stringify(tail[0].tool_calls).length + 'found it'.length);
    // A plain turn carries none of them.
    expect(besideTurnSections([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }], {})).toEqual([]);
  });
});

describe('the tool definitions', () => {
  test('kept as each request is built; counted as the JSON that rides; none when none ride', () => {
    const connection = {};
    const tools = [tool('files_read'), tool('sales_stage')];
    expect(keepToolsOnWire(connection, tools)).toBe(tools);
    expect(toolDefinitionsOf(connection)).toEqual([{ id: 'toolDefinitions', label: 'TOOL DEFINITIONS (2)', chars: JSON.stringify(tools).length }]);
    keepToolsOnWire(connection, []);
    expect(toolDefinitionsOf(connection)).toEqual([]);
    expect(toolDefinitionsOf(null)).toEqual([]);
  });

  test('counted, they take their own share of the measured total instead of swelling every other section', () => {
    const prompt = [{ id: 'identity', label: 'IDENTITY', text: 'i'.repeat(8000) }, { id: 'currentTurn', label: 'CURRENT TURN', text: 'u'.repeat(2000) }];
    const connection = {};
    keepToolsOnWire(connection, Array.from({ length: 12 }, (_, i) => tool(`hand_${i}`)));
    const usage = { promptTokens: 6000, completionTokens: 10 };
    const before = buildCompositionEvent({ sections: prompt, usage });
    const after = buildCompositionEvent({ sections: wireSectionsOf(prompt, { role: 'system', content: 'x' }, connection), usage });
    const tokensOf = (event, id) => event.sections.find((s) => s.id === id)?.tokens;
    // Uncounted, the definitions' tokens were credited to identity: it read as nearly the whole measured window.
    expect(tokensOf(before, 'identity')).toBe(4800);
    const definitions = tokensOf(after, 'toolDefinitions');
    expect(definitions).toBeGreaterThan(0);
    expect(tokensOf(after, 'identity')).toBeLessThan(4800);
    expect(after.sections.reduce((n, s) => n + s.tokens, 0)).toBe(6000);
  });
});
