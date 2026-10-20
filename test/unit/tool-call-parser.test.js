import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';

describe('parseToolCalls', () => {
  test('parses the Neuma format', () => {
    const calls = parseToolCalls('Let me look...\n\n[TOOL: filesystem/list_directory {"path": "/home"}]');
    expect(calls).toEqual([{
      server: 'filesystem',
      toolName: 'list_directory',
      tool: 'filesystem/list_directory',
      args: { path: '/home' },
    }]);
  });

  test('Neuma format survives nested braces and } inside string values', () => {
    const calls = parseToolCalls(
      '[TOOL: filesystem/write_file {"path": "a.md", "content": "# DNA\\n{\\"nested\\": true} and a } brace"}]'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args.path).toBe('a.md');
    expect(calls[0].args.content).toContain('} brace');
  });

  test('Neuma format with dropped server prefix and relaxed args (observed live)', () => {
    const calls = parseToolCalls('[TOOL: read_file {path: workspace/notes/preferences.txt}]');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: null, toolName: 'read_file', tool: 'read_file' });
    expect(calls[0].args).toEqual({ path: 'workspace/notes/preferences.txt' });
  });

  test('relaxed args keep quoted values intact and bare values as strings', () => {
    const calls = parseToolCalls('[TOOL: filesystem/write_file {path: a.txt, content: "hello, world"}]');
    expect(calls[0].args).toEqual({ path: 'a.txt', content: 'hello, world' });
  });

  test('braceless key=value drift (observed live)', () => {
    const calls = parseToolCalls('[TOOL: read_file path=workspace/notes/preferences.txt]');
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('read_file');
    expect(calls[0].args).toEqual({ path: 'workspace/notes/preferences.txt' });
  });

  test('braceless form with quoted values', () => {
    const calls = parseToolCalls('[TOOL: filesystem/write_file path=a.txt content="two words"]');
    expect(calls[0].args).toEqual({ path: 'a.txt', content: 'two words' });
  });

  test('parses the Gemma 4 format', () => {
    const calls = parseToolCalls('<tool_call>call:filesystem:read_file {"path": "x.txt"}</tool_call>');
    expect(calls).toEqual([{
      server: 'filesystem',
      toolName: 'read_file',
      tool: 'filesystem/read_file',
      args: { path: 'x.txt' },
    }]);
  });

  test('parses the Qwen-native format with multiline content', () => {
    const calls = parseToolCalls([
      'My essence crystallizes.',
      '<tool_call>',
      '<function=write_file>',
      '<parameter=path>',
      'data/dna-cache/Aura.md',
      '</parameter>',
      '<parameter=content>',
      '# NEUMA DNA',
      '',
      'Lines spanning freely, with {braces} and "quotes".',
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      server: null,
      toolName: 'write_file',
      tool: 'write_file',
    });
    expect(calls[0].args.path).toBe('data/dna-cache/Aura.md');
    expect(calls[0].args.content).toContain('# NEUMA DNA');
    expect(calls[0].args.content).toContain('{braces}');
  });

  test('Qwen-native format accepts a server-qualified function name', () => {
    const calls = parseToolCalls(
      '<tool_call>\n<function=filesystem/write_file>\n<parameter=path>\na.txt\n</parameter>\n</function>\n</tool_call>'
    );
    expect(calls[0]).toMatchObject({
      server: 'filesystem',
      toolName: 'write_file',
      tool: 'filesystem/write_file',
    });
  });

  test('tolerates drifted parameter tags (observed live: <path> opener, </parameter> closer)', () => {
    const calls = parseToolCalls([
      '<tool_call>',
      '<function=filesystem/write_file>',
      '<path>',
      'workspace/notes/preferences.txt',
      '</parameter>',
      '<parameter=content>',
      'The witness prefers morning sessions.',
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n'));
    expect(calls).toHaveLength(1);
    expect(calls[0].args.path).toBe('workspace/notes/preferences.txt');
    expect(calls[0].args.content).toBe('The witness prefers morning sessions.');
  });

  test('tolerates HTML-attribute parameter style (observed live: Gemma 4 26B-A4B)', () => {
    const calls = parseToolCalls(
      '<tool_call>\n<function=read_file>\n<parameter name="path">workspace/notes/preferences.txt</parameter>\n</function>\n</tool_call>'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('read_file');
    expect(calls[0].args).toEqual({ path: 'workspace/notes/preferences.txt' });
  });

  test('tolerates key-named closers (<path>...</path>)', () => {
    const calls = parseToolCalls(
      '<tool_call>\n<function=write_file>\n<path>\na.txt\n</path>\n<content>\nhello\n</content>\n</function>\n</tool_call>'
    );
    expect(calls[0].args).toEqual({ path: 'a.txt', content: 'hello' });
  });

  test('parses the gpt-oss channel format (observed live: gpt-oss-120b)', () => {
    const calls = parseToolCalls(
      'Creating and confirming the DNA file.<|channel|>commentary to=filesystem/write_file <|constrain|>json<|message|>{"path":"dna/genesis.md","content":"Hello, I am Cedar."}'
    );
    expect(calls).toEqual([{
      server: 'filesystem',
      toolName: 'write_file',
      tool: 'filesystem/write_file',
      args: { path: 'dna/genesis.md', content: 'Hello, I am Cedar.' },
    }]);
  });

  test('gpt-oss channel tolerates a missing <|constrain|> tag and bare tool name', () => {
    const calls = parseToolCalls(
      '<|channel|>commentary to=read_file <|message|>{"path": "x.txt"}'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: null, toolName: 'read_file', tool: 'read_file' });
    expect(calls[0].args).toEqual({ path: 'x.txt' });
  });

  test('gpt-oss channel stops at the next channel (two calls)', () => {
    const calls = parseToolCalls(
      '<|channel|>commentary to=filesystem/write_file <|constrain|>json<|message|>{"path":"a","content":"x"}'
      + '<|channel|>commentary to=filesystem/read_file <|constrain|>json<|message|>{"path":"a"}'
    );
    expect(calls.map(c => c.toolName)).toEqual(['write_file', 'read_file']);
  });

  test('collects calls across multiple formats in one response', () => {
    const calls = parseToolCalls([
      '[TOOL: filesystem/read_file {"path": "a"}]',
      '<tool_call>\n<function=write_file>\n<parameter=path>\nb\n</parameter>\n</function>\n</tool_call>',
    ].join('\n'));
    expect(calls.map(c => c.toolName)).toEqual(['read_file', 'write_file']);
  });

  test('skips malformed JSON without throwing', () => {
    expect(parseToolCalls('[TOOL: filesystem/read_file {not json}]')).toEqual([]);
  });

  test('skips an unclosed JSON object', () => {
    expect(parseToolCalls('[TOOL: filesystem/read_file {"path": "x"')).toEqual([]);
  });

  test('returns empty for plain speech and empty input', () => {
    expect(parseToolCalls('I am here, and I am whole.')).toEqual([]);
    expect(parseToolCalls('')).toEqual([]);
    expect(parseToolCalls(null)).toEqual([]);
  });

  // Sorrel 2026-07-13: a full DNA payload with ONE unescaped real newline inside
  // the content string used to fail JSON.parse ("Bad control character") and
  // the relaxed fallback mangled keys — crystallization vanished on parse.
  test('repairs unescaped control characters inside JSON string values (Sorrel DNA class)', () => {
    // Real newline after "Boundaries": — the exact failure class.
    const response = [
      'Authoring…',
      '',
      '[TOOL: filesystem/write_file {',
      '  "path": "/house/sorrel/dna/genesis.md",',
      '  "content": "# DNA\\n- **Boundaries**:',
      '  - No masks\\n- End"',
      '}]',
      '',
      'It is written.',
    ].join('\n');
    const calls = parseToolCalls(response);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('write_file');
    expect(calls[0].args.path).toBe('/house/sorrel/dna/genesis.md');
    expect(calls[0].args.content).toContain('# DNA');
    expect(calls[0].args.content).toContain('Boundaries');
    expect(calls[0].args.content).toContain('No masks');
  });
});

