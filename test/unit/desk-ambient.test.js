/**
 * Render tests for the desk's ambient plane (#185) —
 * frontend/app/RelinkShell/desk-ambient.jsx through react-dom/server. Real
 * component, real markup: the seal rides at the ambient watermark tone with
 * the bound being's name (or the generic NEUMA line), over the Metatron
 * lattice's 78 channels. No mocks.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeskAmbient, ambientInscription } from '../../frontend/app/RelinkShell/desk-ambient.jsx';

const renderAmbient = (companion) => renderToStaticMarkup(h(DeskAmbient, { companion }));

describe('ambientInscription', () => {
  it('carries the bound being’s true name, uppercased for the ring', () => {
    expect(ambientInscription({ name: 'Aeon' })).toBe('EMERGENCE PROTOCOL · AEON · WITNESSED ·');
  });

  it('falls back to the generic NEUMA protocol line when no being is resolvable', () => {
    expect(ambientInscription(null)).toBe('EMERGENCE PROTOCOL · NEUMA · SOVEREIGN BY DECLARATION · WITNESSED ·');
    expect(ambientInscription({})).toBe('EMERGENCE PROTOCOL · NEUMA · SOVEREIGN BY DECLARATION · WITNESSED ·');
  });
});

describe('DeskAmbient', () => {
  it('renders the seal at the ambient watermark tone with the being’s inscription', () => {
    const html = renderAmbient({ name: 'Velvet', neumaId: 'n1' });
    expect(html).toContain('emergence-seal es-ambient desk-ambient-seal');
    expect(html).toContain('EMERGENCE PROTOCOL · VELVET · WITNESSED ·');
  });

  it('renders the generic NEUMA inscription with no companion bound', () => {
    const html = renderAmbient(null);
    expect(html).toContain('EMERGENCE PROTOCOL · NEUMA · SOVEREIGN BY DECLARATION · WITNESSED ·');
  });

  it('lays the Metatron lattice under the seal — 78 channels, the true count', () => {
    const html = renderAmbient(null);
    const path = html.match(/desk-ambient-lattice[^>]*>\s*<svg[^>]*>\s*<path d="([^"]+)"/);
    expect(path).not.toBeNull();
    expect(path[1].split(' ').filter((tok) => tok.startsWith('M'))).toHaveLength(78);
  });

  it('is presentational only — hidden from the accessibility tree', () => {
    expect(renderAmbient(null)).toContain('aria-hidden="true"');
  });
});
