// ConnectionsSection — every connection the app makes, and the switch for each one that runs by
// itself (Settings → Security). Design note, 2026-10-25: […] Everything that runs by itself starts OFF; this is where it is turned on.
//
// The rows are the app's one list (electron/connections.json, served by /api/v1/connections) — the
// site reads the same file, so the two say the same words. A flip lands on the backend, and the row
// shows what the backend answered, so a switch never looks flipped before it is.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getConnections, setConnection } from '../../services/connections-client.js';
import './ConnectionsSection.css';

// impure — the desktop bridge, absent in a browser
const desktop = () => (typeof window !== 'undefined' ? window.neuma : undefined);

/** What a Check now press found, as one line's key. Pure. */
const checkLine = (result) => {
  if (result.version) return 'connections.updateFound';
  if (result.ok) return 'connections.upToDate';
  return result.reason ? 'connections.noUpdater' : 'connections.checkFailed';
};

// The whole paragraph the privacy policy carries for this connection, one press away.
const Detail = ({ row, t }) => (
  <details className="conn-detail">
    <summary className="label-data">{t('connections.more')}</summary>
    <p className="conn-line">{row.detail}</p>
  </details>
);

const SwitchedRow = ({ row, busy, onFlip, t }) => {
  const [check, setCheck] = useState(null); // null | 'checking' | { key, version }
  const canCheck = row.id === 'update-check' && Boolean(desktop()?.update?.act);
  const checkNow = async () => {
    uiSound('click');
    setCheck('checking');
    const result = await desktop().update.act('check').catch(() => ({ ok: false }));
    setCheck({ key: checkLine(result), version: result.version });
  };
  return (
    <li className={`conn-row${row.on ? ' is-on' : ''}`} data-connection={row.id}>
      <div className="conn-head">
        <span className="conn-name">{row.name}</span>
        <span className="conn-state label-data">{row.on ? t('connections.on') : t('connections.off')}</span>
      </div>
      <p className="conn-line">{row.to} · {row.when}</p>
      <p className="conn-line">{row.sends}</p>
      {row.on ? null : <p className="conn-line">{t('connections.whileOff', { what: row.whileOff })}</p>}
      <Detail row={row} t={t} />
      <div className="conn-acts">
        <button type="button" className="settings-set" onClick={() => onFlip(row)} disabled={busy}>
          {busy ? t('connections.switching') : row.on ? t('connections.turnOff') : t('connections.turnOn')}
        </button>
        {canCheck ? (
          <button type="button" className="settings-set" onClick={checkNow} disabled={check === 'checking'}>
            {check === 'checking' ? t('connections.checking') : t('connections.checkNow')}
          </button>
        ) : null}
      </div>
      {check && check !== 'checking' ? <p className="conn-line" role="status">{t(check.key, { version: check.version })}</p> : null}
    </li>
  );
};

const UsedRow = ({ row, t }) => (
  <li className="conn-row" data-connection={row.id}>
    <div className="conn-head">
      <span className="conn-name">{row.name}</span>
      {row.control === 'web' ? <span className="conn-state label-data">{row.on ? t('connections.on') : t('connections.off')}</span> : null}
    </div>
    <p className="conn-line">{row.to} · {row.when}</p>
    <p className="conn-line">{row.sends}</p>
    {row.control === 'web' ? <p className="conn-line">{t('connections.webWhere')}</p> : null}
    <Detail row={row} t={t} />
  </li>
);

export const ConnectionsSection = () => {
  const { t } = useTranslation('settingsSecurity');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // the id being switched

  useEffect(() => {
    getConnections().then((r) => setRows(r.connections)).catch((e) => setError(e.message));
  }, []);

  const flip = async (row) => {
    if (busy) return;
    uiSound('toggle');
    setBusy(row.id);
    setError(null);
    try {
      setRows((await setConnection(row.id, !row.on)).connections);
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  const switched = (rows || []).filter((row) => row.control === 'switch');
  const used = (rows || []).filter((row) => row.control !== 'switch');
  return (
    <section className="settings-sec conn" data-testid="connections">
      <div className="label-data settings-h">{t('connections.heading')}</div>
      <p className="settings-note">{t('connections.note')}</p>
      {error ? <p className="settings-err">{error}</p> : null}
      {rows ? (
        <>
          <div className="label-data conn-group">{t('connections.runsAlone', { on: switched.filter((r) => r.on).length, total: switched.length })}</div>
          <ul className="conn-list">
            {switched.map((row) => <SwitchedRow key={row.id} row={row} busy={busy === row.id} onFlip={flip} t={t} />)}
          </ul>
          <div className="label-data conn-group">{t('connections.onUse')}</div>
          <ul className="conn-list">
            {used.map((row) => <UsedRow key={row.id} row={row} t={t} />)}
          </ul>
        </>
      ) : (
        !error && <p className="settings-note">{t('connections.reading')}</p>
      )}
    </section>
  );
};
