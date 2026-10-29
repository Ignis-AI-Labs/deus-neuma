// AccountDrawers — what the account head's HOLDER and CREW marks open, in
// place, one at a time: who may speak as this account, and the platform's
// crew (CrewDrawer). Nothing here is on screen until its mark is pressed.
//
// THE HOLDER FOLLOWS THE SEAT (platform-standing.js, Design note, 2026-10-23: the
// only lanes offered are the ones the house already seats in marketing — the
// CMO, a marketing-titled member, the platform's crew — never an external
// witness (one house lane per account), then Release. With no CMO, SEAT A
// CMO stands beside them. The platform's first account is the channel's own
// record, so it binds and releases through the standing (which remembers a
// release, so the window never re-binds the CMO over it); every other account
// through its own account route.
//
// impure — the binding routes, sound.

import { useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { bindAccount, releaseAccount } from '../../../services/social-accounts-client.js';
import { CrewDrawer } from '../CrewDrawer.jsx';
import { DoorButton } from '../doors/DoorButton.jsx';
import { SEAT_DOOR } from './standing-marks.js';

const HolderChoices = ({ channel, account, standing, onBound }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const offered = (standing.holder?.offered ?? []).filter((c) => !c.witness);
  const current = account.binding?.neumaId ?? null;
  const first = account.id === `${channel.id}-1`;
  const hold = async (neumaId) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      if (first) await (neumaId ? standing.bind(neumaId) : standing.release());
      else await (neumaId ? bindAccount(account.id, neumaId) : releaseAccount(account.id));
      await onBound();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="ps-drawer" role="group" aria-label="the holder" data-holder-drawer>
      <span className="ps-drawer-k">MARKETING SEATS — only these may hold it</span>
      <div className="ps-choices">
        {offered.map((c) => {
          const on = current === c.neumaId;
          return (
            <button key={c.neumaId} type="button" className={`ps-choice${on ? ' is-on' : ''}`} aria-pressed={on}
              disabled={busy || standing.busy || on} onClick={() => hold(c.neumaId)}>
              <b>{c.name}</b><span>{c.seat}</span>
            </button>
          );
        })}
        {current ? (
          <button type="button" className="ps-choice is-release" disabled={busy || standing.busy} onClick={() => hold(null)}>
            <b>Release</b><span>no one may post</span>
          </button>
        ) : null}
      </div>
      {standing.holder && !standing.holder.cmo ? <DoorButton door={SEAT_DOOR} label="SEAT A CMO" /> : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </div>
  );
};

/**
 * @param {{drawer: ?string, channel: object, account: ?object, standing: object, onBound: () => Promise<unknown>}} props
 *   account — this account's record (its binding); standing — usePlatformStanding's answer; onBound — re-read the house
 */
export const AccountDrawers = ({ drawer, channel, account, standing, onBound }) => {
  if (drawer === 'holder' && !account) return null;
  if (drawer !== 'holder' && drawer !== 'crew') return null;
  const pressed = (fn) => (...args) => { uiSound('toggle'); return fn(...args); };
  return (
    <section className="ps is-account" aria-label={`${channel.name} ${drawer}`}>
      {drawer === 'holder' ? <HolderChoices channel={channel} account={account} standing={standing} onBound={onBound} /> : (
        <CrewDrawer channel={channel} roster={standing.roster} crew={standing.crew} busy={standing.busy}
          onAdd={pressed(standing.addCrew)} onRemove={pressed(standing.removeCrew)} />
      )}
      {standing.error ? <p className="settings-err">{standing.error}</p> : null}
    </section>
  );
};
