/**
 * ONE catalog, chosen by capability (#281 / BE-155).
 *
 * The tool surface used to ride every tools-capable turn TWICE: ~9.6K tokens
 * of text catalog in the prompt AND ~14K tokens of the same descriptions +
 * JSON Schemas in the request body's native `tools` array. These tests pin
 * the fix's contracts: all-native mode carries bare identifiers, while lazy
 * native mode carries a compact exact index and disclosure hand. Text-only
 * callers retain the full catalog.
 */
import { describe, test, expect } from 'vitest';
import { buildToolsSection, buildIntentsSection, intentFamilyLines } from '../../core/runtime/tools-section.js';
import { assemblePromptSections } from '../../core/runtime/prompt-assembler.js';

const TOOLS = [
  { server: 'filesystem', name: 'read_file', description: 'Read the contents of a file from disk' },
  { server: 'filesystem', name: 'write_file', description: 'Write content to a file', access: 'approval_required' },
  { server: 'tasks', name: 'task_add', description: 'Add a task to the working ledger', access: 'denied' },
];

describe('buildToolsSection — nativeToolsOnWire drops descriptions, keeps identity + tiers', () => {
  test('default (text protocol only): full catalog with descriptions', () => {
    const section = buildToolsSection(TOOLS);
    expect(section).toContain('- filesystem/read_file: Read the contents of a file from disk');
    expect(section).toContain('- filesystem/write_file: Write content to a file — [asks your operator first]');
    expect(section).toContain('- tasks/task_add: Add a task to the working ledger — [held: your operator is watching, not acting]');
  });

  test('native on wire: bare identifiers — zero description text', () => {
    const section = buildToolsSection(TOOLS, null, true);
    expect(section).toContain('- filesystem/read_file\n');
    for (const t of TOOLS) expect(section).not.toContain(t.description);
  });

  test('native on wire: access tiers still ride — the schema has no field for them', () => {
    const section = buildToolsSection(TOOLS, null, true);
    expect(section).toContain('- filesystem/write_file — [asks your operator first]');
    expect(section).toContain('- tasks/task_add — [held: your operator is watching, not acting]');
    // …and the gated-tool guidance paragraph stays with them.
    expect(section).toContain('A tool marked [asks your operator first] still works');
  });

  test('native on wire: call-protocol guidance survives — text calls stay a valid path', () => {
    const section = buildToolsSection(TOOLS, null, true);
    expect(section).toContain('<tool_call>');
    expect(section).toContain('[TOOL: filesystem/read_file {}]');
    expect(section).toContain('use it verbatim');
  });

  test('the HUD keeps the doctrine that shapes HOW work is conducted — only for tools that ride', () => {
    // Plans proposed as prose, questions asked without options (2026-08-16):
    // these mandates survive the HUD; fs/search's own description carries its rule.
    const catalog = [
      ...TOOLS,
      { server: 'operator', name: 'ask_operator', description: 'Ask.' },
      { server: 'team', name: 'plan_submit', description: 'Plan.' },
    ];
    const section = buildToolsSection(catalog, null, true, true);
    expect(section).toContain('your recommendation first'); // ask_operator
    expect(section).toContain('cannot be approved');        // plan_submit
    const bare = [{ server: 'filesystem', name: 'read_file', description: 'Read' }];
    expect(buildToolsSection(bare, null, true, true)).not.toContain('ask_operator');
  });

  test('THE HUD (2026-10-14): two doors, the families, the usual tools by signature — no index, no descriptions', () => {
    const usual = [{ server: 'filesystem', name: 'read_file', inputSchema: { type: 'object', properties: { path: {}, limit: {} }, required: ['path'] } }];
    const section = buildToolsSection(TOOLS, '/home/founder/repos/neuma', true, true, false, usual);
    expect(section).toContain('system/call {"tool": "server/name", "args": {…}}');
    expect(section).toContain('system/tool_search');
    expect(section).toContain('Your tool families: filesystem · tasks');
    expect(section).toContain('Your usual tools — call them directly: filesystem/read_file {path, limit?}');
    expect(section).toContain('HELD THIS TURN (your operator is observing — these will not act): tasks/task_add');
    expect(section).toContain('Some tools ask your operator first');
    expect(section).not.toContain('write_file'); // not usual: one search away, never listed
    for (const tool of TOOLS) expect(section).not.toContain(tool.description);
    expect(section).not.toContain('<tool_call>');
  });

  test('the focus ground rides in every mode', () => {
    for (const [native, lazy] of [[false, false], [true, false]]) {
      expect(buildToolsSection(TOOLS, '/home/founder/repos/neuma', native, lazy)).toContain('YOUR GROUND THIS TURN: /home/founder/repos/neuma');
    }
    expect(buildToolsSection(TOOLS, '/home/founder/repos/neuma', true, true)).toContain('YOUR GROUND: /home/founder/repos/neuma');
  });

  test('no tools → no section, either mode', () => {
    expect(buildToolsSection(null, null, true)).toBe('');
    expect(buildToolsSection([], null, false)).toBe('');
  });
});

