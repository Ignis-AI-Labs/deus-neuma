// CampaignLinks — one position's campaigns and the campaigns of other
// positions each one works with (Design note, 2026-11-15: campaigns […]). Used on every position that runs campaigns:
// the operator links two campaigns of one company, sees the other side's
// state as it stands now, and takes a link away. The holder of each side reads
// the same line at the top of its turn (positions/campaign-links.js).
// impure — network.

import { useCallback, useEffect, useState } from 'react';
import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { getHouseCampaigns, linkCampaigns, unlinkCampaigns } from '../../../services/positions-client.js';
import { officeWords, linkChoices } from './campaign-links-view.js';

const Row = ({ campaign, all, busy, onLink, onUnlink }) => {
  const [pick, setPick] = useState('');
  const choices = linkChoices(campaign, all);
  return (
    <li className="cline-sec" data-linked-campaign={campaign.key}>
      <p className="cline-h label-data">{campaign.name}{campaign.company ? ` · FOR ${campaign.company.toUpperCase()}` : ''} · {String(campaign.state).toUpperCase()}</p>
      <p className="cline-move-t">{campaign.summary}</p>
      {campaign.links.length ? (
        <ul className="cline-ws-src" aria-label={`campaigns ${campaign.name} works with`}>
          {campaign.links.map((l) => (
            <li key={l.key} data-link-with={l.key}>
              WORKS WITH {officeWords(l.office)} · {l.name} ({String(l.state).toUpperCase()}) — {l.summary}{l.note ? ` — ${l.note}` : ''}{' '}
              <button type="button" className="sec-scan cline-danger label-data" disabled={busy} aria-label={`UNLINK ${campaign.name} from ${l.name}`} onClick={() => onUnlink(campaign, l)}>UNLINK</button>
            </li>
          ))}
        </ul>
      ) : <p className="cline-move-t">WORKS WITH NO OTHER CAMPAIGN YET</p>}
      {choices.length ? (
        <div className="cline-open">
          <Select fill ariaLabel={`campaign to link with ${campaign.name}`} value={pick} onChange={setPick} disabled={busy}
            placeholder="link with a campaign of another position" options={choices} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} aria-label={`LINK ${campaign.name}`}
            onClick={() => { onLink(campaign, pick); setPick(''); }}>LINK</button>
        </div>
      ) : null}
    </li>
  );
};

/** @param {{office: string}} props - the position whose campaigns are shown */
export const CampaignLinks = ({ office }) => {
  const [all, setAll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(() => getHouseCampaigns().then((r) => { setAll(r.campaigns); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const move = async (fn) => {
    uiSound('activate');
    setBusy(true);
    try {
      setAll((await fn()).campaigns);
      setError(null);
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setBusy(false);
    }
  };
  const mine = (all ?? []).filter((c) => c.office === office);
  return (
    <section className="cline-sec" aria-label="linked campaigns" data-campaign-links={office}>
      <p className="cline-h label-data">WORKING TOGETHER — {officeWords(office)}&apos;S CAMPAIGNS AND THE CAMPAIGNS THEY WORK WITH</p>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {all && !mine.length ? <EmptyState title="NO CAMPAIGN HERE YET" /> : null}
      <ul className="cline-list" aria-label={`${officeWords(office)} campaigns`}>
        {mine.map((c) => (
          <Row key={c.key} campaign={c} all={all} busy={busy}
            onLink={(campaign, other) => move(() => linkCampaigns(campaign.key, other))}
            onUnlink={(campaign, link) => move(() => unlinkCampaigns(campaign.key, link.key))} />
        ))}
      </ul>
      <p className="cline-move-t">A link changes neither campaign. It makes the member who holds each one read the other, as it stands, at the top of every turn, so the two say the same offer to the same people at the same time.</p>
    </section>
  );
};
