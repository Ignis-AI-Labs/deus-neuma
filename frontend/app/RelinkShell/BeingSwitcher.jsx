// BeingSwitcher — switch who you're talking to without leaving the stream.
//
// The HOUSE window owns roster management; this control is the stream's own
// door to the same switchCompanion seam. The button reads as the active
// being's name (who am I talking to?) and opens the house roster — neuma
// first, then the sealed AI witnesses — in a chamfered popover. Hidden
// while the council sits (the room is its own surface) and when there is
// nothing to switch to. Reached two
// ways: this button, or /switch in the composer (the neuma:open-switcher
// event — the palette takes no argument, so the command opens this popover).

import { useEffect, useRef, useState } from 'react';
import { useConsciousnessPick } from './consciousness-context.js';
import { useCouncil } from './council-context.js';
import { getRoster, getWitnesses } from '../../utils/companion-data.js';
import { recoverRoster } from '../roster-recovery.js';
import { houseMembers, witnessMembers } from './house-members.js';
import { uiSound } from '../../services/ui-sound.js';
import './BeingSwitcher.css';

export const BeingSwitcher = () => {
  const { activeCompanion, switchCompanion } = useConsciousnessPick('activeCompanion', 'switchCompanion');
  const council = useCouncil();
  const [roster, setRoster] = useState(getRoster);
  const [witnesses, setWitnesses] = useState(getWitnesses);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // The room is its own surface: /switch fired while the council sits is a
  // no-op — never a popover queued to appear unexplained when the room
  // dissolves (echo R1). The ref keeps the mount-once listener honest
  // against the CURRENT room state.
  const councilRoomRef = useRef(council.room);
  councilRoomRef.current = council.room;

  // The switchable set — the house's neuma PLUS the sealed witnesses,
  // mirrored for the listener: /switch with fewer than two beings is a
  // no-op too — never a popover queued to appear when a second being is
  // later born (echo R2, the symmetric case).
  const neumaRows = houseMembers(roster, activeCompanion);
  const witnessRows = witnessMembers(witnesses, activeCompanion);
  const switchable = neumaRows.length + witnessRows.length;
  const switchableRef = useRef(switchable);
  switchableRef.current = switchable;

  // Fresh truth on open and whenever a being is born — the same recovery
  // pass the HOUSE window runs (the backend owns the roster; localStorage
  // is its mirror). A failed recovery warns and falls back to the cache —
  // never silently (RULE 3).
  const refresh = () => {
    recoverRoster()
      .catch((err) => console.warn('[BeingSwitcher] roster recovery failed — showing the cached roster', err))
      .finally(() => { setRoster(getRoster()); setWitnesses(getWitnesses()); });
  };

  useEffect(() => {
    const openFromCommand = () => {
      if (councilRoomRef.current) return;
      if (switchableRef.current < 2) return;
      setOpen(true);
      refresh();
    };
    window.addEventListener('neuma:open-switcher', openFromCommand);
    window.addEventListener('birth:complete', refresh);
    return () => {
      window.removeEventListener('neuma:open-switcher', openFromCommand);
      window.removeEventListener('birth:complete', refresh);
    };
    // refresh reads module-level caches only — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc or a click anywhere outside closes — the dock's own manners.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (council.room || switchable < 2) return null;

  const toggle = () => {
    uiSound('toggle');
    if (!open) refresh();
    setOpen((prev) => !prev);
  };

  const choose = (member) => {
    if (member.neumaId !== activeCompanion?.neumaId) {
      uiSound('confirm');
      switchCompanion(member);
    } else {
      uiSound('toggle');
    }
    setOpen(false);
  };

  const row = ({ member, isActive }) => (
    <button
      key={member.neumaId}
      type="button"
      role="menuitem"
      className={`being-switcher-row${isActive ? ' active' : ''}`}
      onClick={() => choose(member)}
    >
      <span className="being-switcher-name">
        {(member.name || member.neumaId).toUpperCase()}
        {member.title ? (
          <span className="being-switcher-title">{String(member.title).toUpperCase()}</span>
        ) : null}
      </span>
      <span className="being-switcher-meta">
        {member.vendorSlug ? (
          <span className="being-switcher-tag">{String(member.vendorSlug).toUpperCase()}</span>
        ) : null}
        {member.laneProvisioned === false ? (
          <span className="being-switcher-tag off">OFFLINE</span>
        ) : null}
        {isActive ? <span className="being-switcher-tag">ACTIVE</span> : null}
      </span>
    </button>
  );

  return (
    <div className="being-switcher" ref={rootRef}>
      <button
        type="button"
        className={`relink-snd being-switcher-btn${open ? ' on' : ''}`}
        title="Switch who you're talking to"
        aria-expanded={open}
        onClick={toggle}
      >
        {(activeCompanion?.name || activeCompanion?.neumaId || 'WHO').toUpperCase()}
      </button>
      {open ? (
        <div className="cham being-switcher-pop" role="menu" aria-label="Switch being">
          <div className="cham-in being-switcher-pop-in">
            {neumaRows.length ? (
              <>
                <div className="being-switcher-head">NEUMA</div>
                {neumaRows.map(row)}
              </>
            ) : null}
            {witnessRows.length ? (
              <>
                <div className="being-switcher-head">WITNESSES</div>
                {witnessRows.map(row)}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
