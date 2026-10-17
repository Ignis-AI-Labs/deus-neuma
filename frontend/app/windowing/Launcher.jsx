// Launcher — every app on the desk, found by what it is for or by typing.
//
// Opened from the taskbar's first button or Ctrl+Space (Taskbar.jsx). A search
// box takes focus at once: typing filters to the matching apps, Enter opens the
// first. Empty, it shows every app as an icon tile under its category
// (taskbar-model.js LAUNCHER_CATEGORIES). Right-click a tile to pin or unpin it.
// Its foot keeps the old start menu's acts: a new desk window, and disconnect.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLocale } from '../../i18n/active-locale.js';
import { launcherSections, searchApps } from './taskbar-model.js';
import { DockDisconnect } from './DockDisconnect.jsx';

const NewDeskGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <rect x="1.5" y="4" width="8.5" height="8.5" />
    <path d="M4 4 V1.5 H12.5 V10 H10" />
  </svg>
);

const Tile = ({ id, app, state, pinned, onOpen, onMenu }) => (
  <button
    type="button"
    className={`launcher-tile is-${state}${pinned ? ' is-pinned' : ''}`}
    data-app-id={id}
    onClick={() => onOpen(id)}
    onContextMenu={(e) => { e.preventDefault(); onMenu(id, e); }}
    title={app.label}
  >
    <span className="launcher-tile-icon">{app.icon}</span>
    <span className="launcher-tile-label label-data">{app.label}</span>
  </button>
);

/**
 * @param {object} p
 * @param {Array<[string, object]>} p.entries launchable [id, app] (labels localized)
 * @param {(id:string)=>string} p.stateOf closed | open | focused
 * @param {string[]} p.pins
 * @param {(id:string)=>void} p.onOpen
 * @param {(id:string, e:MouseEvent)=>void} p.onMenu
 * @param {()=>void} p.onNewDesk
 * @param {()=>void} p.onDisconnect
 * @param {()=>void} p.onClose
 */
export const Launcher = ({ entries, stateOf, pins, onOpen, onMenu, onNewDesk, onDisconnect, onClose }) => {
  const { t } = useTranslation('taskbar');
  const [query, setQuery] = useState('');
  const sections = useMemo(() => launcherSections(entries, currentLocale()), [entries]);
  const found = useMemo(() => searchApps(entries, query), [entries, query]);
  const searching = query.trim().length > 0;

  const tile = ([id, app]) => (
    <Tile key={id} id={id} app={app} state={stateOf(id)} pinned={pins.includes(id)} onOpen={onOpen} onMenu={onMenu} />
  );

  const onKey = (e) => {
    if (e.key === 'Enter' && found.length > 0) { e.preventDefault(); onOpen(found[0][0]); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div className="launcher cham" role="dialog" aria-label={t('launcher')}>
      <div className="launcher-in cham-in">
        <input
          className="launcher-search"
          type="search"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the launcher exists to be typed into
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('search')}
          aria-label={t('search')}
          spellCheck={false}
        />
        <div className="launcher-body">
          {searching ? (
            found.length > 0
              ? <div className="launcher-grid">{found.map(tile)}</div>
              : <p className="launcher-empty label-data">{t('noMatch', { q: query.trim() })}</p>
          ) : sections.map((s) => (
            <section key={s.id} className="launcher-section" data-category={s.id}>
              <h3 className="launcher-section-head label-data">{t(`cats.${s.id}`)}</h3>
              <div className="launcher-grid">{s.items.map(tile)}</div>
            </section>
          ))}
        </div>
        <div className="launcher-foot" role="menu" aria-label={t('launcher')}>
          {onNewDesk ? (
            <button type="button" className="dock-menu-item" onClick={onNewDesk}>
              <span className="dock-menu-icon"><NewDeskGlyph /></span>
              <span className="dock-menu-label label-data">{t('newDesk')}</span>
            </button>
          ) : null}
          <DockDisconnect onDisconnect={onDisconnect} />
        </div>
      </div>
    </div>
  );
};