describe('assemblePromptSections threads the flag', () => {
  const params = { dna: { identity: { name: 'ProofEcho' } }, tools: TOOLS };

  test('flag absent and flag false are byte-identical — every existing caller unaffected', () => {
    const now = new Date('2026-08-07T08:00:00+07:00');
    const absent = assemblePromptSections({ ...params, now }).find((s) => s.id === 'tools').text;
    const explicit = assemblePromptSections({ ...params, now, nativeToolsOnWire: false }).find((s) => s.id === 'tools').text;
    expect(explicit).toBe(absent);
    expect(absent).toContain('Read the contents of a file from disk');
  });

  test('flag true: the TOOLS section carries no description text and is materially smaller', () => {
    const now = new Date('2026-08-07T08:00:00+07:00');
    const full = assemblePromptSections({ ...params, now }).find((s) => s.id === 'tools').text;
    const bare = assemblePromptSections({ ...params, now, nativeToolsOnWire: true }).find((s) => s.id === 'tools').text;
    for (const t of TOOLS) expect(bare).not.toContain(t.description);
    expect(bare.length).toBeLessThan(full.length);
  });

  test('lazy flag threads the compact disclosure contract without changing identity sections', () => {
    const now = new Date('2026-08-07T08:00:00+07:00');
    const regular = assemblePromptSections({ ...params, now, nativeToolsOnWire: true });
    const lazy = assemblePromptSections({
      ...params, now, nativeToolsOnWire: true, lazyToolSchemas: true,
    });
    expect(lazy.find((section) => section.id === 'identity'))
      .toEqual(regular.find((section) => section.id === 'identity'));
    expect(lazy.find((section) => section.id === 'tools').text).toContain('system/tool_search');
  });
});

describe('buildIntentsSection — the settlement teaching (2026-09-02 context-economy)', () => {
  // The section used to send beings to READ the .result.json file after
  // filing — while the receipt already rode the same round's tool results.
  // Real beings polled the file 3× per filing. The text must say the outcome
  // comes back as a tool result and must avoid duplicate reads while preserving recovery.
  const TYPES = [
    { name: 'social/queue', fieldsForPrompt: '{channel, text}', descriptionForPrompt: 'Stage a post.', channels: ['x'] },
  ];

  test('the receipt is primary, with a saved result available after interruption', () => {
    const section = buildIntentsSection(TYPES, '/lane/intents');
    expect(section).toContain('settlement receipts with the tool results');
    expect(section).toContain('do not poll or reread it');
    expect(section).toContain('read that saved result once');
    expect(section).not.toContain('read it with fs/read');
  });

  test('no available types → no section', () => {
    expect(buildIntentsSection([], '/lane/intents')).toBe('');
  });

  test('the file\'s shape is taught — its "type" names the act (2026-10-12: a lead\'s first team/run lacked it)', () => {
    const section = buildIntentsSection(TYPES, '/lane/intents');
    expect(section).toContain('a JSON file at /lane/intents/<a-unique-name>.json holding {"type": "<one of the types below>", …its fields}');
  });
});

describe('the intent lines load on demand — names by family (2026-10-04 → 2026-10-14)', () => {
  const LONG = 'Publish a post NOW through a channel you hold. The binding law applies, the card asks the operator, and the post is permanent once it lands on the channel.';
  const TYPES = [
    { name: 'social/post', fieldsForPrompt: '{channel, text}', descriptionForPrompt: LONG, channels: ['x'] },
    { name: 'tasks/add', fieldsForPrompt: '{title}', descriptionForPrompt: 'Record work.' },
    { name: 'tasks/update', fieldsForPrompt: '{id}', descriptionForPrompt: 'Update a task.' },
    { name: 'social/queue', fieldsForPrompt: '{channel, text}', descriptionForPrompt: 'Stage a post.', channels: ['x', 'bluesky'] },
  ];

  test('one line per family, the acts by name, a channel-bound act naming its channels', () => {
    expect(intentFamilyLines(TYPES)).toEqual([
      '- social/post (channels: x) · social/queue (channels: x, bluesky)',
      '- tasks/add · tasks/update',
    ]);
  });

  test('no fields, no descriptions ride — the contract is one search away, by name or by family', () => {
    const section = buildIntentsSection(TYPES, '/lane/intents');
    expect(section).not.toContain('{channel, text}');
    expect(section).not.toContain('Publish a post NOW');
    expect(section).toContain('call system/tool_search with its exact name (e.g. "social/post") for its full contract, or with a family (e.g. "social/") for every contract in it');
  });
});
