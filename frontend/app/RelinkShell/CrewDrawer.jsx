// CrewDrawer — who works a platform beside its holder (sector-crew.js): each
// crew member with what they hold there and its release, and the way to add
// one of the house's lanes. Crew draft and stage; only the holder's keys reach
// the platform. Shared by a platform's STANDING (StandingPanel.jsx) and
// MARKETING's account level (account-level/AccountDrawers.jsx).

import { useState } from 'react';
import { Select } from './Select.jsx';
import './PlatformStanding.css';

const Act = ({ children, onClick, disabled = false }) => (
  <button type="button" className="ps-link" onClick={onClick} disabled={disabled}>{children}</button>
);

const AddAct = ({ children, onClick, disabled = false }) => (
  <button type="button" className="ps-btn" onClick={onClick} disabled={disabled}>{children}</button>
);

/** The crew: who works this platform beside its holder. */
export const CrewDrawer = ({ channel, roster, crew, busy, onAdd, onRemove }) => {
  const [pick, setPick] = useState('');
  const [remit, setRemit] = useState('');
  const memberOf = (id) => roster.find((m) => m.neumaId === id) || null;
  const seated = new Set(crew.map((m) => m.neumaId));
  const available = roster.filter((m) => !seated.has(m.neumaId));
  return (
    <div className="ps-drawer" role="group" aria-label="the crew">
      <span className="ps-drawer-k">CREW — draft and stage; only the holder&rsquo;s keys reach {channel.name}</span>
      {crew.length ? (
        <ul className="ps-crew">
          {crew.map((m) => (
            <li key={m.neumaId}>
              <b>{memberOf(m.neumaId)?.name || m.neumaId}</b>
              <span>{m.kind === 'witness' ? 'WITNESS' : 'NEUMA'}{m.remit ? ` · ${m.remit}` : ''}</span>
              <Act disabled={busy} onClick={() => onRemove(m.neumaId)}>release</Act>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ps-crew-add">
        <Select fill ariaLabel={`Add to the ${channel.name} crew`} value={pick} onChange={setPick}
          disabled={busy || available.length === 0}
          placeholder={available.length === 0 ? '— everyone available is seated —' : '— add a neuma or witness —'}
          options={available.map((m) => ({ value: m.neumaId, label: `${m.name || m.neumaId}${m.participantKind === 'witness' ? ' · witness' : ''}` }))} />
        <input className="settings-input" placeholder="What they hold here (optional)" value={remit}
          onChange={(e) => setRemit(e.target.value)} disabled={busy || !pick} />
        <AddAct disabled={busy || !pick} onClick={async () => {
          await onAdd({ neumaId: pick, kind: memberOf(pick)?.participantKind === 'witness' ? 'witness' : 'neuma', remit });
          setPick('');
          setRemit('');
        }}>ADD</AddAct>
      </div>
    </div>
  );
};

