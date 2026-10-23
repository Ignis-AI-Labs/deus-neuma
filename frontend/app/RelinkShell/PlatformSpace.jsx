// PlatformSpace — ONE platform's whole marketing space: its own window in
// the OUTREACH dock section.
//
// Every platform requires its own approach entirely (ruling, 2026-07-23), so
// every platform gets its own window: its console head, its standing (keys ·
// holder · crew — StandingPanel, the one shared component), then its
// campaigns and its queue as boards, nothing from any other platform mixed
// in. Every platform window renders this same format, so a new platform's
// space is a catalog entry away, never a redesign.

import { useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { CampaignsSection } from './CampaignsSection.jsx';
import { CampaignQueueSection } from './CampaignQueueSection.jsx';
import { PlatformHeader } from './PlatformHeader.jsx';
import { StandingPanel, StandingNotice } from './StandingPanel.jsx';
import { usePlatformPulse } from './use-platform-pulse.js';
import { usePlatformStanding } from './use-platform-standing.js';
import { platformPulse, scopeQueue } from './platform-pulse.js';
import './PlatformConsole.css';

const SUBS = [
  { id: 'campaigns', label: 'CAMPAIGNS' },
  { id: 'queue', label: 'QUEUE' },
];

export const PlatformSpace = ({ channelId }) => {
  const standing = usePlatformStanding(channelId);
  const { channel, holder, notice, loadError } = standing;
  const [sub, setSub] = useState('campaigns');
  const [standingOpen, setStandingOpen] = useState(false);
  const [drawer, setDrawer] = useState(null);
  // A console door's destination; `n` remounts the queue board on each press.
  const [focus, setFocus] = useState({ n: 0 });
  const pulseRead = usePlatformPulse();

  const openQueue = (to) => {
    uiSound('toggle');
    setSub('queue');
    setFocus((f) => ({ ...to, n: f.n + 1 }));
  };
  const pulse = pulseRead.queue ? platformPulse(scopeQueue(pulseRead.queue, channelId), pulseRead.now) : null;
  const test = channel ? (pulseRead.tests[channel.id] ?? null) : null;

  return (
    <div className="outreach-panel settings" ref={pulseRead.watch}>
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!channel && !loadError ? <p className="settings-note">Reading the channel board…</p> : null}

      {channel ? (
        <>
          {pulse ? (
            <PlatformHeader
              channel={channel} test={test}
              holderName={holder?.holder?.name ?? (channel.binding ? channel.binding.neumaId : null)}
              crewCount={standing.crew.length} pulse={pulse} now={pulseRead.now} onOpen={openQueue}
              standingOpen={standingOpen} onStanding={() => { uiSound('toggle'); setStandingOpen((v) => !v); }}
            />
          ) : <p className="settings-note">Reading the queue…</p>}
          {notice ? (
            <StandingNotice notice={notice} channelName={channel.name}
              onChange={() => { uiSound('toggle'); setStandingOpen(true); setDrawer('holder'); }}
              onDismiss={() => { uiSound('toggle'); standing.dismissNotice(); }} />
          ) : null}
          {standingOpen || !pulse
            ? <StandingPanel standing={standing} test={test} drawer={drawer} onDrawer={setDrawer} /> : null}

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
            : <CampaignQueueSection key={`queue-${channel.id}-${focus.n}`} channelId={channel.id} channelName={channel.name}
                focus={focus.n ? focus : null} onChanged={pulseRead.refresh} />}
        </>
      ) : null}
    </div>
  );
};
