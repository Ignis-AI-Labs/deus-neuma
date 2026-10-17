// InferenceSection — how a neuma is run: the active model, its context window,
// and the SAMPLING MODE.
//
// The mode used to be three buttons above the composer, switchable per turn. It
// came home here (Design note, 2026-07-26: […]) because that is what it always
// was — a standing default, not a per-message decision. The composer's bar now
// carries the per-being knobs that DO change with the work: model, effort, ULTRA.
// A turn reads this default server-side, so a change lands on the very next
// message with no window to reload.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPresets, getPreset, setPreset, getModelInfo } from '../../services/llm-presets.js';
import { useSettled } from './use-settled.js';
import { uiSound } from '../../services/ui-sound.js';

export const InferenceSection = () => {
  const { t } = useTranslation('settingsModels');
  const [modes, setModes] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);
  const [error, setError] = useState(null);

  useSettled((settled) => {
    getPresets().then((v) => { if (!settled()) setModes(v); });
    getPreset().then((v) => { if (!settled()) setChosen(v); });
    getModelInfo().then((v) => { if (!settled()) setModelInfo(v); });
  }, []);

  // The chosen mode is shown from the SERVER's answer, so a failed save never
  // leaves the panel claiming a default that was not stored.
  const pick = async (name) => {
    if (name === chosen) return;
    uiSound('activate');
    setError(null);
    try {
      setChosen(await setPreset(name));
    } catch (err) {
      setError(err?.message || t('inference.didNotChange'));
    }
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('inference.heading')}</div>
      <p className="settings-note">{t('inference.note')}</p>

      {modelInfo ? (
        <div className="settings-realm">
          <div className="settings-row">
            <span className="settings-k">{t('inference.modelKey')}</span>
            <code className="settings-v">{modelInfo.model}</code>
          </div>
          <div className="settings-row">
            <span className="settings-k">{t('inference.contextKey')}</span>
            <span className="settings-v">
              {typeof modelInfo.contextLength === 'number'
                ? t('inference.tokens', { count: modelInfo.contextLength.toLocaleString() })
                : modelInfo.contextLength}
              {t('inference.contextNote')}
            </span>
          </div>
        </div>
      ) : null}

      {error ? <p className="settings-err">{error}</p> : null}

      {modes.length ? (
        <ul className="settings-modes" role="group" aria-label={t('inference.modesAria')}>
          {modes.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                className={`settings-mode-pick${chosen === m.name ? ' is-on' : ''}`}
                aria-pressed={chosen === m.name}
                onClick={() => pick(m.name)}
              >
                <span className="settings-mode-label label-data">{m.label}</span>
                <span className="settings-mode-blurb">{m.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
