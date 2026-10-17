// ColourEditor — the palette, grouped by what its colours MEAN.
//
// The old panel drew every role in one flat grid: twenty-five swatches in
// whatever order they sat in the JSON, `bg` beside `bgElev` beside `breakeven`.
// Nothing said that `rise` and `fall` are a pair, or that a colour here carries
// a CLAIM — from stat.svg: […]
//
// Adding a role is possible from here too, which it was not before: the flat
// grid only ever showed roles the kit already had, plus the five the loader
// demands. A brand needing `hairlineSoft` — which the stat card draws — had no
// way to say so except the raw JSON.

import { useState } from 'react';
import { bandsOf } from './colour-bands.js';
import { ColourRow } from './ColourRow.jsx';
import { ContrastPanel } from './ContrastPanel.jsx';
import { REQUIRED_COLORS } from './brand-kits-view.js';
import { useKit } from './kit-context.js';

/** A colour role reaches a `{{token.*}}` lookup, so it is a plain name. */
const ROLE = /^[a-z][a-zA-Z0-9]*$/;

export const ColourEditor = () => {
  const { draft, editField, unsetField, templates } = useKit();
  const [typed, setTyped] = useState('');
  const bands = bandsOf(draft, templates?.colors || [], REQUIRED_COLORS);

  const add = () => {
    const role = typed.trim();
    if (!ROLE.test(role) || draft?.colors?.[role]) return;
    editField(`colors.${role}`, '#000000');
    setTyped('');
  };

  return (
    <div className="bk-colour">
      {bands.map((band) => (
        <section key={band.id} className="bk-band-sec">
          <h5 className="label-data">{band.label} <em>{band.why}</em></h5>
          <div className="bk-crows">
            {band.rows.map((row) => (
              <ColourRow key={row.role} row={row} onChange={editField} onUnset={unsetField} />
            ))}
          </div>
        </section>
      ))}

      <span className="bk-list-add">
        <input
          type="text"
          value={typed}
          placeholder="another role — bgSoft, breakeven"
          spellCheck="false"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add} disabled={!ROLE.test(typed.trim())}>ADD A ROLE</button>
      </span>

      <ContrastPanel kit={draft} />
    </div>
  );
};
