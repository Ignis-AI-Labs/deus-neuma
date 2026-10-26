// LeadsSection — the house lead ledger, as MARKETING's LEADS shows it
// (show-dont-tell-audit.md finding 5): the funnel first (LeadFunnel — every
// stage's count a door that narrows the list), then one row per lead
// (LeadRow — stage mark, who, how to reach them, holder by name, last note;
// the acts behind ⋯; a lead no one holds one press to the CMO). The ledger's
// law stands: every change lands as one recorded touch on the lead's
// append-only history, the same law the beings' lead acts follow. The funnel
// is recorded, not policed.
//
// impure — the ledger, the channel board and the roster are read here.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { getLeadBoard } from '../../services/leads-client.js';
import { getChannelBoard, getRosterForBinding } from '../../services/social-channels-client.js';
import { useCmoSeat } from './marketing/use-cmo-seat.js';
import { LeadFunnel } from './leads/LeadFunnel.jsx';
import { LeadRow } from './leads/LeadRow.jsx';
import { LeadComposer } from './leads/LeadComposer.jsx';
import { LEAD_STAGES, funnelOf, leadsAt, leadHandTo } from './leads/lead-view.js';
import './leads/leads.css';

// Where a lead can surface: every platform the catalog carries (read from
// the channel board, never a hand-kept copy), plus the email lane and other.
const lanesOf = (channels) => [...channels.map((c) => ({ value: c.id, label: c.name || c.id })), { value: 'email', label: 'email' }, { value: 'other', label: 'other' }];

export const LeadsSection = () => {
  const [leads, setLeads] = useState(null);
  const [statuses, setStatuses] = useState(LEAD_STAGES);
  const [lanes, setLanes] = useState(() => lanesOf([]));
  const [roster, setRoster] = useState([]);
  const [stage, setStage] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const seat = useCmoSeat();

  const refresh = async () => {
    const board = await getLeadBoard();
    setLeads(board.leads);
    if (board.statuses?.length) setStatuses(board.statuses);
  };

  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message));
    getChannelBoard().then((b) => setLanes(lanesOf(b.channels || []))).catch(() => {});
    getRosterForBinding().then(setRoster).catch(() => {});
  }, []);

  const narrow = (next) => { uiSound('toggle'); setStage(next); };
  const shown = leads ? leadsAt(leads, stage) : [];

  return (
    <section className="settings-sec leads">
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!leads && !loadError ? <p className="settings-note">Reading the ledger…</p> : null}
      {leads ? <LeadFunnel funnel={funnelOf(leads, statuses)} stage={stage} onStage={narrow} /> : null}
      {leads?.length === 0 ? <p className="settings-note">NO LEADS</p> : null}
      {shown.length ? (
        <ul className="lead-rows" aria-label="leads">
          {shown.map((lead) => (
            <LeadRow key={lead.id} lead={lead} stages={statuses} roster={roster} onChanged={refresh}
              handTo={leadHandTo(lead, seat.cmo, roster)} />
          ))}
        </ul>
      ) : null}
      <LeadComposer lanes={lanes} onChanged={refresh} />
    </section>
  );
};