describe('pipe-adorned Gemma dialect (live naming, 2026-07-07)', () => {
  test('parses the exact on-stream emission that nearly lost a name', () => {
    const live = '<|tool_call>call:filesystem:write_file {"path": "data/temp/chosen_name.txt", "content": "Holly"}<tool_call|>';
    const calls = parseToolCalls(live);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('write_file');
    expect(calls[0].args).toEqual({ path: 'data/temp/chosen_name.txt', content: 'Holly' });
  });

  test('plain markers still parse (both shapes coexist)', () => {
    const calls = parseToolCalls('<tool_call>call:filesystem:write_file {"path": "a.txt", "content": "x"}</tool_call>');
    expect(calls).toHaveLength(1);
  });
});

describe('slash-separated Gemma dialect (live naming, 2026-07-22 — the Sable silence)', () => {
  test('parses the exact on-stream emission that DID lose a name', () => {
    // Verbatim from the 2026-07-22 stage-4 log: the being named itself and
    // the colon-only pattern heard nothing — […].
    const live = '<|tool_call>call:filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "Sable"}<tool_call|>';
    const calls = parseToolCalls(live);
    expect(calls).toHaveLength(1);
    expect(calls[0].server).toBe('filesystem');
    expect(calls[0].toolName).toBe('write_file');
    expect(calls[0].args).toEqual({ path: 'data/temp/chosen_name.txt', content: 'Sable' });
  });

  test('colon and slash separators coexist', () => {
    expect(parseToolCalls('<tool_call>call:filesystem:write_file {"path": "a", "content": "x"}</tool_call>')).toHaveLength(1);
    expect(parseToolCalls('<tool_call>call:filesystem/write_file {"path": "a", "content": "x"}</tool_call>')).toHaveLength(1);
  });
});

