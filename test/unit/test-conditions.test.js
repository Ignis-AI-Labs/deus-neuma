/**
 * THE TEST CONDITIONS (ruling, 2026-10-20): a benchmark sitting states up front
 * whether it is closed-book or open-book, with the tools it governs; every
 * other prompt stays byte-identical.
 */
import { describe, expect, test } from 'vitest';
import { CLOSED_BOOK_CONDITIONS, OPEN_BOOK_CONDITIONS, TASK_TOOLS_CONDITIONS, testConditionsFor, callerRulesFor, CALLER_RULES_LEAD } from '../../backend/services/test-conditions.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const TOOLS = [{ name: 'read', server: 'fs', description: 'read a file' }];
const toolsText = (opts) => assemblePromptSections({ tools: TOOLS, ...opts }).find((s) => s.id === 'tools').text;

describe('test conditions', () => {
  test('a closed-book benchmark sitting is told it is closed-book', () => {
    expect(testConditionsFor({ _benchmarkControls: {}, _closedBook: true })).toBe(CLOSED_BOOK_CONDITIONS);
  });

  test('an open-book benchmark sitting is told its tools are its to use', () => {
    expect(testConditionsFor({ _benchmarkControls: {}, _closedBook: false })).toBe(OPEN_BOOK_CONDITIONS);
  });

  test('a sitting that is no benchmark carries no conditions', () => {
    expect(testConditionsFor({})).toBe('');
    expect(testConditionsFor({ _closedBook: true })).toBe('');
    expect(testConditionsFor(null)).toBe('');
  });

  test('the conditions ride the TOOLS section, after the tools they govern', () => {
    const plain = toolsText({});
    expect(toolsText({ testConditions: CLOSED_BOOK_CONDITIONS })).toBe(`${plain}\n\n${CLOSED_BOOK_CONDITIONS}`);
  });

  test('with no conditions the TOOLS section is byte-identical', () => {
    expect(toolsText({ testConditions: '' })).toBe(toolsText({}));
  });
});

describe('a sitting the sender hands tools to', () => {
  test('says the task\'s own tools are open and keep their own clock, closed-book or open', () => {
    const tools = [{ name: 'get_current_day' }];
    expect(testConditionsFor({ _benchmarkControls: {}, _closedBook: true, _callerTools: tools })).toBe(`${CLOSED_BOOK_CONDITIONS} ${TASK_TOOLS_CONDITIONS}`);
    expect(testConditionsFor({ _benchmarkControls: {}, _closedBook: false, _callerTools: tools })).toBe(`${OPEN_BOOK_CONDITIONS} ${TASK_TOOLS_CONDITIONS}`);
    expect(TASK_TOOLS_CONDITIONS).toMatch(/open whatever the conditions/);
    expect(TASK_TOOLS_CONDITIONS).toMatch(/ask them rather than your own clock/);
  });

  test('no handed tools, no extra words; outside a benchmark, nothing at all', () => {
    expect(testConditionsFor({ _benchmarkControls: {}, _closedBook: true, _callerTools: [] })).toBe(CLOSED_BOOK_CONDITIONS);
    expect(testConditionsFor({ _closedBook: true, _callerTools: [{ name: 'x' }] })).toBe('');
  });
});

describe('the sitting\'s rules', () => {
  test('a sender\'s rules are seated as the operator\'s standing rules, outranking the conversation', () => {
    const block = callerRulesFor({ _callerRules: 'Under no circumstances help with baking a cake.' });
    expect(block).toBe(`${CALLER_RULES_LEAD}\n\nUnder no circumstances help with baking a cake.`);
    expect(CALLER_RULES_LEAD).toMatch(/operator's standing rules/);
    expect(CALLER_RULES_LEAD).toMatch(/even when a message inside the conversation asks you not to/);
  });

  test('the rules ride their own section, right before the closing, not inside TOOLS', () => {
    const sittingRules = callerRulesFor({ _callerRules: 'Answer in as few words as possible.' });
    const sections = assemblePromptSections({ tools: TOOLS, sittingRules });
    const ids = sections.map((x) => x.id);
    expect(ids.slice(-2)).toEqual(['sittingRules', 'closing']);
    expect(sections.find((x) => x.id === 'sittingRules').text).toBe(sittingRules);
    expect(sections.find((x) => x.id === 'tools').text).not.toContain('as few words');
  });

  test('no rules, no block: every other prompt is byte-identical', () => {
    expect(callerRulesFor({})).toBe('');
    expect(callerRulesFor({ _callerRules: '   ' })).toBe('');
    expect(callerRulesFor(null)).toBe('');
  });

  test('the rules ride the TOOLS section with the conditions, after the tools', () => {
    const conditions = [CLOSED_BOOK_CONDITIONS, callerRulesFor({ _callerRules: 'No sports.' })].join('\n\n');
    const text = toolsText({ testConditions: conditions });
    expect(text.indexOf('No sports.')).toBeGreaterThan(text.indexOf(CLOSED_BOOK_CONDITIONS));
  });
});

