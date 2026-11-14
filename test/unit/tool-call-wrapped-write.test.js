/**
 * A WRITE THROUGH THE CALL DOOR SURVIVES ITS OWN QUOTES (2026-11-04) — pure,
 * called with real inputs (RULE 0).
 *
 * The CLO wrote a whole legal review through system/call as text, and the
 * document's quotation marks ("contract as payor") were not escaped. The JSON
 * broke; the relaxed fallback lifted `To` out of the review's "**To:**" line;
 * the door then named no tool and answered […] — the review
 * was lost. A bare {"path", "content"} write had been salvaged since #272;
 * the same write inside the door (or inside Hermes' wrapper) now is too, and
 * what still cannot be read is TOLD to the model, never guessed or dropped.
 */
import { describe, test, expect } from 'vitest';
import { parseToolCalls, tryParseArgs } from '../../core/runtime/tool-call-parser.js';
import { unwrapCalls, doorRefusal } from '../../backend/services/tool-hud.js';
import { decodeToolCallDeltas } from '../../backend/services/llm-provider.js';

// What a legal review looks like: a To line, quoted terms, a section sign, a fenced block.
const DOC = '# Affiliate Program — Legal Review\n\n**To:** Growth\n\nThe "contract as payor" model keeps the LLC "not the payor"; see 26 U.S.C. § 3406.\n```json\n{"a": "b"}\n```\nEnds "quoted"';
const DOOR = `{"tool": "fs/write", "args": {"path": "/house/review.md", "content": "${DOC}"}}`;
// The being's turn loop reads text calls this way (portal-tool-loop.js _roundActs).
const written = (text) => unwrapCalls(parseToolCalls(text, { told: true }));

describe('the door\'s write, its quotes unescaped, reaches fs/write verbatim', () => {
  test('[TOOL: system/call …] — the live failure', () => {
    const [call] = written(`Writing the document now.\n[TOOL: system/call ${DOOR}]\nIt is written.`);
    expect(call).toMatchObject({ server: 'fs', toolName: 'write', tool: 'fs/write' });
    expect(call.args).toEqual({ path: '/house/review.md', content: DOC });
    expect(call.args.To).toBeUndefined();
  });

  test('Hermes <tool_call>{"name": "system/call", "arguments": …} — heard, never dropped', () => {
    const [call] = written(`<tool_call>{"name": "system/call", "arguments": ${DOOR}}</tool_call>\nWritten.`);
    expect(call.tool).toBe('fs/write');
    expect(call.args).toEqual({ path: '/house/review.md', content: DOC });
  });

  test('Qwen XML as text — the door\'s args a string, read with the same repairs', () => {
    const inner = `{"path": "/house/review.md", "content": "${DOC}"}`;
    const [call] = written(`<tool_call>\n<function=system__call>\n<parameter=tool>\nfs/write\n</parameter>\n<parameter=args>\n${inner}\n</parameter>\n</function>\n</tool_call>`);
    expect(call.tool).toBe('fs/write');
    expect(call.args).toEqual({ path: '/house/review.md', content: DOC });
  });

  test('well-formed door JSON is untouched by any salvage', () => {
    const clean = JSON.stringify({ tool: 'fs/write', args: { path: 'a.md', content: DOC } });
    expect(tryParseArgs(clean)).toEqual({ tool: 'fs/write', args: { path: 'a.md', content: DOC } });
  });
});

describe('what cannot be read is told, never guessed or dropped', () => {
  // Content before path breaks the taught shape: no salvage may promise this one.
  const UNSHAPED = `{"tool": "fs/write", "args": {"content": "${DOC}", "path": "/house/review.md"}}`;

  test('the door with unreadable JSON is refused as unreadable — never {To: …}, never "No tool named call"', () => {
    const [call] = written(`[TOOL: system/call ${UNSHAPED}]`);
    expect(call.tool).toBe('system/call');
    expect(call.args.To).toBeUndefined();
    const refusal = doorRefusal(call);
    expect(refusal).toMatchObject({ status: 'invalid' });
    expect(refusal.error).toMatch(/were not a JSON object, so nothing ran/);
    expect(refusal.error).toContain('every quotation mark written \\"');
  });

  test('a Hermes call whose body will not read is still a call, by its name', () => {
    const [call] = parseToolCalls(`<tool_call>{"name": "system/call", "arguments": ${UNSHAPED}}</tool_call>`, { told: true });
    expect(call).toMatchObject({ server: 'system', toolName: 'call' });
    expect(call._argsError).toBeDefined();
  });

  test('malformed and unclosed [TOOL: …] are told calls in the turn loop', () => {
    expect(parseToolCalls('[TOOL: filesystem/read_file {not json}]', { told: true }))
      .toEqual([expect.objectContaining({ tool: 'filesystem/read_file', args: {}, _argsError: '{not json}' })]);
    expect(parseToolCalls('[TOOL: filesystem/read_file {"path": "x"', { told: true }))
      .toEqual([expect.objectContaining({ tool: 'filesystem/read_file', args: {}, _argsError: '{"path": "x"' })]);
  });

  test('every other reader (the birth stages, the flight check) never hears an unreadable call as an act', () => {
    expect(parseToolCalls(`[TOOL: system/call ${UNSHAPED}]`)).toEqual([]);
    expect(parseToolCalls(`<tool_call>{"name": "system/call", "arguments": ${UNSHAPED}}</tool_call>`)).toEqual([]);
  });

  test('quoted-key JSON that will not read yields nothing — the relaxed reader is for unquoted keys only', () => {
    expect(tryParseArgs('{"path": "a.md", "note": "**To:** x "y" z"')).toBeNull();
    expect(tryParseArgs('{path: notes/a.md}')).toEqual({ path: 'notes/a.md' });
  });

  test('a native call\'s unreadable arguments ride as _argsError, not junk keys', () => {
    const [call] = decodeToolCallDeltas({ 0: { id: 'c1', name: 'system__call', args: UNSHAPED } });
    expect(call.args).toEqual({});
    expect(call._argsError).toBeDefined();
  });
});
