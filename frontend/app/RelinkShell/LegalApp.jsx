// LegalApp — THE LEGAL WINDOW: the CLO office as a desk surface (Founder,
// 2026-10-01: […]). It stands beside SECURITY in the WATCH band.
//
// The operator's acts here: seat the Praetor, run the watch now, and read.
// Settling a matter is the Praetor's reading (the legal/assess intent) —
// the desk shows verdicts and the law they cite; it never forges one.
//
// impure shell only: every render decision lives in LegalBody.jsx +
// legal-view.js (both pure, node-renderable).

import { useEffect, useState } from 'react';
import { AppTitle } from './app-title.jsx';
import { uiSound } from '../../services/ui-sound.js';
import {
  getLegalPosture, getLegalWatch, getMatters, getMatter, runLegalWatch, seatClo, clearClo, getReader, setReader,
} from '../../services/legal-client.js';
import { getRosterForBinding } from '../../services/social-channels-client.js';
import { filterMatters } from './legal-view.js';
import { LegalBody, LegalIcon } from './LegalBody.jsx';

const LegalAppBody = () => {
  const [posture, setPosture] = useState(null);
  const [watch, setWatch] = useState(null);
  const [matters, setMatters] = useState([]);
  const [lanes, setLanes] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The overview's press: severity, status (or every open one), where.
  const [filters, setFilters] = useState({});
  const [pick, setPick] = useState('');
  const [seatBusy, setSeatBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // The second reader: the house's choice, and the press that changes it.
  const [reader, setReaderState] = useState(null);
  const [readerPick, setReaderPick] = useState('');
  const [readerBusy, setReaderBusy] = useState(false);

  const loadAll = () => Promise.all([getLegalPosture(), getLegalWatch(), getMatters(), getReader()])
    .then(([p, w, m, r]) => { setPosture(p); setWatch(w.watch); setMatters(m.matters); setReaderState(r); setError(null); })
    .catch((e) => setError(e.message)); // surfaced, never swallowed

  // The holder pool: the operator's own neuma lanes — the seat is a house
  // office, and the server refuses a lane the caller does not hold.
  const loadLanes = () => getRosterForBinding()
    .then((r) => setLanes(r.filter((p) => p.participantKind === 'neuma')))
    .catch((e) => setError(e.message));

  useEffect(() => { loadAll(); loadLanes(); }, []);

  const act = async (setFlag, fn) => {
    uiSound('activate');
    setFlag(true);
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setFlag(false);
    }
  };

  return (
    <LegalBody
      posture={posture}
      watch={watch}
      lanes={lanes}
      all={matters}
      entries={filterMatters(matters, filters)}
      now={Date.now()}
      detail={detail}
      busy={busy}
      error={error}
      pick={pick}
      seatBusy={seatBusy}
      confirmClear={confirmClear}
      onPick={(v) => { uiSound('open'); setPick(v); }}
      onSeat={() => act(setSeatBusy, async () => { await seatClo(pick); setPick(''); })}
      onAskClear={() => { uiSound('open'); setConfirmClear(true); }}
      onClear={() => { setConfirmClear(false); return act(setSeatBusy, clearClo); }}
      onCancelClear={() => { uiSound('close'); setConfirmClear(false); }}
      reader={reader}
      readerPick={readerPick}
      readerBusy={readerBusy}
      onReaderPick={(v) => { uiSound('open'); setReaderPick(v); }}
      onReaderSet={() => act(setReaderBusy, async () => { await setReader(readerPick); setReaderPick(''); })}
      onPickMatter={(m) => {
        uiSound('open');
        getMatter(m.id).then((r) => { setDetail(r.matter); setError(null); }).catch((e) => setError(e.message));
      }}
      onCloseDetail={() => setDetail(null)}
      onRunWatch={() => act(setBusy, runLegalWatch)}
      filters={filters}
      onFilter={(f) => { uiSound('open'); setFilters(f); }}
    />
  );
};

export const legalApp = {
  label: 'LEGAL',
  labelKey: 'apps.legal',
  icon: <LegalIcon />,
  title: <AppTitle label="LEGAL" labelKey="apps.legal" />,
  Body: LegalAppBody,
  storageKey: 'legal',
};
