// ColourRow — one colour role: a picker, an alpha, and what it is for.
//
// TWO THINGS THE OLD ROW COULD NOT DO.
//
// It only offered a native picker for exactly #rrggbb, so every `rgba(...)`
// value — a third of Umbrae's palette, including every soft ink and both
// hairlines — got a dead chip and a bare text box. Here the hue and the alpha
// are separated and recomposed, in the format the value arrived in.
//
// And it badged nothing. There are TWO requirements on a colour role and they
// differ by nine roles: the LOADER refuses a save without five of them, and the
// TEMPLATES refuse a CARD without fourteen. A kit missing `hairlineSoft` saves
// perfectly and cannot draw the stat card, so the badge names the templates
// that go dark rather than just saying "required".

import { HexField } from '../HexField.jsx';
import { isRenderableColor } from './brand-kits-view.js';
import { hueOf, alphaOf, formatOf, recompose } from './rgba.js';

export const ColourRow = ({ row, onChange, onUnset }) => {
  const { role, value, required, templates } = row;
  const hue = hueOf(value);
  const alpha = alphaOf(value);
  const format = formatOf(value);
  const bad = value && !isRenderableColor(value);

  const put = (nextHue, nextAlpha) => onChange(`colors.${role}`, recompose(nextHue, nextAlpha, format));

  return (
    <div className="bk-crow">
      <span className="bk-crow-name label-data">
        {role}
        {required ? <b className="bk-badge is-req" title="the renderer refuses to load a kit without this">LOADER</b> : null}
        {templates ? (
          <b className="bk-badge is-tpl" title={`drawn by ${templates.join(', ')} — those cards refuse without it`}>
            {templates.length === 6 ? 'ALL CARDS' : templates.join(' ')}
          </b>
        ) : null}
      </span>

      <span className="bk-crow-edit">
        {hue ? (
          <input
            type="color"
            value={hue}
            aria-label={`${role} colour`}
            onChange={(e) => put(e.target.value, alpha)}
          />
        ) : (
          <span className="bk-color-chip is-empty" aria-hidden="true" />
        )}

        {/* ⚠️ The kit's rule, not THE LOOK's. A brand accepts everything the
            CARD RENDERER accepts, so `rgba(247,243,234,0.66)` commits as
            itself — the hex-only default would reject it and revert, which
            would make a third of Umbrae's palette untypeable. And no
            uppercasing: `rgba(...)` shouted back is not how anyone writes it. */}
        <HexField
          value={value || ''}
          ariaLabel={`${role} value`}
          placeholder="#000000 or rgba(0,0,0,0.5)"
          className={bad ? 'is-bad' : ''}
          accept={isRenderableColor}
          normalize={(raw) => raw}
          onCommit={(next) => onChange(`colors.${role}`, next)}
        />

        {/* Only where there is something to move. A slider pinned at 1 on every
            opaque role would be twenty-odd controls that do nothing. */}
        {hue && alpha < 1 ? (
          <label className="bk-alpha">
            <input
              type="range"
              min="0" max="1" step="0.01"
              value={alpha}
              aria-label={`${role} opacity`}
              onChange={(e) => put(hue, Number(e.target.value))}
            />
            <span className="label-data">{Math.round(alpha * 100)}%</span>
          </label>
        ) : null}

        {value ? (
          <button
            type="button"
            className="bk-list-del"
            aria-label={`remove ${role}`}
            title="drop this role from the kit"
            onClick={() => onUnset(`colors.${role}`)}
          >
            ×
          </button>
        ) : null}
      </span>
    </div>
  );
};
