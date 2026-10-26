/**
 * THE TEST CONDITIONS (ruling, 2026-10-20): a benchmark sitting states up front
 * whether it is closed-book or open-book, with the tools it governs; every
 * other prompt stays byte-identical.
 */
import { describe, expect, test } from 'vitest';
import { CLOSED_BOOK_CONDITIONS, OPEN_BOOK_CONDITIONS, TASK_TOOLS_CONDITIONS, testConditionsFor } from '../../backend/services/test-conditions.js';
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
