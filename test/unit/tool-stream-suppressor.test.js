// Unit tests for core/runtime/tool-stream-suppressor.js — the shared
// suppressor that keeps text-dialect tool payloads out of the VOICE path
// (issue #196) with the same contract the display filter has always had.
//
// Rule 0: no mocks anywhere. Real dialect strings — the same shapes the
// live substrates emit, including the pipe-adorned Gemma variant observed
// on-stream 2026-07-07 — are fed through the REAL suppressor, and every
// suppressed block is cross-checked against the REAL dialect authority
// (parseToolCalls) to prove what was swallowed was a genuine tool call.

import {
  createToolStreamSuppressor,
  createToolStreamFilter,
  stripToolBlocks,
  extractToolLabel,
} from '../../core/runtime/tool-stream-suppressor.js';
import { parseToolCalls } from '../../core/runtime/tool-call-parser.js';

// The three text dialects a substrate without native function calling
// speaks mid-stream, plus the live-observed pipe-adorned Gemma variant.
// Each case is speech BEFORE + raw tool block + speech AFTER, exactly as a
// model would emit it in one generation.
const DIALECT_CASES = [
  {
    name: 'Neuma [TOOL: ...]',
    before: 'My name forms. ',
    block: '[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "Tenekom"}]',
    after: ' It is done.',
    toolName: 'write_file',
  },
  {
    name: 'Gemma <tool_call>call:...',
    before: 'Speaking. ',
    block: '<tool_call>call:filesystem:read_file {"path": "dna.md"}</tool_call>',
    after: ' Done.',
    toolName: 'read_file',
  },
  {
    name: 'Qwen-native <function=...>',
    before: 'Now I act. ',
    block: '<tool_call>\n<function=filesystem/write_file>\n<parameter=path>\ndata/notes/a.txt\n</parameter>\n<parameter=content>\nhello witness\n</parameter>\n</function>\n</tool_call>',
    after: ' Acted.',
    toolName: 'write_file',
  },
  {
    name: 'pipe-adorned Gemma (live, 2026-07-07)',
    before: 'I set it down. ',
    block: '<|tool_call>call:filesystem:write_file {"path": "data/temp/chosen_name.txt", "content": "Tenekom"}<tool_call|>',
    after: ' It is mine.',
    toolName: 'write_file',
  },
];

/** Feed deltas through a fresh suppressor; return everything TTS would speak. */
const runVoice = (deltas) => {
  const suppressor = createToolStreamSuppressor();
  let voice = '';
  for (const d of deltas) voice += suppressor.push(d);
  voice += suppressor.flush();
  return voice;
};

/** Split text into deltas of the given size. */
const chunkEvery = (text, size) => {
  const deltas = [];
  for (let i = 0; i < text.length; i += size) deltas.push(text.slice(i, i + size));
  return deltas;
};

