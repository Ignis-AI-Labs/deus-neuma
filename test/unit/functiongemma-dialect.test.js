import { expect, test } from 'vitest';
import { parseFunctionGemmaCalls } from '../../core/runtime/functiongemma-call-parser.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';
import { createToolStreamSuppressor, createToolStreamFilter, stripToolBlocks, extractToolLabel } from '../../core/runtime/tool-stream-suppressor.js';

const wrap = (args, name = 'calculate_triangle_area') => `<start_function_call>call:${name}${args}<end_function_call>`;
const captured = wrap('{base:10,height:5,unit:<escape>units<escape>}');
const response = '<start_function_response>result:50<end_function_response>';

test('captured FunctionGemma call reaches the canonical typed tool shape exactly once', () => {
  expect(parseToolCalls(captured + response)).toEqual([{
    server: null, toolName: 'calculate_triangle_area', tool: 'calculate_triangle_area',
    args: { base: 10, height: 5, unit: 'units' },
  }]);
  expect(extractToolLabel(captured)).toBe('calculate_triangle_area');
});

test('nested containers, escaped punctuation, primitive types and empty values survive', () => {
  const text = wrap('{items:[1,-2.5,3e2,true,false,null,{label:<escape>a,{b}:c<escape>}],empty:{},list:[],text:<escape><escape>,raw:units}');
  const [{ args }] = parseFunctionGemmaCalls(text);
  expect(args).toEqual({ items: [1, -2.5, 300, true, false, null, { label: 'a,{b}:c' }], empty: {}, list: [], text: '', raw: 'units' });
  expect(Object.isFrozen(args)).toBe(true);
  expect(Object.isFrozen(args.items)).toBe(true);
});

test('escaped terminator text is literal data and never escapes into speech', () => {
  const call = wrap('{value:<escape>secret<end_function_call>still secret<escape>}');
  expect(parseFunctionGemmaCalls(call)[0].args.value).toBe('secret<end_function_call>still secret');
  expect(stripToolBlocks(`Before ${call} after`)).toBe('Before  after');
  const reply = '<start_function_response><escape>secret<end_function_response>still secret<escape><end_function_response>';
  const filter = createToolStreamSuppressor();
  expect(filter.push(call + reply) + filter.flush()).toBe('');
});

test.each(['{x:<escape>unterminated}', '{x:[1,2}', '{x:}', '{x:1,}', '{x:{y:2}', '[1,2]', '{x:1}trailing', '{x:1,x:2}', '{x:1e999}', '{x:<escape>ok<escape>junk}'])('malformed arguments fail closed: %s', (args) => {
  expect(parseFunctionGemmaCalls(wrap(args))).toEqual([]);
});

test('incomplete envelope and excessive nesting fail without throwing', () => {
  expect(parseFunctionGemmaCalls(captured.slice(0, -5))).toEqual([]);
  expect(parseFunctionGemmaCalls(wrap('{x:'.repeat(70) + '1' + '}'.repeat(70)))).toEqual([]);
  expect(parseFunctionGemmaCalls('x'.repeat(1024 * 1024 + 1))).toEqual([]);
  expect(parseFunctionGemmaCalls(null)).toEqual([]);
});

test('multiple calls survive while malformed completed calls are skipped', () => {
  expect(parseFunctionGemmaCalls(wrap('{x:}', 'bad') + captured + wrap('', 'ping')).map((c) => c.name))
    .toEqual(['calculate_triangle_area', 'ping']);
  expect(parseToolCalls(captured + captured)).toHaveLength(1);
});

test('prototype-shaped keys remain own data properties', () => {
  const [{ args }] = parseFunctionGemmaCalls(wrap('{__proto__:{polluted:true},constructor:<escape>value<escape>}'));
  expect(Object.getPrototypeOf(args)).toBe(Object.prototype);
  expect(Object.hasOwn(args, '__proto__')).toBe(true);
  expect(args.__proto__).toEqual({ polluted: true });
  expect({}.polluted).toBeUndefined();
});

test('display and voice suppress every split boundary of call and response blocks', () => {
  const input = `Before ${captured}${response} after`;
  for (let split = 0; split <= input.length; split++) {
    const filter = createToolStreamSuppressor();
    expect(filter.push(input.slice(0, split)) + filter.push(input.slice(split)) + filter.flush()).toBe('Before  after');
  }
  let speech = ''; const blocks = [];
  const filter = createToolStreamFilter({ onSpeech: (s) => { speech += s; }, onToolEnd: (s) => blocks.push(s) });
  for (const char of input) filter.push(char);
  filter.flush();
  expect(speech).toBe('Before  after');
  expect(blocks).toEqual([captured, response]);
  expect(stripToolBlocks(input)).toBe('Before  after');
});

test('truncated payload stays suppressed at flush while ordinary partial prose survives', () => {
  const filter = createToolStreamSuppressor();
  expect(filter.push('Hello <start_function_call>call:x{secret:') + filter.flush()).toBe('Hello ');
  const prose = createToolStreamSuppressor();
  expect(prose.push('Use <start_ in this example') + prose.flush()).toBe('Use <start_ in this example');
});
