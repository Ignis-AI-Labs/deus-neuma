// SiteCounterRow — the body of the board's SITE COUNTER panel (campaign plan
// §4.1): whether the house's counter is on, how many of the house's links it
// counts, and PUBLISH n for the n still waiting to go on it. The token field
// (sealed when saved; it never comes back) stands open until a token is
// saved, then folds behind a key door (SDT-3: the board keeps ● ON, LINKS n
// and PUBLISH n). With no counter, a post's links stay exactly as written.
// What the counter keeps (per day, nothing about who) is said once, in the
// panel title's hover.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { saveSiteToken, publishLinks } from '../../../services/marketing-results-client.js';
import { KeyLink } from '../KeyLink.jsx';

/** What the counter counts, in the SITE COUNTER title's hover. */
export const COUNTER_KEY = 'the site counter counts how often each of the house\'s links is followed, per day, and nothing about who · with no counter, links in posts stay exactly as written · PUBLISH puts the links still waiting on the counter · the key replaces the saved token';

const KeyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="5" cy="8" r="3" /><path d="M8 8 H14.5 M12 8 V10.5 M14 8 V10" />
  </svg>
);

/** @param {{site: ?{configured: boolean, root: string}, links: object[], onChanged: () => Promise<unknown>}} props */
export const SiteCounterRow = ({ site, links, onChanged }) => {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const on = Boolean(site?.configured);
  const waiting = links.filter((l) => !['published', 'already'].includes(l.published?.state)).length;
  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try { await fn(); await onChanged(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const save = () => act(async () => { await saveSiteToken(token.trim()); setToken(''); setOpen(false); });
  return (
    <div className="mko-site" data-mko-site>
      <span className="mko-site-nums">
        <span className={`mko-site-state${on ? ' is-on' : ''}`}>{on ? '● ON' : '○ OFF'}</span>
        {on ? <span className="mko-site-n" title="links the counter counts"><b>{links.length}</b>LINKS</span> : <span className="mko-site-off">links stay as written</span>}
        {waiting && on ? (
          <button type="button" className="settings-set" disabled={busy} onClick={() => act(publishLinks)}
            title={`${waiting} link(s) not yet on the counter — put them on it`}>PUBLISH {waiting}</button>
        ) : null}
        {on ? (
          <button type="button" className="mko-door mko-site-key" aria-expanded={open} title="REPLACE TOKEN" aria-label="REPLACE TOKEN"
            onClick={() => { uiSound('toggle'); setOpen(!open); }}><KeyIcon /></button>
        ) : null}
      </span>
      {on && !open ? null : (
        <>
          <div className="settings-control">
            <input className="settings-input" type="password" autoComplete="off" placeholder={on ? 'a new token replaces the saved one' : 'the site counter token'}
              aria-label="site counter token" value={token} onChange={(e) => setToken(e.target.value)} disabled={busy} />
            <button type="button" className="settings-set" disabled={busy || !token.trim()} onClick={save}>SAVE</button>
          </div>
          <KeyLink family="marketing" id="site-counter" lead="WHERE THE TOKEN COMES FROM" />
        </>
      )}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};
