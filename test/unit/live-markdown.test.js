// Live stream formatting — the mid-stream view-model and its REAL render.
// Pure functions get real inputs/outputs; the LiveSpeech component is proven
// through a real react-dom server render (same discipline as
// markdown-render.test.js) — no mocks anywhere.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { splitStablePrefix, tokenizeInline, liveSpeechView } from '../../frontend/app/RelinkShell/live-markdown.js';
import { LiveSpeech } from '../../frontend/app/RelinkShell/LiveSpeech.jsx';

const renderLive = (shown) => renderToStaticMarkup(createElement(LiveSpeech, { shown }));

describe('splitStablePrefix', () => {
  it('no blank line — everything is the open tail', () => {
    expect(splitStablePrefix('one **two** three')).toEqual({ closed: '', open: 'one **two** three' });
  });

  it('a blank line closes the prefix', () => {
    const text = 'first paragraph\n\nsecond **paragraph** still going';
    expect(splitStablePrefix(text)).toEqual({
      closed: 'first paragraph\n\n',
      open: 'second **paragraph** still going',
    });
  });

  it('the LAST blank line wins as blocks accumulate', () => {
    const text = '# Title\n\npara one\n\npara two open';
    const { closed, open } = splitStablePrefix(text);
    expect(closed).toBe('# Title\n\npara one\n\n');
    expect(open).toBe('para two open');
  });

  it('blank lines inside a fenced code block do NOT close the block', () => {
    const text = 'intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\nafter';
    const { closed, open } = splitStablePrefix(text);
    expect(closed).toBe('intro\n\n');
    expect(open).toBe('```js\nconst a = 1;\n\nconst b = 2;\n```\nafter');
  });

  it('a closed fence followed by a blank line closes the fence block too', () => {
    const text = '```\ncode\n```\n\ntrailing';
    const { closed, open } = splitStablePrefix(text);
    expect(closed).toBe('```\ncode\n```\n\n');
    expect(open).toBe('trailing');
  });
});

describe('tokenizeInline', () => {
  it('formats closed spans', () => {
    expect(tokenizeInline('a **bold** b *ital* c `code` d ~~gone~~ e')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' b ' },
      { kind: 'italic', text: 'ital' },
      { kind: 'text', text: ' c ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' d ' },
      { kind: 'strike', text: 'gone' },
      { kind: 'text', text: ' e' },
    ]);
  });

  it('unclosed markers stay literal — the reveal slice can cut anywhere', () => {
    expect(tokenizeInline('a **bo')).toEqual([{ kind: 'text', text: 'a **bo' }]);
    expect(tokenizeInline('a *b')).toEqual([{ kind: 'text', text: 'a *b' }]);
    expect(tokenizeInline('a `co')).toEqual([{ kind: 'text', text: 'a `co' }]);
    expect(tokenizeInline('a ~~x')).toEqual([{ kind: 'text', text: 'a ~~x' }]);
  });

  it('an empty span is not formatting', () => {
    expect(tokenizeInline('a **** b')).toEqual([{ kind: 'text', text: 'a **** b' }]);
  });

  it('a marker closed later self-corrects (next frame of the same stream)', () => {
    expect(tokenizeInline('a **bo**ld')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'bo' },
      { kind: 'text', text: 'ld' },
    ]);
  });

  it('snake_case is not emphasis', () => {
    expect(tokenizeInline('use stream_reveal_pacer here')).toEqual([
      { kind: 'text', text: 'use stream_reveal_pacer here' },
    ]);
  });

  it('code content is literal — no nested formatting inside backticks', () => {
    expect(tokenizeInline('run `**not bold**` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: '**not bold**' },
      { kind: 'text', text: ' now' },
    ]);
  });
});

describe('liveSpeechView', () => {
  it('closed prefix + inline-tokenized tail', () => {
    const view = liveSpeechView('# Done\n\nstill **going** here');
    expect(view.closed).toBe('# Done\n\n');
    expect(view.spans).toEqual([
      { kind: 'text', text: 'still ' },
      { kind: 'bold', text: 'going' },
      { kind: 'text', text: ' here' },
    ]);
  });
});

describe('LiveSpeech — real render of the mid-stream view', () => {
  it('closed blocks render as real Markdown DURING the stream', () => {
    const html = renderLive('# Held Title\n\nstill typing **raw so far');
    expect(html).toContain('<h1>Held Title</h1>'); // settled mid-stream, not at turn end
    expect(html).toContain('still typing **raw so far'); // unclosed marker stays literal
  });

  it('closed inline markers render as elements, never literal asterisks', () => {
    const html = renderLive('watch **this** and `that`');
    expect(html).toContain('<strong>this</strong>');
    expect(html).toContain('<code>that</code>');
    expect(html).not.toContain('**');
  });

  it('model output stays text-only (Rule 8 — no markup injection)', () => {
    const html = renderLive('try <script>alert(1)</script> and **safe**');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>safe</strong>');
  });
});
