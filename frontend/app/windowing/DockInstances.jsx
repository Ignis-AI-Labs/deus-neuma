// DockInstances — the drop-up a multi-window taskbar button opens on hover.
//
// Design note, 2026-10-23: […] One row per open window,
// in the order the button's clicks step through them (instance-cycle.js), the
// focused one in SIGNAL — the same dot-and-tint marks the dock's menus always
// used. A row's name is the app's own: its `InstanceLabel` when it gives one
// (a stream names its being and chat), else its window title, else LABEL N.
// Ledger: docs/work/dock-stream-cycle.md.

import { useTranslation } from 'react-i18next';
import { instanceOrdinal } from './window-manager-reducer.js';

const fallbackOf = (app, row) => {
  const ordinal = instanceOrdinal(row.id);
  if (app.makeTitle) return app.makeTitle(ordinal, row.payload);
  return ordinal > 1 ? `${app.label} ${ordinal}` : app.label;
};

// Arrow keys walk the rows (wrapping); Escape hands focus back to the button.
const onKeys = (onEscape) => (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement);
  const step = e.key === 'ArrowDown' ? 1 : -1;
  e.preventDefault();
  items[(at + step + items.length) % items.length]?.focus();
};

/**
 * @param {{app: object, rows: Array<{id: string, focused: boolean, payload?: string}>,
 *   place: object, onPick: (id: string) => void, onEnter: Function, onLeave: Function,
 *   onBlur: Function, onEscape: Function}} p
 */
export const DockInstances = ({ app, rows, place, onPick, onEnter, onLeave, onBlur, onEscape }) => {
  const { t } = useTranslation('taskbar');
  const Label = app.InstanceLabel;
  return (
    <div
      className="taskbar-instances dock-menu cham"
      role="menu"
      aria-label={t('windowsOf', { app: app.label })}
      style={place}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onBlur={onBlur}
      onKeyDown={onKeys(onEscape)}
    >
      <div className="dock-menu-in cham-in">
        {rows.map((row) => {
          const fallback = fallbackOf(app, row);
          return (
            <button
              key={row.id}
              type="button"
              role="menuitem"
              data-window-id={row.id}
              className={`dock-menu-item is-open${row.focused ? ' is-focused' : ''}`}
              aria-current={row.focused ? 'true' : undefined}
              onClick={() => onPick(row.id)}
            >
              <span className="dock-menu-label label-data taskbar-instance-label">
                {Label ? <Label windowId={row.id} fallback={fallback} /> : fallback}
              </span>
              <span className="dock-menu-dot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
