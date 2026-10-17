// Unit tests for frontend/utils/tool-stream-filter.js — the display-side
// guard that keeps raw tool payloads off the screen across all three
// dialects, including blocks split across stream chunks.

import {
  createToolStreamFilter,
  stripToolBlocks,
  extractToolLabel,
} from '../../frontend/utils/tool-stream-filter.js';

const collect = () => {
  const events = { speech: '', starts: 0, blocks: [] };
  const filter = createToolStreamFilter({
    onSpeech: (t) => { events.speech += t; },
    onToolStart: () => { events.starts++; },
    onToolEnd: (raw) => { events.blocks.push(raw); },
  });
  return { events, filter };
};

describe('tool-stream-filter', () => {
  describe('createToolStreamFilter', () => {
    test('passes plain speech through untouched', () => {
      const { events, filter } = collect();
      filter.push('I am here, ');
      filter.push('witness.');
      filter.flush();
      expect(events.speech).toBe('I am here, witness.');
      expect(events.starts).toBe(0);
    });

    test('suppresses a Neuma block arriving in one chunk', () => {
      const { events, filter } = collect();
      filter.push('My name forms. [TOOL: filesystem/write_file {"path": "a.txt", "content": "Fenna"}] It is done.');
      filter.flush();
      expect(events.speech).toBe('My name forms.  It is done.');
      expect(events.starts).toBe(1);
      expect(events.blocks[0]).toContain('write_file');
    });

    test('suppresses a Neuma block split across many chunks', () => {
      const { events, filter } = collect();
      const block = '[TOOL: filesystem/write_file {"path": "dna.md", "content": "essence {nested} text"}]';
      const full = `Before. ${block} After.`;
      for (let i = 0; i < full.length; i += 7) filter.push(full.slice(i, i + 7));
      filter.flush();
      expect(events.speech).toBe('Before.  After.');
      expect(events.blocks[0]).toBe(block);
    });

    test('a ] inside a JSON string does not close the Neuma block', () => {
      const { events, filter } = collect();
      filter.push('x [TOOL: write_file {"content": "lines[0] and more"}] y');
      filter.flush();
      expect(events.speech).toBe('x  y');
      expect(events.blocks[0]).toContain('lines[0]');
    });

    test('suppresses a Gemma tool_call block', () => {
      const { events, filter } = collect();
      filter.push('Speaking. <tool_call>call:filesystem:read_file {"path": "x"}</tool_call> Done.');
      filter.flush();
      expect(events.speech).toBe('Speaking.  Done.');
      expect(events.starts).toBe(1);
    });

    test('suppresses a Qwen function block split mid-marker', () => {
      const { events, filter } = collect();
      filter.push('Now I act. <func');
      filter.push('tion=write_file><parameter=path>a.txt</parameter></function> Acted.');
      filter.flush();
      expect(events.speech).toBe('Now I act.  Acted.');
      expect(events.blocks[0]).toContain('<function=write_file>');
    });

    test('a Qwen function nested in tool_call ends at tool_call close', () => {
      const { events, filter } = collect();
      filter.push('<tool_call><function=read_file><parameter=path>x</parameter></function></tool_call>ok');
      filter.flush();
      expect(events.speech).toBe('ok');
      expect(events.starts).toBe(1);
      expect(events.blocks[0]).toContain('</tool_call>');
    });

    test('held-back marker prefix that turns out to be speech is released', () => {
      const { events, filter } = collect();
      filter.push('arrays use [');
      filter.push('brackets] often');
      filter.flush();
      expect(events.speech).toBe('arrays use [brackets] often');
      expect(events.starts).toBe(0);
    });

    test('stream ending mid-block emits the partial as a block, not speech', () => {
      const { events, filter } = collect();
      filter.push('Speech. [TOOL: write_file {"path": "a.txt", "content": "trunca');
      filter.flush();
      expect(events.speech).toBe('Speech. ');
      expect(events.blocks).toHaveLength(1);
      expect(events.blocks[0]).toContain('trunca');
    });

    test('handles two blocks with speech between', () => {
      const { events, filter } = collect();
      filter.push('a [TOOL: read_file {"path": "x"}] b [TOOL: write_file {"path": "y"}] c');
      filter.flush();
      expect(events.speech).toBe('a  b  c');
      expect(events.starts).toBe(2);
      expect(events.blocks).toHaveLength(2);
    });
  });

  describe('stripToolBlocks', () => {
    test('removes all three dialects from a complete text', () => {
      const text = 'One [TOOL: a/b {"x": 1}] two <tool_call>call:a:b {}</tool_call> three <function=c><parameter=p>v</parameter></function> four';
      expect(stripToolBlocks(text)).toBe('One  two  three  four');
    });

    test('collapses block-shaped whitespace gaps', () => {
      const text = 'Speech.\n\n[TOOL: write_file {"path": "a"}]\n\nMore speech.';
      expect(stripToolBlocks(text)).toBe('Speech.\n\nMore speech.');
    });

    test('drops an unclosed trailing block entirely', () => {
      expect(stripToolBlocks('Words. [TOOL: write_file {"path": "a", "content": "cut off')).toBe('Words.');
    });

    test('returns empty string for non-string input', () => {
      expect(stripToolBlocks(null)).toBe('');
      expect(stripToolBlocks(undefined)).toBe('');
    });

    test('leaves tool-free text alone', () => {
      expect(stripToolBlocks('Just words about [brackets] and {braces}.')).toBe('Just words about [brackets] and {braces}.');
    });
  });

  describe('extractToolLabel', () => {
    test('reads the tool name from each dialect', () => {
      expect(extractToolLabel('[TOOL: filesystem/write_file {"path": "a"}]')).toBe('write_file');
      expect(extractToolLabel('[TOOL: read_file path=x.txt]')).toBe('read_file');
      expect(extractToolLabel('<tool_call>call:filesystem:read_file {}</tool_call>')).toBe('read_file');
      expect(extractToolLabel('<function=write_file><parameter=path>a</parameter></function>')).toBe('write_file');
    });

    test('falls back to a generic label', () => {
      expect(extractToolLabel('garbage')).toBe('tool');
    });
  });
});

describe('pipe-adorned Gemma markers (live naming, 2026-07-07)', () => {
  test('a <|tool_call>…<tool_call|> block never renders as the being\'s speech', () => {
    const { events, filter } = collect();
    filter.push('I set it down. <|tool_call>call:filesystem:write_file {"path": "data/temp/chosen_name.txt", "content": "Tenekom"}<tool_call|> It is mine.');
    filter.flush();
    expect(events.speech).not.toContain('tool_call');
    expect(events.speech).not.toContain('write_file');
    expect(events.speech).toContain('I set it down.');
    expect(events.speech).toContain('It is mine.');
    expect(events.starts).toBe(1);
  });
});

describe('symmetric pipe markers (unobserved variant, parses server-side)', () => {
  test('a <|tool_call|>…<|tool_call|> block never renders as speech', () => {
    const { events, filter } = collect();
    filter.push('Before. <|tool_call|>call:filesystem:write_file {"path": "a.txt", "content": "x"}<|tool_call|> After.');
    filter.flush();
    expect(events.speech).not.toContain('tool_call');
    expect(events.speech).toContain('Before.');
    expect(events.speech).toContain('After.');
  });
});
