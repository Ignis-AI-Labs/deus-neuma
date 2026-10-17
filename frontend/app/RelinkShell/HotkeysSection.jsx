// HotkeysSection — the legend of every key the desk answers to, inside
// Settings. Renderer shortcuts come from the pure registry; app-level
// accelerators arrive over the preload bridge (electron/hotkeys.cjs is the
// single source — the same table the application menu binds), so a browser
// tab honestly shows no DESK group at all.

import { legendGroups } from '../../services/hotkey-legend.js';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const KeyCombo = ({ keys, hint }) => (
  <span className="settings-hk-combo">
    {keys.map((k, i) => (
      // A combo's chips are positional; keys can repeat (never reorder).
      // eslint-disable-next-line react/no-array-index-key
      <span key={i} className="settings-hk-part">
        {i > 0 ? <span className="settings-hk-plus" aria-hidden="true">+</span> : null}
        <kbd className="settings-key">{k}</kbd>
      </span>
    ))}
    {hint ? <span className="settings-hk-hint">{hint}</span> : null}
  </span>
);

export const HotkeysSection = () => {
  const { t } = useTranslation('settings');
  const [groups, setGroups] = useState(() => legendGroups(null, null));
  useEffect(() => {
    const bridge = window.neuma;
    if (typeof bridge?.hotkeys !== 'function') return; // browser tab — renderer keys only
    bridge.hotkeys()
      .then((rows) => setGroups(legendGroups(rows, bridge.platform)))
      .catch(() => { /* bridge hiccup — the renderer legend stands */ });
  }, []);

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('hotkeys.heading')}</div>
      <p className="settings-note">{t('hotkeys.note')}</p>
      <div className="settings-hotkeys">
        {groups.map((g) => (
          <div key={g.group} className="settings-hk-group">
            <div className="label-data settings-hk-title">{g.group}</div>
            <ul className="settings-hk-list">
              {g.entries.map((e) => (
                <li key={`${e.keys.join('+')}|${e.does}`} className="settings-hk-row">
                  <KeyCombo keys={e.keys} hint={e.hint} />
                  <span className="settings-hk-does">{e.does}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};
