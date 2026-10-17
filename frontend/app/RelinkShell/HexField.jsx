// HexField — a colour typed as text, committed only when it is a colour.
//
// Lifted out of LookSection.jsx on 2026-08-31, when the rebuilt BRAND KITS
// panel needed the same control. Two callers now: THE LOOK's knobs, and every
// colour role in a brand kit.
//
// COMMIT ON ENTER OR BLUR, NEVER PER KEYSTROKE. Typing "#22d3ee" passes through
// "#2", "#22", "#22d"… each of which is a real colour or a broken one, and
// writing every intermediate state would repaint the app (or refuse a card
// preview) five times per value. An entry that never becomes valid reverts to
// what was there rather than clearing it — a half-typed hex should not be able
// to erase a colour.
//
// WHAT A COLOUR IS, IS THE CALLER'S BUSINESS. THE LOOK holds its knobs to
// #rrggbb, because a theme knob drives CSS variables it controls. A brand kit
// accepts everything the CARD RENDERER accepts — #rgb, #rrggbb, #rrggbbaa,
// rgb() and rgba() — because a third of Umbrae's palette is translucent and
// forcing those to hex would silently drop their alpha.

import { useEffect, useState } from 'react';
import { HEX_RE } from '../../utils/look-derive.js';

/** THE LOOK's rule: six hex digits, '#' optional on entry, stored uppercase. */
const hexOnly = {
  accept: (raw) => HEX_RE.test(raw.startsWith('#') ? raw : `#${raw}`),
  normalize: (raw) => (raw.startsWith('#') ? raw : `#${raw}`).toUpperCase(),
};

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(next: string) => void} props.onCommit
 * @param {(raw: string) => boolean} [props.accept] defaults to six-digit hex
 * @param {(raw: string) => string} [props.normalize] defaults to '#'-prefix + uppercase
 */
export const HexField = ({
  value, onCommit, ariaLabel, className = '', placeholder,
  accept = hexOnly.accept, normalize = hexOnly.normalize,
}) => {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => {
    const raw = String(text ?? '').trim();
    if (accept(raw)) onCommit(normalize(raw));
    else setText(value);
  };
  return (
    <input
      className={`settings-input settings-look-hex ${className}`.trim()}
      type="text"
      value={text ?? ''}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
};
