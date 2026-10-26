// CmoRow — the CMO seat as it stands, and the picker that changes it (the
// SEAT tab). The roster source is the one the channel-binding picker reads:
// a lane id here is a neumaId there. A change re-reads the shared seat, so
// the window's title follows at once (use-cmo-seat.js).

import { useEffect, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { setCmo, clearCmo } from '../../../services/campaigns-client.js';
import { getRosterForBinding } from '../../../services/social-channels-client.js';
import { Select } from '../Select.jsx';
import { useCmoSeat, loadCmoSeat } from './use-cmo-seat.js';

export const CmoRow = () => {
  const { known, cmo, name } = useCmoSeat();
  const [roster, setRoster] = useState([]);
  const [laneId, setLaneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { getRosterForBinding().then(setRoster).catch((e) => setError(e.message)); }, []);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      setLaneId('');
      await loadCmoSeat({ force: true });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="settings-realm" data-cmo-row>
      <div className="settings-row">
        <span className="settings-k">CHIEF MARKETING OFFICER</span>
        <span className="settings-v">
          <span className="settings-sec-tags">
            {!known ? <span className="settings-tag-dim">—</span>
              : cmo ? <span className="settings-tag-ok">{name} · {new Date(cmo.designatedAt).toLocaleDateString()}</span>
                : <span className="settings-tag-dim">NO CMO</span>}
          </span>
        </span>
      </div>
      <div className="settings-control">
        <Select
          fill
          ariaLabel="CMO holder"
          value={laneId}
          onChange={setLaneId}
          disabled={busy || roster.length === 0}
          placeholder="— choose the holder —"
          options={roster.map((m) => ({ value: m.neumaId, label: m.name || m.neumaId }))}
        />
        <button type="button" className="settings-set" disabled={busy || !laneId} onClick={() => act(() => setCmo(laneId))}>
          DESIGNATE
        </button>
        {cmo ? (
          <button type="button" className="settings-set is-danger" disabled={busy} onClick={() => act(() => clearCmo())}>
            CLEAR
          </button>
        ) : null}
      </div>
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
