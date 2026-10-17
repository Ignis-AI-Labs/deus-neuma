/** Render real composition events through the production React view. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { CompositionView, TokenFigure } from '../../frontend/app/RelinkShell/CompositionView.jsx';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';

test('budget uses standing input plus output while section attribution keeps its separate total', () => {
  const event = buildCompositionEvent({
    sections: [{ id: 'identity', label: 'Identity', text: 'identity text' }],
    standing: { promptTokens: 17000, source: 'measured' },
    usage: { promptTokens: 60000, completionTokens: 500 },
    budget: { contextTokens: 100000, source: 'provider-runtime' },
  });
  const html = renderToStaticMarkup(React.createElement(CompositionView, { composition: event }));
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  expect(text).toContain('SECTION TOTAL');
  expect(text).toContain('STANDING INPUT 17,000');
  expect(text).toContain('BUDGET 17,500 / 100,000');
  expect(text).toContain('WORKING PEAK 60,000');
});

test('carried readings describe their actual historical source rather than a chars-per-token estimate', () => {
  const html = renderToStaticMarkup(React.createElement(TokenFigure, { tokens: 17000, tokenSource: 'carried' }));
  expect(html).toContain('CARRIED');
  expect(html).toContain('last measured turn');
  expect(html).not.toContain('chars/4');
});
