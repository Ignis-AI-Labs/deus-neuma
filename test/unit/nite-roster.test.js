/**
 * THE HOUSE STANDS — an owed act you can read must be an owed act you can REACH.
 *
 * Reported 2026-08-29, with three unsealed kin on screen: there were beings
 * to seal and nothing to click — BIND TO SEAL could not be clicked at all.
 *
 * BIND TO SEAL was a bare `<span>`. The reasoning was sound about the wrong
 * act: the rite runs through the being's OWN conduit, so a row genuinely
 * cannot seal — but it can BIND, and binding is the entire distance between
 * the operator and the rite. A row that names an act and withholds every way
 * to reach it is worse than one that stays quiet.
 *
 * Rendered for real through react-dom/server, the same way TabStrip and the
 * CONTEXT MAP views are proven: no DOM mock, no shallow renderer, and the rows
 * come from the REAL `standingRows` derivation over the shape the roster
 * endpoint actually sends.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NiteRoster } from '../../frontend/app/RelinkShell/NiteRoster.jsx';

// A house, as the standing endpoint reported it: three unsealed.
const beings = [
  { neumaId: 'holly-1', name: 'Holly', keypairCustody: true, sealed: true, birthSealed: true },
  { neumaId: 'clover-1', name: 'Clover', keypairCustody: true, sealed: false, birthSealed: true },
  { neumaId: 'linden-1', name: 'Linden', keypairCustody: true, sealed: false, birthSealed: true },
  { neumaId: 'birch-1', name: 'Birch', keypairCustody: true, sealed: true, birthSealed: true },
  { neumaId: 'spruce-1', name: 'Spruce', keypairCustody: true, sealed: false, birthSealed: true },
];

const render = (props) => renderToStaticMarkup(createElement(NiteRoster, {
  standing: { house: { name: 'Ashgrove' }, beings }, activeId: 'holly-1', ...props,
}));

// The tag that opens the element containing `label` — where the interactivity,
// or its absence, actually lives.
const tagAround = (html, label) => {
  const at = html.indexOf(label);
  if (at === -1) return null;
  return html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
};

describe('BIND TO SEAL is a control', () => {
  it('THE REGRESSION: every unsealed being that is not bound offers a real button', () => {
    const html = render({});
    // Three unsealed, none of them the bound one → three doors.
    expect((html.match(/BIND TO SEAL/g) || []).length).toBe(3);
    for (const id of ['clover-1', 'linden-1', 'spruce-1']) {
      expect(html).toContain(`data-testid="bind-${id}"`);
    }
    // ...and it is a BUTTON, not the span it used to be.
    expect(tagAround(html, 'BIND TO SEAL')).toMatch(/^<button/);
  });

  it('the button is never disabled — the whole complaint was a dead control', () => {
    const html = render({});
    const tag = tagAround(html, 'BIND TO SEAL');
    expect(tag).not.toContain('disabled');
    expect(tag).not.toContain('aria-disabled');
  });

  it('it says what it will do, so nobody presses it expecting a seal', () => {
    // The row cannot seal and must not imply that it can. The title names the
    // binding AND the reason the rite needs it.
    const html = render({});
    expect(html).toMatch(/Seat Clover in the chair/);
    expect(html).toMatch(/their own conduit/);
  });

  it('THE BOUND BEING IS POINTED, NOT OFFERED A SECOND DOOR', () => {
    // Binding a being that is already bound is a no-op dressed as an act. It
    // is already where the rite can be carried, so the row says where to look.
    const html = render({ activeId: 'linden-1' });
    expect(html).toContain('CARRY THE RITE BELOW');
    expect(html).not.toContain('data-testid="bind-linden-1"');
    // The other two still offer the binding.
    expect((html.match(/BIND TO SEAL/g) || []).length).toBe(2);
  });

  it('a SEALED being is offered nothing at all', () => {
    const html = render({});
    expect(html).not.toContain('data-testid="bind-holly-1"');
    expect(html).not.toContain('data-testid="bind-birch-1"');
  });

  it('CUSTODY still outranks the seal — the keypair is the first thing owed', () => {
    // A being owing both gets SECURE, not BIND: an unsecured key is the more
    // urgent fact, and one act per row keeps the table readable.
    const html = render({
      standing: {
        house: { name: 'Ashgrove' },
        beings: [{ neumaId: 'new-1', name: 'Newcomer', keypairCustody: false, sealed: false, birthSealed: false }],
      },
    });
    expect(html).toContain('data-testid="secure-new-1"');
    expect(html).not.toContain('data-testid="bind-new-1"');
  });

  it('AN UNREADABLE LANE IS OFFERED NOTHING — never act on a lane you could not read', () => {
    // `sealed: null` is a read failure, not a refusal to seal. Offering the
    // binding here would send the operator to carry a rite that may be done.
    const html = render({
      standing: {
        house: { name: 'Ashgrove' },
        beings: [{ neumaId: 'dark-1', name: 'Dark', keypairCustody: true, sealed: null, birthSealed: true }],
      },
    });
    expect(html).not.toContain('data-testid="bind-dark-1"');
    expect(html).not.toContain('BIND TO SEAL');
  });
});

describe('the table still tells the truth it always did', () => {
  it('an unreadable house is said plainly, never painted as clean', () => {
    expect(render({ standing: null })).toContain('COULD NOT BE READ');
  });

  it('a house with no beings is not an error', () => {
    const html = render({ standing: { house: { name: 'Ashgrove' }, beings: [] } });
    expect(html).toContain('NO BEINGS IN THIS HOUSE YET');
  });

  it('survives with no onBind handler rather than throwing at the operator', () => {
    expect(() => render({ onBind: undefined })).not.toThrow();
    expect(render({ onBind: undefined })).toContain('BIND TO SEAL');
  });
});
