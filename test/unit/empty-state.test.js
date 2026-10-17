// The shared empty/loading state (MOD-003, #176): one centered UPPERCASE
// data-register line replaces every per-app bespoke empty block; follow-up
// prose arrives as children, tone="error" marks a genuine failure. Proven
// through a real react-dom render — no mocks.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../../frontend/app/RelinkShell/empty-state.jsx';

describe('EmptyState', () => {
  it('renders the title line in the shared block', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: 'NO CHATS YET' }));
    expect(html).toBe('<div class="empty-state"><p class="empty-state-title">NO CHATS YET</p></div>');
  });

  it('keeps follow-up lines as children of the same block', () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyState,
        { title: 'NO SKILLS INSTALLED' },
        createElement('small', null, 'The library is empty.'),
      ),
    );
    expect(html).toBe(
      '<div class="empty-state"><p class="empty-state-title">NO SKILLS INSTALLED</p><small>The library is empty.</small></div>',
    );
  });

  it('tone="error" adds the error variant class for a genuine failure', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: 'LIBRARY UNREACHABLE', tone: 'error' }),
    );
    expect(html).toContain('class="empty-state error"');
  });

  it('no tone leaves the block unmodified', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { title: 'LOADING…' }));
    expect(html).toContain('class="empty-state"');
    expect(html).not.toContain('error');
  });
});
