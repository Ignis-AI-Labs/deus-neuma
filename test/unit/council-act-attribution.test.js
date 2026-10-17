/** Pure display-model proof; these action sequences do not claim live wire ordering. */
import { expect, test } from 'vitest';
import { initialState, reducer } from '../../frontend/app/RelinkShell/council-reducer.js';

const act = (type, fields = {}) => ({ type, neumaId: 'alpha', turnId: 'turn-1', ...fields });
const run = (actions, start = initialState) => actions.reduce(reducer, start);
const chips = (state, index = 0) => state.messages[index].segments.filter((s) => s.kind === 'tool');

for (const [firstPath, secondPath] of [['', ''], ['', '/b'], ['/a', ''], ['/a', '/b']]) {
  test(`announcements retain both names and targets: ${firstPath || 'pathless'} then ${secondPath || 'pathless'}`, () => {
    const state = run([
      act('TOOL_OPEN'), act('TOOL_LABEL', { label: 'first' }),
      act('TOOL_OPEN'), act('TOOL_LABEL', { label: 'second' }),
      act('TOOL_ACTING', { tool: 'first', path: firstPath }),
      act('TOOL_ACTING', { tool: 'second', path: secondPath }),
    ]);
    expect(chips(state).map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'first', path: firstPath }, { label: 'second', path: secondPath },
    ]);
    const settled = run([
      act('TOOL_RESULT', { tool: 'first', path: firstPath, ok: true }),
      act('TOOL_RESULT', { tool: 'second', path: secondPath, ok: false, error: 'denied' }),
    ], state);
    expect(chips(settled).map(({ label, ok }) => ({ label, ok }))).toEqual([
      { label: 'first', ok: true }, { label: 'second', ok: false },
    ]);
  });
}

test('native path-less announcements mint separate chips without text blocks', () => {
  const state = run([act('TOOL_ACTING', { tool: 'first' }), act('TOOL_ACTING', { tool: 'second' })]);
  expect(chips(state).map((s) => s.label)).toEqual(['first', 'second']);
});

test('a late result corrects the corresponding provisional chip without reopening speech', () => {
  const settled = run([
    act('SPEECH', { content: 'Original.' }),
    act('TOOL_ACTING', { tool: 'first', path: '/a' }),
    act('TOOL_ACTING', { tool: 'second', path: '/b' }),
    act('SPOKE'),
  ]);
  const corrected = reducer(settled, act('TOOL_RESULT', { tool: 'second', path: '/b', ok: true }));
  expect(corrected.messages[0].live).toBe(false);
  expect(chips(corrected)).toHaveLength(2);
  expect(chips(corrected)[0]).toMatchObject({ label: 'first', ok: false, error: 'did not run' });
  expect(chips(corrected)[1]).toMatchObject({ label: 'second', ok: true, error: '' });
  expect(reducer(corrected, act('SPEECH', { content: 'Late words.' }))).toBe(corrected);
  expect(reducer(corrected, act('TOOL_ACTING', { tool: 'third' }))).toBe(corrected);
});

test('a late result can name an anonymous block, or append after missed acting frames', () => {
  const anonymous = run([act('TOOL_OPEN'), act('SPOKE'), act('TOOL_RESULT', { tool: 'write_file', ok: true })]);
  expect(chips(anonymous)).toHaveLength(1);
  expect(chips(anonymous)[0]).toMatchObject({ label: 'write_file', ok: true });
  const missed = run([act('SPEECH', { content: 'Finished.' }), act('SPOKE'), act('TOOL_RESULT', { tool: 'read_file', ok: true })]);
  expect(chips(missed)).toHaveLength(1);
  expect(missed.messages[0].live).toBe(false);
});

test('late results preserve completed failures and other speakers or turns', () => {
  const settled = run([
    act('TOOL_RESULT', { tool: 'first', ok: false, error: 'did not run' }),
    act('TOOL_ACTING', { tool: 'second' }), act('SPOKE'),
    act('TOOL_ACTING', { neumaId: 'beta', tool: 'second' }),
    act('TOOL_ACTING', { turnId: 'turn-2', tool: 'second' }),
  ]);
  const corrected = reducer(settled, act('TOOL_RESULT', { tool: 'second', ok: true }));
  expect(chips(corrected)[0]).toEqual(chips(settled)[0]);
  expect(chips(corrected)[1]).toMatchObject({ label: 'second', ok: true });
  expect(corrected.messages[1]).toBe(settled.messages[1]);
  expect(corrected.messages[2]).toBe(settled.messages[2]);
});
