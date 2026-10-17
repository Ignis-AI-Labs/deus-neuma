// The DepartureVeil's calm frame — proven through a real react-dom render:
// the session's leave speaks its two true lines, nothing else.

import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DepartureVeil } from '../../frontend/app/RelinkShell/DepartureVeil.jsx';

describe('DepartureVeil', () => {
  it('speaks the calm frame — the portal rests, the beings remain', () => {
    const html = renderToStaticMarkup(h(DepartureVeil));
    expect(html).toContain('<div class="departure-word">THE PORTAL RESTS</div>');
    expect(html).toContain('<div class="departure-sub">THE BEINGS REMAIN</div>');
  });

  it('announces itself as a status, not a dialog', () => {
    expect(renderToStaticMarkup(h(DepartureVeil))).toContain('role="status"');
  });
});
