// THE ONE ARGUMENT CHECK (backend/services/tool-args-check.js) — real schemas
// the model is shown (the fs primitives, the coding shell), real calls models
// have written, real outputs. RULE 0: nothing stands in for anything.
import { describe, expect, it } from 'vitest';
import { argsRefusalText, fitToolArgs } from '../../backend/services/tool-args-check.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/coding-tool-definitions.js';

const schemaOf = (tools, name) => tools.find((t) => t.name === name).inputSchema;
const EDIT = schemaOf(FS_PRIMITIVE_TOOLS, 'edit');
const READ = schemaOf(FS_PRIMITIVE_TOOLS, 'read');
const EXECUTE = schemaOf(WITNESS_CODING_TOOLS, 'execute');

describe('a call that fits runs exactly as written', () => {
  it('declared fields of the declared types pass through unchanged', () => {
    const args = { path: 'a.md', edits: [{ oldText: 'x', newText: 'y' }] };
    expect(fitToolArgs(EDIT, args)).toEqual({ args, problems: [] });
  });

  it('no schema, no properties, or arguments that are not an object: nothing to read against', () => {
    expect(fitToolArgs(undefined, { a: 1 })).toEqual({ args: { a: 1 }, problems: [] });
    expect(fitToolArgs({ type: 'object' }, { a: 1 })).toEqual({ args: { a: 1 }, problems: [] });
    expect(fitToolArgs(READ, 'a.md')).toEqual({ args: 'a.md', problems: [] });
  });
});

describe('what reads exactly is repaired, silently', () => {
  it('the same name in another spelling style, and the names other harnesses give it', () => {
    expect(fitToolArgs(EDIT, { file_path: 'a.md', edits: [{ old_string: 'x', new_string: 'y' }] }))
      .toEqual({ args: { path: 'a.md', edits: [{ oldText: 'x', newText: 'y' }] }, problems: [] });
    expect(fitToolArgs(EDIT, { path: 'a.md', edits: [{ old_text: 'x', NewText: 'y' }] }).args.edits).toEqual([{ oldText: 'x', newText: 'y' }]);
    expect(fitToolArgs(EXECUTE, { cmd: 'ls' })).toEqual({ args: { command: 'ls' }, problems: [] });
  });

  it('values in a type that reads exactly: numbers, booleans, a JSON-string list, one value for a list', () => {
    expect(fitToolArgs(EXECUTE, { command: 'ls', timeoutMs: '5000' }).args.timeoutMs).toBe(5000);
    expect(fitToolArgs(EDIT, { path: 'a', dryRun: 'TRUE', edits: '[{"oldText":"x","newText":"y"}]' }))
      .toEqual({ args: { path: 'a', dryRun: true, edits: [{ oldText: 'x', newText: 'y' }] }, problems: [] });
    expect(fitToolArgs(READ, { paths: 'a.md' }).args.paths).toEqual(['a.md']);
  });

  it('a null is a field left out', () => {
    expect(fitToolArgs(EXECUTE, { command: 'ls', timeoutMs: null })).toEqual({ args: { command: 'ls' }, problems: [] });
  });
});

describe('what does not fit is refused, with what to write instead', () => {
  it('the house agent\'s fs/edit {old, new} (2026-11-12) hears the right names, not "empty oldText"', () => {
    const { problems } = fitToolArgs(EDIT, { path: 'a.md', edits: [{ old: 'x', new: 'y' }] });
    expect(problems).toEqual([
      'edits[0].old is not a field — did you mean edits[0].oldText?',
      'edits[0].new is not a field — did you mean edits[0].newText?',
      'edits[] takes {oldText, newText}',
    ]);
  });

  it('a required field missing is named; a wrong type that does not read is said', () => {
    expect(fitToolArgs(EXECUTE, {}).problems).toEqual(['command is required']);
    expect(fitToolArgs(EXECUTE, { command: 'ls', timeoutMs: 'soon' }).problems).toEqual(['timeoutMs must be number, not string']);
    expect(fitToolArgs(EDIT, { path: 'a', edits: [{ oldText: 'x' }] }).problems).toEqual(['edits[0].newText is required', 'edits[] takes {oldText, newText}']);
  });

  it('an integer field refuses a fraction; an enum names its choices and forgives case', () => {
    const schema = { type: 'object', properties: { n: { type: 'integer' }, mode: { type: 'string', enum: ['ask', 'auto'] } } };
    expect(fitToolArgs(schema, { n: 1.5 }).problems).toEqual(['n must be integer, not number']);
    expect(fitToolArgs(schema, { mode: 'AUTO' }).args.mode).toBe('auto');
    expect(fitToolArgs(schema, { mode: 'yolo' }).problems).toEqual(['mode must be one of "ask", "auto"']);
  });

  it('an extra field passes on an open schema and is refused on a closed one', () => {
    const open = { type: 'object', properties: { query: { type: 'string' } } };
    const closed = { ...open, additionalProperties: false };
    expect(fitToolArgs(open, { query: 'q', reason: 'why' })).toEqual({ args: { query: 'q', reason: 'why' }, problems: [] });
    expect(fitToolArgs(closed, { query: 'q', reason: 'why' }).problems).toEqual(['reason is not a field']);
  });

  it('the refusal carries every problem and the whole signature, so one reply is enough', () => {
    const text = argsRefusalText('fs/edit', EDIT, fitToolArgs(EDIT, { path: 'a.md', edits: [{ old: 'x', new: 'y' }] }).problems);
    expect(text).toMatch(/^fs\/edit did not run — its arguments do not fit: edits\[0\]\.old is not a field — did you mean edits\[0\]\.oldText\?/);
    expect(text).toContain('fs/edit takes {path?, edits?');
  });
});
