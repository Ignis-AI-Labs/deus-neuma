/**
 * THE TEST CONDITIONS (ruling, 2026-10-20): a benchmark sitting states up front
 * whether it is closed-book or open-book, with the tools it governs; every
 * other prompt stays byte-identical.
 */
import { describe, expect, test } from 'vitest';
import { CLOSED_BOOK_CONDITIONS, OPEN_BOOK_CONDITIONS, testConditionsFor } from '../../backend/services/test-conditions.js';
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
