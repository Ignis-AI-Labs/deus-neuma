// SecurityApp — THE SECURITY WINDOW: the CSO office as a first-class desk
// surface (Design note, 2026-08-10: […]). Lives in the WORKSPACE dock group — a workspace thing, checked
// when the operator wants it, never the focus by default.
//
// Read-mostly by design: the office's truth (seat, watch, ledger, reports)
// is server truth; the one act here is RUN SCAN, the operator's own call —
// seat management and watch editing stay in Settings → Security.
//
// impure shell only: every render decision lives in SecurityBody.jsx +
// security-view.js (both pure, both node-renderable).

import { useEffect, useState } from 'react';
import './SecurityApp.css';
import { AppTitle } from './app-title.jsx';
import { uiSound } from '../../services/ui-sound.js';
import {
  getPosture, getScan, getWatch, getThreats, getThreat, runScan,
} from '../../services/cso-client.js';
import { filterThreats } from './security-view.js';
import { SecurityBody, SecurityIcon } from './SecurityBody.jsx';

const SecurityAppBody = () => {
  const [posture, setPosture] = useState(null);
  const [scan, setScan] = useState(null);
  const [watch, setWatch] = useState(null);
  const [threats, setThreats] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [layerFilter, setLayerFilter] = useState('');
  const [repoFilter, setRepoFilter] = useState('');

  const loadAll = () => Promise.all([getPosture(), getScan(), getWatch(), getThreats()])
    .then(([p, s, w, t]) => {
      setPosture(p); setScan(s.scan); setWatch(w.watch); setThreats(t.threats);
      setError(null);
    })
    .catch((e) => setError(e.message)); // surfaced, never swallowed

  useEffect(() => { loadAll(); }, []);

  const onPickThreat = (entry) => {
    uiSound('open');
    getThreat(entry.id)
      .then((r) => { setDetail(r.threat); setError(null); })
      .catch((e) => setError(e.message));
  };

  const onRunScan = async () => {
    uiSound('activate');
    setBusy(true);
    try {
      await runScan();
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SecurityBody
      posture={posture}
      scan={scan}
      watch={watch}
      entries={filterThreats(threats, { status: statusFilter, layer: layerFilter, repo: repoFilter })}
      detail={detail}
      busy={busy}
      error={error}
      onPickThreat={onPickThreat}
      onCloseDetail={() => setDetail(null)}
      onRunScan={onRunScan}
      statusFilter={statusFilter}
      layerFilter={layerFilter}
      repoFilter={repoFilter}
      onStatus={(v) => { uiSound('open'); setStatusFilter(v); }}
      onLayer={(v) => { uiSound('open'); setLayerFilter(v); }}
      onRepo={(v) => { uiSound('open'); setRepoFilter(v); }}
    />
  );
};

export const securityApp = {
  label: 'SECURITY',
  labelKey: 'apps.security',
  icon: <SecurityIcon />,
  title: <AppTitle label="SECURITY" labelKey="apps.security" />,
  Body: SecurityAppBody,
  storageKey: 'security',
};
