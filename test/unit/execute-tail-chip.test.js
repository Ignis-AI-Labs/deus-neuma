/**
 * Live coding/execute tail paints ONE chip, then settles. The frozen
 * stream-reducer suite stays shrink-only; this contract lives here.
 */
import { describe, expect, test } from 'vitest';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const run = (actions) => actions.reduce(reducer, initialState);
const toolsOf = (state) => state.messages.find((m) => m.streaming)?.segments.filter((s) => s.kind === 'tool') || [];

describe('coding/execute live tail', () => {
  test('executing detail updates the SAME chip, then settles', () => {
    const tools = toolsOf(run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'coding/execute', status: 'executing', summary: 'npm test', detail: 'stdout:\nRUNS' } },
      { type: 'TOOL_RESULT', data: { tool: 'coding/execute', status: 'executing', summary: 'npm test', detail: 'stdout:\nRUNS\nPASS' } },
      { type: 'TOOL_RESULT', data: { tool: 'coding/execute', status: 'ok', summary: 'execute — exit 0', detail: 'exit_code: 0\nstdout:\nRUNS\nPASS' } },
    ]));
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: 'ok', label: 'coding/execute' });
    expect(tools[0].detail).toContain('PASS');
  });
});
