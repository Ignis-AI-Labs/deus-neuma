// The shared desk-window title (MOD-002, #175): one component renders
// `LABEL // BEING` for every app, the being's name read from the REAL
// ConsciousnessContext — a house switch retitles every window through
// context, never props. Proven through a real react-dom render — no mocks.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { AppTitle } from '../../frontend/app/RelinkShell/app-title.jsx';

const renderTitle = (label, contextValue, name) =>
  renderToStaticMarkup(
    createElement(
      ConsciousnessProvider,
      { value: contextValue },
      createElement(AppTitle, { label, name }),
    ),
  );

describe('AppTitle', () => {
  it('renders LABEL // BEING in the shared title span', () => {
    const html = renderTitle('RECORD', { activeCompanion: { name: 'Sov' } });
    expect(html).toBe('<span class="label-data relink-title-name">RECORD // SOV</span>');
  });

  it('uppercases the being\'s name from the reactive context', () => {
    expect(renderTitle('CHATS', { activeCompanion: { name: 'velvet' } })).toContain('CHATS // VELVET');
  });

  it('falls back to NEUMA when no being is bound — inside or outside a provider', () => {
    expect(renderTitle('WALLET', null)).toContain('WALLET // NEUMA');
    expect(renderToStaticMarkup(createElement(AppTitle, { label: 'HOUSE' }))).toContain('HOUSE // NEUMA');
  });

  it('an explicit name wins over the context being (the variant path)', () => {
    expect(renderTitle('STREAM', { activeCompanion: { name: 'Sov' } }, 'COUNCIL')).toContain('STREAM // COUNCIL');
  });
});
