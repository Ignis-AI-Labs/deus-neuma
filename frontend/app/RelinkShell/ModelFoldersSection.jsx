// ModelFoldersSection — the AUTHORIZED MODEL FOLDERS in SETTINGS → MODELS.
//
// The folder law (Design note, 2026-08-28: the folder you chose IS the
// authorization — the platform lists and loads models from these folders and
// nowhere else, and each folder names which serving engines may load from
// it. Simple by design: install models into a dedicated folder (or point at
// the folders you already keep), and authorization is done.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getModelFolders, setModelFoldersClient } from '../../services/inference.js';
import { announceSubstrateChange } from './substrate-change.js';
import { useSettled } from './use-settled.js';
import { uiSound } from '../../services/ui-sound.js';

export const ModelFoldersSection = () => {
  const { t } = useTranslation('settingsModels');
  const [view, setView] = useState(undefined); // undefined loading · null unreadable
  const [newPath, setNewPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useSettled((settled) => {
    getModelFolders().then((v) => { if (!settled()) setView(v); });
  }, []);

  const save = async (folders) => {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const next = await setModelFoldersClient(folders);
      setView((v) => ({ ...(v || {}), ...next }));
      uiSound('activate');
      // Every model bar re-reads its catalog — the wall just moved.
      announceSubstrateChange('change');
    } catch (err) {
      setNote(err?.message || t('folders.storeRefused'));
    }
    setBusy(false);
  };

  const addFolder = () => {
    const path = newPath.trim();
    if (!path || !view) return;
    setNewPath('');
    save([...(view.folders || []), { path }]);
  };

  const removeFolder = (path) => {
    if (!view) return;
    uiSound('toggle');
    save((view.folders || []).filter((f) => f.path !== path));
  };

  const toggleServer = (folder, server) => {
    if (!view) return;
    const servers = folder.servers.includes(server)
      ? folder.servers.filter((s) => s !== server)
      : [...folder.servers, server];
    if (servers.length === 0) {
      setNote(t('folders.oneEngineLeft'));
      return;
    }
    save((view.folders || []).map((f) => (f.path === folder.path ? { ...f, servers } : f)));
  };

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('folders.heading')}</div>
      <p className="settings-note">{t('folders.note')}</p>
      {view === undefined ? <p className="settings-note">{t('folders.loading')}</p> : null}
      {view === null ? <p className="settings-note">{t('folders.unreadable')}</p> : null}
      {view ? (
        <>
          {(view.folders || []).map((folder) => (
            <div key={folder.path} className="settings-row">
              <code className="settings-v">{folder.path}</code>
              <span className="settings-k">
                {(view.servers || []).map((server) => (
                  <button
                    key={server}
                    type="button"
                    className={`settings-set${folder.servers.includes(server) ? ' is-on' : ''}`}
                    aria-pressed={folder.servers.includes(server)}
                    disabled={busy}
                    title={folder.servers.includes(server)
                      ? t('folders.serverMay', { server })
                      : t('folders.serverMayNot', { server })}
                    onClick={() => toggleServer(folder, server)}
                  >{server.toUpperCase()}</button>
                ))}
                <button
                  type="button"
                  className="settings-set"
                  aria-label={t('folders.removeAria', { path: folder.path })}
                  disabled={busy}
                  onClick={() => removeFolder(folder.path)}
                >✕</button>
              </span>
            </div>
          ))}
          <div className="settings-control">
            <input
              className="settings-input"
              type="text"
              placeholder="/absolute/path/to/your/models"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); }}
              spellCheck={false}
              aria-label={t('folders.pathAria')}
            />
            <button type="button" className="settings-set" disabled={busy || !newPath.trim()} onClick={addFolder}>
              {t('folders.add')}
            </button>
          </div>
        </>
      ) : null}
      {note ? <p className="settings-note" role="status">{note}</p> : null}
    </section>
  );
};
