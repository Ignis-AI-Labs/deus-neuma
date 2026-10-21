// THE TOOL HUD's doors (backend/services/tool-hud.js): a call through
// system/call becomes the call it names — and the transcript keeps what the
// model sent. Real inputs, real outputs; the echo through the real exchange.
import { describe, expect, it } from 'vitest';
import { CALL_TOOL, contractsOf, doorRefusal, unknownToolHint, unreadArgsResult, unwrapCall, unwrapCalls } from '../../backend/services/tool-hud.js';
import { signatureOf, toolLine } from '../../core/runtime/tool-signature.js';
import { nativeToolExchange } from '../../backend/services/tool-exchange.js';

const door = (args, extra = {}) => ({ server: 'system', toolName: 'call', tool: 'system/call', args, callId: 'c1', _native: true, ...extra });

describe('system/call — the door becomes the call it names', () => {
  it('nested args', () => {
    const named = unwrapCall(door({ tool: 'fs/read', args: { path: 'a.md' } }));
    expect(named).toMatchObject({ server: 'fs', toolName: 'read', tool: 'fs/read', args: { path: 'a.md' }, callId: 'c1', _native: true });
    expect(named._wire).toEqual({ server: 'system', toolName: 'call', args: { tool: 'fs/read', args: { path: 'a.md' } } });
  });

  it('a model that flattens the args beside `tool` is understood', () => {
    expect(unwrapCall(door({ tool: 'web/web_search', query: 'neuma' }))).toMatchObject({ tool: 'web/web_search', args: { query: 'neuma' } });
  });

  it('the door named the native way (system__call) or in text is the same door', () => {
    expect(unwrapCall({ server: null, toolName: 'system__call', args: { tool: 'fs/list', args: {} } }).tool).toBe('fs/list');
    expect(unwrapCall({ tool: 'system/call', args: { tool: '/fs/write', args: { path: 'x', content: 'y' } } }).tool).toBe('fs/write');
  });

  it('the door naming the door is refused in every spelling, and a second unwrap cannot peel it (audit C1)', () => {
    for (const inner of ['system/call', 'call', 'system__call', '/system/call']) {
      const once = unwrapCall(door({ tool: inner, args: { tool: 'platform/platform_data', args: {} } }));
      expect(once).toMatchObject({ server: 'system', toolName: 'call', tool: 'system/call' });
      const twice = unwrapCall(once);
      expect(twice.tool).toBe('system/call');
      expect(doorRefusal(twice)).toMatchObject({ tool: 'system/call', status: 'invalid' });
    }
    expect(doorRefusal(unwrapCall(door({ tool: 'fs/read', args: { path: 'a' } })))).toBeNull();
    expect(doorRefusal(unwrapCall(door('{not json')))).toMatchObject({ status: 'invalid' });
  });

  it('every other call is left exactly as it came; a door naming nothing stays the door, labeled as one', () => {
    const plain = { server: 'fs', toolName: 'read', tool: 'fs/read', args: { path: 'a' } };
    expect(unwrapCall(plain)).toBe(plain);
    expect(unwrapCall(door({ args: {} }))).toMatchObject({ server: 'system', toolName: 'call', tool: 'system/call' });
    // a bare `call` naming nothing reads as the platform door, never an unknown server
    // (BigCodeBench 2026-10-15: the closed-book audit refused a trail entry labeled `call`)
    expect(unwrapCall({ toolName: 'call', args: {} })).toMatchObject({ server: 'system', tool: 'system/call' });
    expect(unwrapCalls([plain])).toEqual([plain]);
  });

  it('the door as models really send it: a bare `call`, arguments as JSON strings, the name under another key', () => {
    expect(unwrapCall({ toolName: 'call', args: { tool: 'coding/execute', args: { command: 'ls' } } }))
      .toMatchObject({ server: 'coding', toolName: 'execute', args: { command: 'ls' } });
    expect(unwrapCall(door('{"tool": "fs/read", "args": "{\\"path\\": \\"a.md\\"}"}')))
      .toMatchObject({ server: 'fs', toolName: 'read', args: { path: 'a.md' } });
    expect(unwrapCall(door({ name: 'fs/list', args: { path: '.' } }))).toMatchObject({ tool: 'fs/list', args: { path: '.' } });
  });

  it('the transcript echoes the call AS SENT — the model reads back its own door call', () => {
    const named = unwrapCall(door({ tool: 'fs/read', args: { path: 'a.md' } }));
    const [assistant, tool] = nativeToolExchange({
      response: null, calls: [named], results: [{ tool: 'fs/read', status: 'ok', content: 'hello' }],
      callId: (i) => `x${i}`, formatResult: (r) => r.content, followUp: 'go on',
    });
    expect(assistant.tool_calls[0].function).toEqual({ name: 'system__call', arguments: JSON.stringify({ tool: 'fs/read', args: { path: 'a.md' } }) });
    expect(tool).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'hello' });
  });
});

