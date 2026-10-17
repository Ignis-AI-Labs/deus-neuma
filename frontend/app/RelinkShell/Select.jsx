// Select — the one LINE & CYCLE dropdown. Never a native <select>: the OS
// paints a native dropdown's open panel and it cannot be styled, so it lands
// as a bright foreign rectangle in the void (seen live). This one is
// chamfered and monochrome like every other surface — SIGNAL marks the chosen
// option, a hairline frame, a chevron that flips open — and it is fully
// keyboard-operable (arrows to move, Enter/Space to choose, Escape to close).
//
// The single source for every dropdown in the app; the bespoke copies that
// predated it (the vessel kind picker, the task cadence picker) are the same
// shape and should fold into this.

import { useEffect, useMemo, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import './Select.css';

/**
 * @param {object} props
 * @param {string} props.value the selected option's value ('' = none)
 * @param {Array<{value: string, label: string, disabled?: boolean}>} props.options
 * @param {(value: string) => void} props.onChange
 * @param {() => void} [props.onOpen] Refresh choices on mouse or keyboard opening.
 * @param {string} [props.placeholder] shown on the trigger when nothing matches value
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.fill] flex-fill the container (row usage, like an input)
 * @param {string} [props.ariaLabel]
 * @param {string} [props.id] trigger id — for a label's htmlFor, or an e2e hook
 * @param {string} [props.className] extra classes on the root
 */
export const Select = ({
  value, options, onChange, placeholder, disabled = false,
  fill = false, ariaLabel, id, className = '', onOpen,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value],
  );

  // Close on Escape or a press anywhere outside — the desk's own manners.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // On open, move focus onto the current selection (or the first enabled
  // option) so the arrows work immediately — roving focus, no active index.
  useEffect(() => {
    if (!open) return;
    const start = options.findIndex((o) => o.value === value && !o.disabled);
    const idx = start >= 0 ? start : options.findIndex((o) => !o.disabled);
    if (idx >= 0) optionRefs.current[idx]?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPanel = () => {
    if (disabled) return;
    uiSound('tick');
    setOpen(true);
    onOpen?.();
  };

  const choose = (option) => {
    if (option.disabled) return;
    uiSound('toggle');
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Roving focus across the enabled options while the panel is open.
  const step = (from, dir) => {
    const n = options.length;
    for (let i = 1; i <= n; i += 1) {
      const j = (from + dir * i + n * i) % n;
      if (!options[j].disabled) return j;
    }
    return from;
  };

  const onTriggerKey = (e) => {
    if (disabled) return;
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openPanel();
    }
  };

  const onOptionKey = (e, index) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      optionRefs.current[step(index, e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      optionRefs.current[e.key === 'Home' ? step(-1, 1) : step(0, -1)]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(options[index]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const triggerLabel = selected?.label ?? placeholder ?? '—';

  return (
    <div className={`lc-sel${fill ? ' is-fill' : ''}${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`lc-sel-trigger${selected ? '' : ' is-placeholder'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onTriggerKey}
      >
        <span className="lc-sel-value">{triggerLabel}</span>
        <svg className="lc-sel-chev" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M1.5 3 L4 5.5 L6.5 3" />
        </svg>
      </button>
      {open ? (
        // Roving focus: the active option holds real DOM focus, so no
        // aria-activedescendant (and no per-option id that could collide when
        // two id-less Selects share a page) — the two ARIA models don't mix.
        <div className="lc-sel-panel cham" role="listbox" aria-label={ariaLabel}>
          <div className="lc-sel-panel-in cham-in">
            {options.map((o, i) => (
              <button
                key={o.value}
                ref={(el) => { optionRefs.current[i] = el; }}
                type="button"
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                tabIndex={-1}
                className={`lc-sel-opt${o.value === value ? ' is-on' : ''}${o.disabled ? ' is-disabled' : ''}`}
                onClick={() => choose(o)}
                onKeyDown={(e) => onOptionKey(e, i)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
