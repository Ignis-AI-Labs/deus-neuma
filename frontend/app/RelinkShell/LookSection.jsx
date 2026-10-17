// LookSection — THE LOOK: the witness dresses the platform. Four required
// knobs (GROUND, PANEL, INK, TRIM) plus optional voices. Unclaimed voices
// ride the ink (or the stylesheet, for the registers). × releases one.

import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { STOCK_LOOK, STOCK_FACES, isSameLook } from '../../utils/look-derive.js';
import { HexField } from './HexField.jsx';
import { TextSizeControl } from './TextSizeControl.jsx';
import { STOCK_PRESETS } from '../../utils/look-presets.js';
import {
  applyLook, getLook, setLookTheme, saveLookPreset, deleteLookPreset,
} from '../../services/look.js';

const TEXT_VOICES = Object.freeze(['head', 'body', 'ital', 'emph', 'line']);

const GROUPS = [
  { id: 'surface', knobs: [{ key: 'ground' }, { key: 'panel' }] },
  { id: 'text', knobs: [
    { key: 'ink' },
    { key: 'head', optional: true },
    { key: 'body', optional: true },
    { key: 'ital', optional: true },
    { key: 'emph', optional: true },

    { key: 'folder', optional: true },
    { key: 'line', optional: true },
  ] },
  { id: 'signal', knobs: [{ key: 'trim' }] },
  { id: 'registers', knobs: [
    { key: 'alert', optional: true },
    { key: 'warn', optional: true },
    { key: 'okay', optional: true },
  ] },
];

const CHIP_KEYS = ['ground', 'panel', 'ink', 'trim', 'head'];

const knobValue = (draft, key) =>
  draft[key] ?? (TEXT_VOICES.includes(key) ? draft.ink : (STOCK_FACES[key] ?? draft.ink));

const PERSIST_MS = 400;

// The hex field moved to HexField.jsx on 2026-08-31, when the rebuilt BRAND
// KITS panel needed the same commit-on-Enter-or-blur control. Its default rule
// is still this one: six hex digits, '#' optional on entry, stored uppercase.

const PresetRow = ({ preset, active, onPick, onRemove }) => {
  const { t } = useTranslation('settingsLook');
  return (
  <li>
    <button
      type="button"
      className={`settings-look-preset${active ? ' is-on' : ''}`}
      onClick={() => onPick(preset.theme)}
    >
      <span className="settings-look-strip" aria-hidden="true">
        {CHIP_KEYS.map((key) => (
          <span key={key} className="settings-look-chip" style={{ background: preset.theme[key] ?? preset.theme.ink }} />
        ))}
      </span>
      <span className="settings-look-name">{preset.name}</span>
    </button>
    {onRemove ? (
      <button
        type="button"
        className="settings-backup-del"
        aria-label={t('yourPresets.removeAria', { name: preset.name })}
        onClick={() => onRemove(preset.id)}
      >
        ×
      </button>
    ) : null}
  </li>
  );
};

