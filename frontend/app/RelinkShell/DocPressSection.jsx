// DocPressSection — THE PRESS inside Settings.
//
// Press any markdown into a branded PDF using the brand kits configured on
// this machine (data/brand-kits/). Pick a .md file or paste markdown, choose
// the kit, press, and the PDF downloads. Rendering happens locally on the
// backend (real Chromium, no egress); beings press through their own
// ACTS-gated press_document tool, not this surface.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { getPressBoard, pressMarkdown } from '../../services/doc-press-client.js';

// impure — hands the pressed bytes to the browser as a download
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const DocPressSection = () => {
  const { t } = useTranslation('settings');
  const [board, setBoard] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [markdown, setMarkdown] = useState('');
  const [title, setTitle] = useState('');
  const [kitId, setKitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pressedNote, setPressedNote] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    getPressBoard()
      .then((b) => { setBoard(b); setLoadError(null); })
      .catch((e) => setLoadError(e.message));
  }, []);

  const onPickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMarkdown(await file.text());
    if (!title) setTitle(file.name.replace(/\.(md|markdown)$/i, ''));
    event.target.value = '';
  };

  const onPress = async () => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    setPressedNote(null);
    try {
      const { blob, filename } = await pressMarkdown({
        markdown,
        title: title || undefined,
        kitId: kitId || undefined,
      });
      downloadBlob(blob, filename);
      setPressedNote(t('press.pressed', { filename, size: (blob.size / 1024).toFixed(0) }));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('press.heading')}</div>
      <p className="settings-note">{t('press.note')}</p>

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {board && !board.chromium.available ? (
        <p className="settings-err">{t('press.noChromium')}</p>
      ) : null}

      {board ? (
        <div className="settings-realm">
          <div className="settings-row">
            <span className="settings-k">{t('press.kits')}</span>
            <span className="settings-v">
              {board.kits.length === 0
                ? t('press.kitsNone')
                : board.kits.map((k) => k.id).join(', ')}
            </span>
          </div>

          <div className="settings-control">
            <button
              type="button"
              className="settings-set"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {t('press.pickFile')}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".md,.markdown,text/markdown"
              style={{ display: 'none' }}
              onChange={onPickFile}
            />
          </div>

          <div className="settings-control">
            <textarea
              className="settings-input"
              rows={6}
              placeholder={t('press.pastePlaceholder')}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="settings-control">
            <input
              className="settings-input"
              type="text"
              placeholder={t('press.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
            <Select
              fill
              ariaLabel={t('press.kitAria')}
              value={kitId}
              onChange={setKitId}
              disabled={busy}
              options={[
                { value: '', label: t('press.kitNeutral') },
                ...board.kits.map((k) => ({ value: k.id, label: k.name || k.id })),
              ]}
            />
            <button
              type="button"
              className="settings-set"
              disabled={busy || markdown.trim() === '' || !board.chromium.available}
              onClick={onPress}
            >
              {busy ? t('press.pressing') : t('press.press')}
            </button>
          </div>

          {pressedNote ? <p className="settings-note">{pressedNote}</p> : null}
          {error ? <p className="settings-err">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
};
