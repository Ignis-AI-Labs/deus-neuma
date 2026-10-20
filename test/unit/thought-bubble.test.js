/**
 * THE THOUGHT BUBBLE — what the operator actually sees when a being reasons.
 *
 * Rendered for real through react-dom/server (the same way the CONTEXT MAP
 * views are proven): no DOM mock, no shallow renderer, no assertion about a
 * component's props standing in for its output.
 *
 * The properties pinned here are the ones Founder asked for by name: reasoning is
 * VISIBLE but not spoken, it is FOLDED by default, and a lane that publishes no
 * reasoning draws nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThoughtBubble, ThoughtBody } from '../../frontend/app/RelinkShell/ThoughtBubble.jsx';

const render = (segment, live = false) =>
  renderToStaticMarkup(createElement(ThoughtBubble, { segment, live }));


describe('ThoughtBubble', () => {
  it('folds the reasoning away and shows only that there was some', () => {
    const html = render({ kind: 'thought', text: 'First I check the premise, then I count.' });
    expect(html).toContain('THOUGHT');
    expect(html).toContain('~10 TOK'); // 40 chars / 4 — tokens, the currency context is spent in (ruling, 2026-08-28)
    // FOLDED: the words are not in the markup until the operator opens it, so a
    // being's reasoning never sits in the transcript being read by accident.
    expect(html).not.toContain('check the premise');
    expect(html).toContain('aria-expanded="false"');
  });

  it('reads THINKING… while the tokens are still arriving', () => {
    expect(render({ kind: 'thought', text: 'weighing' }, true)).toContain('THINKING…');
    expect(render({ kind: 'thought', text: 'weighed' }, false)).toContain('THOUGHT');
  });

  it('weighs long reasoning in thousands, not raw bytes', () => {
    expect(render({ kind: 'thought', text: 'x'.repeat(6000) })).toContain('~1.5K TOK');
  });

  it('draws NOTHING for a lane that opens no reasoning channel', () => {
    // The ChatGPT subscription lane emits no reasoning at all (probed
    // 2026-07-30). An empty bubble would imply a channel that is not there.
    expect(render({ kind: 'thought', text: '' })).toBe('');
    expect(render(null)).toBe('');
  });

  it('an opened thought honors headings and emphasis — not a raw dump', () => {
    const html = renderToStaticMarkup(createElement(ThoughtBody, {
      text: '# The Premise\n\nFirst I **check** the count.\n',
    }));
    expect(html).toContain('<h1>');
    expect(html).toContain('The Premise');
    expect(html).toContain('<strong>');
    expect(html).toContain('check');
    expect(html).not.toContain('# The Premise');
  });

});