describe('what the HUD and the search say of a tool', () => {
  const read = { server: 'fs', name: 'read', description: 'Read a file.', access: 'allowed',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'integer' } }, required: ['path'] } };

  it('a signature names every argument, the optional ones marked', () => {
    expect(signatureOf(read.inputSchema)).toBe('{path, limit?}');
    expect(signatureOf(null)).toBe('{}');
    expect(toolLine(read)).toBe('fs/read {path, limit?}');
  });

  it('an exact search answers with the full arguments; a broad one with the signature', () => {
    expect(contractsOf([read], true)[0]).toMatchObject({ id: 'fs/read', args: read.inputSchema, access: 'allowed' });
    expect(contractsOf([read], false)[0]).toMatchObject({ id: 'fs/read', signature: '{path, limit?}' });
    expect(contractsOf([read], false)[0].call).toBe('system/call {"tool": "fs/read", "args": {…}}');
  });

  it('the door itself takes a tool id and its args', () => {
    expect(CALL_TOOL.inputSchema.required).toEqual(['tool']);
  });
});

describe('a tool the model does not have is answered with the way to the right one', () => {
  const catalog = [{ server: 'coding', name: 'execute' }, { server: 'fs', name: 'read' }, { server: 'fs', name: 'write' }, { server: 'system', name: 'tool_search' }];
  it('the same name under its real server', () => {
    expect(unknownToolHint('read', catalog)).toContain('Did you mean fs/read?');
  });
  it('the closest name it holds (BigCodeBench: coding/run, three times)', () => {
    expect(unknownToolHint('exec', catalog)).toContain('Did you mean coding/execute?');
    expect(unknownToolHint('writ', catalog)).toContain('Did you mean fs/write?');
  });
  it('a wrong name in a real family lists that family (coding/run → coding/ holds: execute)', () => {
    expect(unknownToolHint('run', catalog, 'coding')).toContain('coding/ holds: execute.');
  });
  it('an intent called as a tool is named as the intent it is, with how to file it (2026-10-17 flight: "dispatch")', () => {
    const intents = [{ name: 'staff/dispatch', fieldsForPrompt: '{to, title, body}', descriptionForPrompt: 'Charge a member.' }];
    for (const hint of [unknownToolHint('dispatch', catalog, null, intents), unknownToolHint('dispatch', catalog, 'staff', intents)]) {
      expect(hint).toContain('staff/dispatch is not a tool — it is an intent you FILE');
      expect(hint).toContain('{"type": "staff/dispatch"} and its fields {to, title, body}');
    }
    expect(unknownToolHint('dispatch', catalog)).toContain('No tool named dispatch.');
  });
  it('always the door that finds tools; nothing invented when nothing is close', () => {
    const hint = unknownToolHint('launch_rocket', catalog);
    expect(hint).not.toContain('Did you mean');
    expect(hint).toContain('system/tool_search');
  });
});

describe('the door, spelled as models spell it, and arguments that will not read', () => {
  it('system.call, system-call, system:call, system_call are all the door', () => {
    for (const name of ['system.call', 'system-call', 'system:call', 'system_call']) {
      expect(unwrapCall({ server: null, toolName: name, args: { tool: 'fs/read', args: { path: 'a' } } }))
        .toMatchObject({ server: 'fs', toolName: 'read', args: { path: 'a' } });
    }
  });
  it('arguments that are not a JSON object are flagged — told to the model, never run on {}', () => {
    expect(unwrapCall(door('{not json'))).toMatchObject({ tool: 'system/call', _argsError: '{not json' });
    expect(unwrapCall(door({ tool: 'fs/read', args: '{path: a.md' }))).toMatchObject({ tool: 'fs/read', _argsError: '{path: a.md' });
    expect(unreadArgsResult('fs/read', '{path: a.md')).toMatchObject({ status: 'invalid' }); // nothing ran — not 'error'
    expect(unreadArgsResult('fs/read', '{path: a.md').error).toContain('Send the call again');
  });
});
