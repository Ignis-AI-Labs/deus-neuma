// CampaignLog — who changed what on a campaign, and when: an inventory, so a
// list, but on demand (show-dont-tell-audit.md finding 2; CHOKKAN 3). Closed,
// it is one count door, `LOG n`; open, the newest thirty lines first.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';

const SHOWN = 30;

const when = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString();
};

/** @param {{log?: Array<{at: string, what: string}>}} props */
export const CampaignLog = ({ log }) => {
  const [open, setOpen] = useState(false);
  const lines = [...(log || [])].reverse().slice(0, SHOWN);
  return (
    <>
      <div className="settings-control">
        <button type="button" className="settings-set campaign-log-door" data-log-door aria-expanded={open}
          title={open ? 'fold the log' : `who changed what, newest first${(log || []).length > SHOWN ? ` — the last ${SHOWN}` : ''}`}
          onClick={() => { uiSound('toggle'); setOpen(!open); }}>
          LOG {(log || []).length}
        </button>
      </div>
      {open ? lines.map((l, i) => (
        <p key={`${l.at}-${i}`} className="settings-note campaign-log-line">{when(l.at)} · {l.what}</p>
      )) : null}
    </>
  );
};