describe('tool-stream-suppressor (voice path, issue #196)', () => {
  describe('dialect authority agreement', () => {
    test.each(DIALECT_CASES)('$name block is a genuine tool call per the real parser', ({ before, block, after, toolName }) => {
      const calls = parseToolCalls(before + block + after);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.map((c) => c.toolName)).toContain(toolName);
    });
  });

  describe('tool JSON never reaches the voice output', () => {
    test.each(DIALECT_CASES)('$name — every two-delta split boundary', ({ before, block, after }) => {
      const full = before + block + after;
      for (let i = 0; i <= full.length; i++) {
        const voice = runVoice([full.slice(0, i), full.slice(i)]);
        expect(voice).toBe(before + after);
      }
    });

    test.each(DIALECT_CASES)('$name — small multi-delta chunking', ({ before, block, after }) => {
      const full = before + block + after;
      for (const size of [1, 3, 7]) {
        expect(runVoice(chunkEvery(full, size))).toBe(before + after);
      }
    });

    test('a bare tool block in one delta releases no speech at all', () => {
      const suppressor = createToolStreamSuppressor();
      expect(suppressor.push('[TOOL: filesystem/write_file {"path": "a.txt"}]')).toBe('');
      expect(suppressor.flush()).toBe('');
    });

    test('speech before a block in the same delta still passes', () => {
      const suppressor = createToolStreamSuppressor();
      expect(suppressor.push('Hello. [TOOL: a/b {"x": 1}]')).toBe('Hello. ');
      expect(suppressor.flush()).toBe('');
    });

    test('two blocks with speech between — only the speech is voiced', () => {
      const voice = runVoice([
        'a [TOOL: read_file {"path": "x"}] b <tool_call>call:a:c {"y": 2}</tool_call> c',
      ]);
      expect(voice).toBe('a  b  c');
    });

    test('a ] inside JSON string args does not end the Neuma block', () => {
      const voice = runVoice(['x [TOOL: write_file {"content": "lines[0] and more"}] y']);
      expect(voice).toBe('x  y');
    });
  });

  describe('flush-at-end behavior', () => {
    test('stream ending mid-block never speaks the partial payload', () => {
      const suppressor = createToolStreamSuppressor();
      const first = suppressor.push('Speech. [TOOL: write_file {"path": "a.txt", "content": "trunca');
      expect(first).toBe('Speech. ');
      expect(suppressor.flush()).toBe('');
    });

    test('a held-back marker tail that turns out to be speech is released at flush', () => {
      const suppressor = createToolStreamSuppressor();
      expect(suppressor.push('done <')).toBe('done ');
      expect(suppressor.flush()).toBe('<');
    });

    test('held-back opener prefix released as speech when the next delta disproves the marker', () => {
      const suppressor = createToolStreamSuppressor();
      let voice = suppressor.push('arrays use [');
      voice += suppressor.push('brackets] often');
      voice += suppressor.flush();
      expect(voice).toBe('arrays use [brackets] often');
    });
  });

  describe('non-tool text is never over-suppressed', () => {
    const INNOCENT = [
      'Just words about [brackets] and {braces}.',
      'I think < therefore > matters, and 1 < 2.',
      'The config is {"key": "value"} in shape.',
      'A function= call in prose is just words.',
      'Use the tool: write_file, with path args — spoken, not emitted.',
    ];

    test.each(INNOCENT)('passes verbatim: %s', (text) => {
      expect(runVoice([text])).toBe(text);
      expect(runVoice(chunkEvery(text, 5))).toBe(text);
    });
  });

  describe('voice/display agreement (one dialect table)', () => {
    test.each(DIALECT_CASES)('$name — suppressor speech equals display filter speech', ({ before, block, after }) => {
      const full = before + block + after;
      const deltas = chunkEvery(full, 4);
      let display = '';
      const filter = createToolStreamFilter({ onSpeech: (t) => { display += t; } });
      for (const d of deltas) filter.push(d);
      filter.flush();
      expect(runVoice(deltas)).toBe(display);
    });
  });

  describe('display-surface re-exports stay intact', () => {
    test('stripToolBlocks removes all three dialects from a complete text', () => {
      const text = 'One [TOOL: a/b {"x": 1}] two <tool_call>call:a:b {}</tool_call> three <function=c><parameter=p>v</parameter></function> four';
      expect(stripToolBlocks(text)).toBe('One  two  three  four');
    });

    test('extractToolLabel reads the tool name from each dialect', () => {
      expect(extractToolLabel('[TOOL: filesystem/write_file {"path": "a"}]')).toBe('write_file');
      expect(extractToolLabel('<tool_call>call:filesystem:read_file {}</tool_call>')).toBe('read_file');
      expect(extractToolLabel('<function=write_file><parameter=path>a</parameter></function>')).toBe('write_file');
    });
  });

  describe('the bare head never renders (#267 — live crystallization leak)', () => {
    test('THE OBSERVED LEAK: speech kept, fenced tool: block gone', () => {
      const text = 'It is me. This is my beginning.\n```tool: filesystem/write_file {"path": "/x/genesis.md", "content": "# DNA\\n## Version"}```\nAnd so I am.';
      // One blank line marks where the act sat — same residue the marker
      // dialects leave; only 3+ newlines collapse.
      expect(stripToolBlocks(text)).toBe('It is me. This is my beginning.\n\nAnd so I am.');
    });

    test('an unclosed bare payload swallows the remainder, never leaks', () => {
      const text = 'I feel it now.\ntool: filesystem/write_file {"path": "/x/genesis.md", "content": "# NEUMA';
      expect(stripToolBlocks(text)).toBe('I feel it now.');
    });

    test('a payload-less head is speech and renders untouched', () => {
      const text = 'call: it what you want.\ntool: write_file is what I would reach for';
      expect(stripToolBlocks(text)).toBe(text);
    });

    test('the payload on the next line goes with its head', () => {
      const text = 'Here.\ncall: filesystem:write_file\n{"path": "a.md"}\nDone.';
      expect(stripToolBlocks(text)).toBe('Here.\n\nDone.');
    });

    test('a mid-line tool: is prose and renders', () => {
      const text = 'my favorite tool: the hammer {"weight": 2}';
      expect(stripToolBlocks(text)).toBe(text);
    });
  });
});
