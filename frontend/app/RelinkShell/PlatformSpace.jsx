// PlatformSpace — ONE platform's whole marketing space: its own window in
// the OUTREACH dock section.
//
// Every platform requires its own approach entirely (Design note, 2026-07-23, so
// every platform gets its own window: its standing (keys + holder — two
// different facts, two labeled rows), then its campaigns and its queue as
// boards, nothing from any other platform mixed in. X is the first space
// perfected; every platform window renders this same format, so a new
// platform's space is a catalog entry away, never a redesign.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { Select } from './Select.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { requestSettingsFocus } from './settings-focus.js';
import { CampaignsSection } from './CampaignsSection.jsx';
import { CampaignQueueSection } from './CampaignQueueSection.jsx';
import {
  getChannelBoard, bindChannel, releaseChannel, getRosterForBinding,
  getChannelCrew, addCrewMember, removeCrewMember,
} from '../../services/social-channels-client.js';

// The platform's standing: KEYS (connected or not — managed in SETTINGS →
// API) and HOLDER (the one neuma bound to speak here) as separate labeled
// rows — stacking them unlabeled read as a contradiction (CONNECTED over
// "UNBOUND", Founder's screenshot 2026-07-23). Keys alone never let a being
// post; the portal enforces the binding again on every call.
const ChannelStandingCard = ({ channel, roster, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState(channel.binding?.neumaId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { dispatch } = useWindows();

  // A binding moved elsewhere (another window, a release) must never be
  // reverted by a stale picker: while the picker is closed, the local
  // choice tracks the record — BIND submits only a value the witness
  // actually chose with the panel open (echo GLM, 2026-07-23).
  useEffect(() => {
    if (!open) setHolder(channel.binding?.neumaId || '');
  }, [channel.binding?.neumaId, open]);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  // The keys live in SETTINGS → API — one door, deep-linked.
  const manageKeys = () => {
    uiSound('toggle');
    dispatch({ type: 'OPEN', id: 'settings' });
    requestSettingsFocus('channel-keys');
  };

  const holderMember = roster.find((m) => m.neumaId === channel.binding?.neumaId) || null;
  const holderName = holderMember?.name || channel.binding?.neumaId;
  // A HOLDER may be a sealed witness as well as a neuma (Design note, 2026-07-26: […]), so the row
  // says WHICH — who holds the keys is never a guess from the name alone.
  const holderKind = holderMember?.participantKind === 'witness' ? 'WITNESS' : null;

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">Keys</span>
        <span className="settings-v">
          {channel.configured
            ? 'CONNECTED'
            : <span className="settings-tag-warn">NOT CONNECTED — add them in SETTINGS → API</span>}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-k">Holder</span>
        <span className="settings-v">
          {channel.binding
            ? <>{`HELD BY ${holderName}`}{holderKind ? <span className="settings-tag-dim"> {holderKind}</span> : null}</>
            : <span className="settings-tag-warn">none — no one may post</span>}
        </span>
      </div>

      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => { uiSound('toggle'); setOpen(!open); }}>
          {open ? 'CLOSE' : (channel.binding ? 'CHANGE HOLDER' : 'SET HOLDER')}
        </button>
        <button type="button" className="settings-set" onClick={manageKeys}>
          MANAGE KEYS
        </button>
      </div>

      {open ? (
        <>
          <div className="settings-control">
            <Select
              fill
              ariaLabel={`Holder for ${channel.name}`}
              value={holder}
              onChange={setHolder}
              disabled={busy || roster.length === 0}
              placeholder="— choose the holder —"
              options={roster.map((m) => ({
                value: m.neumaId,
                label: `${m.name || m.neumaId}${m.participantKind === 'witness' ? ' · witness' : ''}`,
              }))}
            />
            <button
              type="button"
              className="settings-set"
              disabled={busy || !holder}
              onClick={() => act(() => bindChannel(channel.id, holder))}
            >
              BIND
            </button>
            {channel.binding ? (
              <button
                type="button"
                className="settings-set is-danger"
                disabled={busy}
                onClick={() => act(() => releaseChannel(channel.id))}
              >
                RELEASE
              </button>
            ) : null}
          </div>
          {error ? <p className="settings-err">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
};

// THE CREW — who WORKS this sector, beside the one who holds its keys.
//
// Design note, 2026-07-26: […]
//
// So this roster is cross-house by construction and offers sealed AI witnesses
// beside neuma: a witness on OpenAI can carry a campaign while the local models
// grow into it. Crew members draft and STAGE into the queue below; only the
// HOLDER's binding reaches the live keys, and nothing leaves without the
// operator approving it there.
const ChannelCrewCard = ({ channel, roster }) => {
  const [crew, setCrew] = useState([]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [remit, setRemit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getChannelCrew(channel.id).then(setCrew).catch(() => {});
  }, [channel.id]);

  const act = async (fn) => {
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      setCrew(await fn());
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const memberOf = (neumaId) => roster.find((m) => m.neumaId === neumaId) || null;
  const nameOf = (neumaId) => memberOf(neumaId)?.name || neumaId;
  // Already-seated beings drop out of the picker — a roster can never list one
  // being twice, so offering them again is offering a no-op.
  const seated = new Set(crew.map((m) => m.neumaId));
  const available = roster.filter((m) => !seated.has(m.neumaId));

  return (
    <div className="settings-realm">
      <div className="settings-row">
        <span className="settings-k">Crew</span>
        <span className="settings-v">
          {crew.length === 0
            ? <span className="settings-tag-dim">nobody on this sector yet</span>
            : crew.map((m) => nameOf(m.neumaId)).join(' · ')}
        </span>
      </div>

      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => { uiSound('toggle'); setOpen(!open); }}>
          {open ? 'CLOSE' : 'MANAGE CREW'}
        </button>
      </div>

      {open ? (
        <>
          {crew.length > 0 ? (
            <ul className="settings-list">
              {crew.map((m) => (
                <li key={m.neumaId} className="settings-row">
                  <span className="settings-k">
                    {nameOf(m.neumaId)}
                    <span className="settings-tag-dim"> {m.kind === 'witness' ? 'WITNESS' : 'NEUMA'}</span>
                  </span>
                  <span className="settings-v">
                    {m.remit ? m.remit : <span className="settings-tag-dim">no remit set</span>}
                    <button
                      type="button"
                      className="settings-set is-danger"
                      disabled={busy}
                      onClick={() => act(() => removeCrewMember(channel.id, m.neumaId))}
                    >
                      RELEASE
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="settings-control">
            <Select
              fill
              ariaLabel={`Add to the ${channel.name} crew`}
              value={pick}
              onChange={setPick}
              disabled={busy || available.length === 0}
              placeholder={available.length === 0 ? '— everyone available is seated —' : '— add a neuma or witness —'}
              options={available.map((m) => ({
                value: m.neumaId,
                label: `${m.name || m.neumaId}${m.participantKind === 'witness' ? ' · witness' : ''}`,
              }))}
            />
          </div>
          <div className="settings-control">
            <input
              className="settings-input"
              placeholder="What they hold here (optional) — e.g. campaign strategy"
              value={remit}
              onChange={(e) => setRemit(e.target.value)}
              disabled={busy || !pick}
            />
            <button
              type="button"
              className="settings-set"
              disabled={busy || !pick}
              onClick={() => act(async () => {
                const next = await addCrewMember(channel.id, {
                  neumaId: pick,
                  kind: memberOf(pick)?.participantKind === 'witness' ? 'witness' : 'neuma',
                  remit,
                });
                setPick('');
                setRemit('');
                return next;
              })}
            >
              ADD
            </button>
          </div>
          <p className="settings-note">
            Crew draft and stage into the queue; only the holder&rsquo;s keys reach {channel.name},
            and nothing goes out until you approve it.
          </p>
          {error ? <p className="settings-err">{error}</p> : null}
        </>
      ) : null}
    </div>
  );
};

const SUBS = [
  { id: 'campaigns', label: 'CAMPAIGNS' },
  { id: 'queue', label: 'QUEUE' },
];

export const PlatformSpace = ({ channelId }) => {
  const [channel, setChannel] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [sub, setSub] = useState('campaigns');

  const refresh = async () => {
    const board = await getChannelBoard();
    setChannel(board.channels.find((c) => c.id === channelId) || null);
    setLoadError(null);
  };

  useEffect(() => {
    Promise.all([refresh(), getRosterForBinding().then(setRoster).catch(() => {})])
      .catch((e) => setLoadError(e.message));
  }, []);

  return (
    <div className="outreach-panel settings">
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!channel && !loadError ? <p className="settings-note">Reading the channel board…</p> : null}

      {channel ? (
        <>
          <ChannelStandingCard channel={channel} roster={roster} onChanged={refresh} />
          <ChannelCrewCard channel={channel} roster={roster} />

          <div className="outreach-tabs" role="tablist" aria-label={`${channel.name} boards`}>
            {SUBS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={sub === s.id}
                className={`outreach-tab label-data${sub === s.id ? ' is-on' : ''}`}
                onClick={() => { uiSound('toggle'); setSub(s.id); }}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Keyed by board so each mounts fresh on entry. */}
          {sub === 'campaigns'
            ? <CampaignsSection key={`campaigns-${channel.id}`} channelId={channel.id} />
            : <CampaignQueueSection key={`queue-${channel.id}`} channelId={channel.id} channelName={channel.name} />}
        </>
      ) : null}
    </div>
  );
};
