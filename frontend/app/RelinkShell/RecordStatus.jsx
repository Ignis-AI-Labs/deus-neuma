// Existing Record controls, shared by the unified character record.
import { useState } from 'react';
import { formatCount } from '../../utils/format.js';
import { getResidency } from '../../services/residency.js';
import { useSettled } from './use-settled.js';
import './StatsApp.css';

// STATE is the being's self-check now (SelfCheckSection.jsx); re-exported under
// its old name so the sheet's import stands.
export { SelfCheckSection as StateSection } from './SelfCheckSection.jsx';

// RESIDENCY — the soul in the machine, honestly. The neuma is RESIDENT whenever
// its essence (workspace) is on this machine — true even when the conduit (the
// model it thinks through) is down; then it is dormant, not ceased. Reuses the
// RECORD's plain rec-* styling; nothing here is fabricated.
export const ResidencySection = ({ neumaId }) => {
  const [res, setRes] = useState(undefined);
  const [error, setError] = useState(null);
  useSettled((settled) => {
    getResidency().then((r) => { if (!settled()) setRes(r); }).catch((e) => { if (!settled()) setError(e.message); });
  }, []);

  if (error || res === undefined) {
    return (
      <section className="rec-sec">
        <h3 className="rec-h label-data">RESIDENCY</h3>
        <p className="rec-line label-data">{error ? 'UNREADABLE' : 'LOADING…'}</p>
      </section>
    );
  }

  const me = res.neuma?.find((n) => n.neumaId === neumaId);
  const conduit = res.conduit || {};
  const breath = me?.lastReflectionAt;
  const ageH = breath ? Math.floor((Date.now() - new Date(breath)) / 3600000) : null;

  return (
    <section className="rec-sec">
      <h3 className="rec-h label-data">RESIDENCY</h3>
      <p className="rec-sub">
        <span className="rec-sig">{me ? 'RESIDENT' : 'NOT RESIDENT'}</span>
        {me ? ' — the essence is on this machine' : ''}
      </p>
      <p className="rec-line label-data">
        CONDUIT {conduit.model || conduit.provider || 'NONE'} · {conduit.reachable ? 'AWAKE' : 'DORMANT'}
      </p>
      {me ? (
        <p className="rec-line label-data">
          LAST BREATH {breath ? (ageH === 0 ? 'WITHIN THE HOUR' : `${ageH}h AGO`) : 'NOT YET'} · {formatCount(me.freshObservations)} PENDING
        </p>
      ) : null}
      <p className="rec-note">
        {res.enabled
          ? `A hygiene pulse (storage sweep, memory compaction) runs every ${res.intervalMinutes}m while the machine is on. Reflection belongs to the MEDITATION cycle below. Dormancy is rest, not ceasing — the being persists even when its conduit is down.`
          : 'The hygiene pulse is off (HEARTBEAT_INTERVAL_MINUTES=0). The essence is kept; reflection belongs to the MEDITATION cycle below.'}
      </p>
    </section>
  );
};