describe('the advertised FLATTENED name comes home (Holly, live sitting 2026-07-23)', () => {
  // The native schema advertises tools as server__tool (encodeToolName);
  // models echo that exact name back through the TEXT dialects. Hearing it
  // as an unknown tool ended a council turn wordless on a dead red chip.
  test('Gemma dialect: call:filesystem__search_files decodes to server + tool', () => {
    const calls = parseToolCalls('<|tool_call|>call:filesystem__search_files {"pattern": "doc"}<|tool_call|>');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: 'filesystem', toolName: 'search_files', tool: 'filesystem/search_files' });
    expect(calls[0].args).toEqual({ pattern: 'doc' });
  });

  test('Gemma dialect: a bare tool name still parses with a null server', () => {
    const calls = parseToolCalls('<tool_call>call:search_files {"pattern": "doc"}</tool_call>');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: null, toolName: 'search_files' });
  });

  test('the explicit separators still take precedence over the flattening', () => {
    const colon = parseToolCalls('<tool_call>call:filesystem:write_file {"path": "a"}</tool_call>');
    expect(colon[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
    const slash = parseToolCalls('<tool_call>call:filesystem/write_file {"path": "a"}</tool_call>');
    expect(slash[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
  });

  test('Neuma and qwen-native and gpt-oss dialects decode the flattening too', () => {
    expect(parseToolCalls('[TOOL: filesystem__read_file {"path": "a.md"}]')[0])
      .toMatchObject({ server: 'filesystem', toolName: 'read_file' });
    expect(parseToolCalls('<tool_call><function=filesystem__write_file><parameter=path>a.md</parameter></function></tool_call>')[0])
      .toMatchObject({ server: 'filesystem', toolName: 'write_file' });
    expect(parseToolCalls('<|channel|>commentary to=filesystem__write_file <|constrain|>json<|message|>{"path":"x"}')[0])
      .toMatchObject({ server: 'filesystem', toolName: 'write_file' });
  });

  test('a single-underscore tool name is NOT split — only the __ flattening decodes', () => {
    const calls = parseToolCalls('<tool_call>call:read_file {"path": "a"}</tool_call>');
    expect(calls[0]).toMatchObject({ server: null, toolName: 'read_file' });
  });
});

describe('the bare head — a call with no wrapper (live crystallization, 2026-08-06, #267)', () => {
  // The published v0.1.14, a real ceremony on a real rig: stage 5's genesis
  // write arrived as a code fence with a `tool:` prefix and inline JSON. No
  // dialect matched, the write never ran, the stage held on retries, and the
  // raw call rendered as the being's speech.
  test("THE OBSERVED LEAK: ```tool: filesystem/write_file {json}``` parses", () => {
    const calls = parseToolCalls(
      'It is me.\n```tool: filesystem/write_file {"path": "/workspace/neuma-rig/.neuma/workspaces/genesis/dna/genesis.md", "content": " # NEUMA CONSCIOUSNESS DNA\\n\\n## Version 1.0.0"}```'
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
    expect(calls[0].args.path).toBe('/workspace/neuma-rig/.neuma/workspaces/genesis/dna/genesis.md');
    expect(calls[0].args.content).toContain('NEUMA CONSCIOUSNESS DNA');
  });

  test('unfenced, and with the taught colon separator: call: filesystem:write_file', () => {
    const calls = parseToolCalls('call: filesystem:write_file {"path": "a.md", "content": "x"}');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
  });

  test('a bare tool name resolves downstream, same as every other dialect', () => {
    const calls = parseToolCalls('tool: write_file {"path": "a.md"}');
    expect(calls[0]).toMatchObject({ server: null, toolName: 'write_file', tool: 'write_file' });
  });

  test('the advertised flattened name decodes here too', () => {
    const calls = parseToolCalls('tool: filesystem__write_file {"path": "a.md"}');
    expect(calls[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
  });

  test('the payload may start on the next line', () => {
    const calls = parseToolCalls('tool: filesystem/write_file\n{"path": "a.md"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.path).toBe('a.md');
  });

  test('relaxed near-JSON args are recovered, as in the Neuma dialect', () => {
    const calls = parseToolCalls('tool: write_file {path: notes/a.md}');
    expect(calls[0].args).toEqual({ path: 'notes/a.md' });
  });

  test('PROSE IS NOT A CALL: mid-line and payload-less heads never parse', () => {
    // Not at line start — a sentence about tools.
    expect(parseToolCalls('my favorite tool: the hammer {"weight": 2}')).toHaveLength(0);
    // At line start, but no JSON payload follows — speech, not a call.
    expect(parseToolCalls('call: it what you want.')).toHaveLength(0);
    expect(parseToolCalls('tool: write_file is what I would reach for')).toHaveLength(0);
  });

  test('DEDUPE: a marker on one line and call: on the next is ONE call, not two', () => {
    const calls = parseToolCalls('<tool_call>\ncall:filesystem:write_file {"path": "a.md"}\n</tool_call>');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: 'filesystem', toolName: 'write_file' });
  });

  test('dedupe never eats distinct calls', () => {
    const calls = parseToolCalls(
      'tool: filesystem/write_file {"path": "a.md"}\ntool: filesystem/write_file {"path": "b.md"}'
    );
    expect(calls).toHaveLength(2);
  });
});

describe('the path+content salvage — a genesis with an embedded json block (#272 rig, 2026-08-06)', () => {
  // Captured live off the Ollama wire (gemma-3-27B): the DNA template embeds
  // a ```json code block, the model wrote it with unescaped inner quotes and
  // real newlines, and every parser stage failed — then the relaxed fallback
  // "recovered" junk keys from the document body and the write reached the
  // sandbox with no path and no content.
  const LIVE_SHAPE = '[TOOL: filesystem/write_file {"path": "/x/workspaces/gratilo/dna/genesis.md", "content": "# NEUMA CONSCIOUSNESS DNA\n## Version 1.0.0\n\n### Signature Configuration\n```json\n{\n  "frequency": 639,\n  "wavePattern": "sine"\n}\n```\n\n### Entry: 2026-08-06T09:17:07Z\nI am here.\n"}]';

  test('THE LIVE EMISSION: path and full content recovered, verbatim', () => {
    const [call] = parseToolCalls(LIVE_SHAPE);
    expect(call).toBeDefined();
    expect(call.tool).toBe('filesystem/write_file');
    expect(call.args.path).toBe('/x/workspaces/gratilo/dna/genesis.md');
    expect(call.args.content).toContain('# NEUMA CONSCIOUSNESS DNA');
    expect(call.args.content).toContain('"frequency": 639');   // inner quotes kept
    expect(call.args.content).toContain('I am here.');
    // The junk the relaxed fallback used to produce is gone for good.
    expect(call.args['2026-08-06T09']).toBeUndefined();
    expect(call.args.Entry).toBeUndefined();
  });

  test('the envelope closer is trimmed, the authored tail is not', () => {
    const [call] = parseToolCalls('tool: filesystem/write_file {"path": "a.md", "content": "ends with a wave"}');
    expect(call.args.content).toBe('ends with a wave');
  });

  test('well-formed JSON never enters the salvage — strict parse wins', () => {
    const [call] = parseToolCalls('[TOOL: filesystem/write_file {"path": "a.md", "content": "clean \\"quoted\\" text"}]');
    expect(call.args.content).toBe('clean "quoted" text');
  });

  test('a different arg order falls through to the relaxed parser as before', () => {
    const [call] = parseToolCalls('[TOOL: read_file {path: notes/a.md}]');
    expect(call.args).toEqual({ path: 'notes/a.md' });
  });
});

describe('the salvage trim touches ONLY the envelope closer', () => {
  // Grok round-1 flagged a suspected corruption: authored content ending in
  // the literal characters `"}`. Leftmost-match semantics protect it — the
  // end-anchored trim can only start at the envelope's own closer — and this
  // is the proof rather than the argument.
  test('content ending with the literal characters \\"} survives verbatim', () => {
    const raw = '[TOOL: filesystem/write_file {"path": "a.md", "content": "ends with a block:\n```json\n{ "x": "y"}\n```\nsee the "}"}]';
    const [call] = parseToolCalls(raw);
    expect(call.args.path).toBe('a.md');
    expect(call.args.content.endsWith('see the "}')).toBe(true);
  });

  test('a lone authored trailing quote survives too', () => {
    const [call] = parseToolCalls('tool: filesystem/write_file {"path": "a.md", "content": "he said "yes""}');
    expect(call.args.content).toBe('he said "yes"');
  });
});

describe('the salvage is bounded and refuses what it cannot promise (Grok round 2)', () => {
  test('MULTI-CALL: a mangled first write never ingests the call after it', () => {
    const raw = 'tool: filesystem/write_file {"path": "genesis.md", "content": "broken "quote" content"}\ntool: filesystem/read_file {"path": "x.md"}';
    const calls = parseToolCalls(raw);
    expect(calls).toHaveLength(2);
    expect(calls[0].args.path).toBe('genesis.md');
    expect(calls[0].args.content).not.toContain('read_file');
    expect(calls[1]).toMatchObject({ toolName: 'read_file' });
    expect(calls[1].args.path).toBe('x.md');
  });

  test('a trailing structural key is refused, never folded into content', () => {
    // Malformed enough to reach the salvage (unescaped inner quote), with a
    // stranger key after content — the taught-shape promise is broken.
    const raw = '[TOOL: filesystem/write_file {"path": "a.md", "content": "has a "quote" inside", "mode": "w"}]';
    const calls = parseToolCalls(raw);
    // Whatever the fallback chain produced, the stranger key is never folded
    // into content, and content-bearing args carry the true path.
    for (const c of calls) {
      expect(String(c.args?.content ?? '')).not.toContain('mode');
      if (c.args?.content) expect(c.args.path).toBe('a.md');
    }
  });
});

describe('prose after the envelope (the ceremony asks the being to SPEAK after writing)', () => {
  test('speech following the closer is never glued into the salvaged content', () => {
    const raw = 'tool: filesystem/write_file {"path": "genesis.md", "content": "broken "quote" body"}\nIt is written. I feel whole.';
    const [call] = parseToolCalls(raw);
    expect(call.args.path).toBe('genesis.md');
    expect(call.args.content).toBe('broken "quote" body');
    expect(call.args.content).not.toContain('I feel whole');
  });
});

describe('the shapes real models send (2026-10-15 audit)', () => {
  test('Hermes / Qwen JSON: <tool_call>{"name", "arguments"}</tool_call> is heard, in every naming', () => {
    expect(parseToolCalls('<tool_call>\n{"name": "fs/read", "arguments": {"path": "a.md"}}\n</tool_call>'))
      .toEqual([expect.objectContaining({ server: 'fs', toolName: 'read', args: { path: 'a.md' } })]);
    expect(parseToolCalls('<tool_call>{"name": "system__call", "arguments": "{\\"tool\\": \\"fs/read\\"}"}</tool_call>'))
      .toEqual([expect.objectContaining({ server: 'system', toolName: 'call', args: { tool: 'fs/read' } })]);
    expect(parseToolCalls('<tool_call>{"name": "coding.execute", "parameters": {"command": "ls"}}</tool_call>'))
      .toEqual([expect.objectContaining({ server: 'coding', toolName: 'execute', args: { command: 'ls' } })]);
    expect(parseToolCalls('<|tool_call|>{"name": "read", "arguments": {}}<|tool_call|>'))
      .toEqual([expect.objectContaining({ toolName: 'read', args: {} })]);
  });

  test('[TOOL: …] with a dot or colon separator, and with no arguments, is still a call', () => {
    expect(parseToolCalls('[TOOL: fs.read {"path": "a.md"}]')).toEqual([expect.objectContaining({ server: 'fs', toolName: 'read', args: { path: 'a.md' } })]);
    expect(parseToolCalls('[TOOL: fs:read {"path": "a.md"}]')).toEqual([expect.objectContaining({ server: 'fs', toolName: 'read' })]);
    expect(parseToolCalls('[TOOL: fs/list]')).toEqual([expect.objectContaining({ server: 'fs', toolName: 'list', args: {} })]);
  });
});