export const LookSection = () => {
  const { t } = useTranslation('settingsLook');
  const [draft, setDraft] = useState(STOCK_LOOK);
  const [presets, setPresets] = useState([]);
  const [nameInput, setNameInput] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLook()
      .then((state) => { setPresets(state.presets); if (state.theme) setDraft(state.theme); })
      .catch((e) => setError(e.message));
  }, []);

  // A deliberate act (a hex commit, a preset pick) persists IMMEDIATELY —
  // waiting on a debounce loses the dress to a quick close or reload. Only
  // the color-picker's drag stream debounces: it fires per tick, and the
  // store deserves one write per settled choice. The pending drag write
  // flushes on unmount so a quick close never loses it either.
  const pending = useRef(null);
  const timer = useRef(null);
  const persist = () => {
    if (pending.current === null) return;
    const { theme } = pending.current;
    pending.current = null;
    setLookTheme(theme).catch((e) => setError(e.message));
  };
  useEffect(() => () => { clearTimeout(timer.current); persist(); }, []);

  const commit = (next, { settle = true } = {}) => {
    setDraft(next);
    setError(null);
    const stock = isSameLook(next, STOCK_LOOK);
    applyLook(stock ? null : next);
    clearTimeout(timer.current);
    pending.current = { theme: stock ? null : next };
    if (settle) { persist(); return; }
    timer.current = setTimeout(persist, PERSIST_MS);
  };

  const setKnob = (key, hex, opts) => commit({ ...draft, [key]: hex.toUpperCase() }, opts);
  // Release an optional voice back to stock — the knob leaves the dress.
  const release = (key) => {
    uiSound('toggle');
    const { [key]: gone, ...rest } = draft;
    commit(rest);
  };
  const pick = (theme) => { uiSound('activate'); commit({ ...theme }); };

  const save = async () => {
    const name = nameInput.trim();
    if (!name) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      const state = await saveLookPreset(name, draft);
      setPresets(state.presets);
      setNameInput('');
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const remove = async (id) => {
    uiSound('toggle');
    setError(null);
    try {
      setPresets((await deleteLookPreset(id)).presets);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <TextSizeControl />
      <section className="settings-sec">
        <div className="label-data settings-h">{t('heading')}</div>
        <p className="settings-note">{t('note')}</p>

        <div className="settings-look-rows">
          {GROUPS.map((group) => (
            <div className="settings-look-group" key={group.id}>
              <div className="settings-look-group-h label-data">
                {t(`groups.${group.id}.title`)}
                <span className="settings-look-group-note">{t(`groups.${group.id}.note`)}</span>
              </div>
              {group.knobs.map(({ key, optional }) => {
                const label = t(`knobs.${key}.label`);
                return (
                <div className="settings-look-row" key={key}>
                  <span className="settings-k">{label}</span>
                  <input
                    className="settings-look-swatch"
                    type="color"
                    value={knobValue(draft, key).toLowerCase()}
                    aria-label={t('knobs.colorAria', { label })}
                    onChange={(e) => setKnob(key, e.target.value, { settle: false })}
                  />
                  <HexField value={knobValue(draft, key)} ariaLabel={t('knobs.hexAria', { label })} onCommit={(hex) => setKnob(key, hex)} />
                  {optional && draft[key] != null ? (
                    <button
                      type="button"
                      className="settings-backup-del"
                      aria-label={t('knobs.releaseAria', { label })}
                      title={t('knobs.releaseTitle')}
                      onClick={() => release(key)}
                    >
                      ×
                    </button>
                  ) : null}
                  <span className="settings-look-hint">{t(`knobs.${key}.hint`)}</span>
                </div>
                );
              })}
            </div>
          ))}
        </div>
        {error ? <p className="settings-err">{error}</p> : null}
        <div className="settings-look-group" style={{ marginTop: 'var(--space-4)' }}>
          <div className="settings-look-group-h label-data">
            {t('specimen.heading')}
            <span className="settings-look-group-note">{t('specimen.note')}</span>
          </div>
          <h3 className="settings-h" style={{ border: 'none', padding: 0, margin: 'var(--space-2) 0' }}>{t('specimen.headingVoice')}</h3>
          <p className="settings-note" style={{ margin: 0 }}>
            <Trans
              i18nKey="specimen.body"
              components={{
                em: <em />,
                strong: <strong />,
                a: <a href="#look" onClick={(e) => e.preventDefault()} />,
              }}
            />
          </p>
        </div>

      </section>

      <section className="settings-sec">
        <div className="label-data settings-h">{t('presets.heading')}</div>
        <p className="settings-note">{t('presets.note')}</p>
        <ul className="settings-look-presets">
          {STOCK_PRESETS.map((p) => (
            <PresetRow key={p.id} preset={p} active={isSameLook(draft, p.theme)} onPick={pick} />
          ))}
        </ul>
      </section>

      <section className="settings-sec">
        <div className="label-data settings-h">{t('yourPresets.heading')}</div>
        <p className="settings-note">{t('yourPresets.note')}</p>

        <div className="settings-control">
          <input
            className="settings-input"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            placeholder={t('yourPresets.placeholder')}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="settings-set" onClick={save} disabled={busy || !nameInput.trim()}>
            {t('yourPresets.save')}
          </button>
        </div>
        {presets.length ? (
          <ul className="settings-look-presets">
            {presets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                active={isSameLook(draft, p.theme)}
                onPick={pick}
                onRemove={remove}
              />
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
};
