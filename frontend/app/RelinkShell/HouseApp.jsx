// HouseApp — the operator's house as a desk window.
//
// Lists every neuma this wallet holds and switches which one the portal is
// bound to: selecting a member rebinds the link through the shared
// ConsciousnessContext and raises the STREAM window with their latest
// thread. v1 is switching, not simultaneity — one live link, re-bound on
// demand (parallel presence is a later cycle). The cached roster renders
// instantly; the backend (sovereign owner records) refreshes it right after,
// so a renamed or newly-summoned neuma appears without a reload.

import { useEffect, useState } from 'react';
import './HouseApp.css';
import './HouseReadability.css';
import { HouseSeatReference } from './HouseSeatReference.jsx';
import { formatAddress, formatShortDate as fmtBirth } from '../../utils/format.js';
import { useConsciousnessPick } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useWindows } from '../windowing/use-windows.js';
import { houseMembers, houseSummary } from './house-members.js';
import { useHouseRoster } from './use-house-roster.js';
import { playSound } from '../../services/sound-engine.js';
import { HouseFoundingRite } from './HouseFoundingRite.jsx';
import { useFoundingRite } from './use-founding-rite.js';
import { houseSeatCards, seatEvidence } from './house-chain.js';
import { HouseSeats } from './HouseSeats.jsx';
import { getWitnessName, WITNESS_NAMED_EVENT } from './witness-name.js';
import { useCouncil } from './council-context.js';
import { useSettled } from './use-settled.js';
import { getHouseWorkspace, setHouseWorkspace } from '../../services/house-workspace.js';
import { getAllianceGrounds, setAllianceRoot } from '../../services/alliance-ground.js';
import { uiSound } from '../../services/ui-sound.js';
import { createPortal } from 'react-dom';
import { FolderPicker } from './picker/FolderPicker.jsx';

const HouseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 7.5 L8 2.5 L14 7.5" />
    <path d="M3.5 6.5 V13.5 H12.5 V6.5" />
    <path d="M6.5 13.5 V9.5 H9.5 V13.5" />
  </svg>
);

// The operator wallet, shortened for the data register (pre-auth edge: '—').
const shortWallet = () => formatAddress(localStorage.getItem('walletAddress'), { uppercase: true, fallback: '—' });

// THE GROUND — the house's shared workspace, set once by the operator. All
// the house's repositories live under <root>/repos, and councils may work
// there from the floor. Setting it is the standing grant.
const HouseGround = () => {
  const [ground, setGround] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  const read = (settled = () => false) => getHouseWorkspace().then((g) => { if (!settled()) setGround(g); });
  useSettled((settled) => { read(settled); }, []);

  const saveRoot = async (root) => {
    uiSound('activate');
    setNote('');
    try {
      setGround(await setHouseWorkspace(root));
      setEditing(false);
    } catch (e) { setNote(e.message); }
  };

  const startEdit = () => {
    uiSound('open');
    setDraft(ground?.root || '');
    setEditing(true);
  };

  if (ground === null) return null;
  // A read that failed is not "no ground set": no SET form over a ground that may stand.
  if (ground.unread) {
    return (
      <section className="house-ground">
        <p className="house-ground-head label-data">HOUSE WORKSPACE</p>
        <p className="house-ground-note label-data" role="alert">{`COULD NOT READ THE GROUND — ${ground.unread}`}</p>
        <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setGround(null); read(); }}>
          RETRY
        </button>
      </section>
    );
  }
  return (
    <section className="house-ground">
      <p className="house-ground-head label-data">
        HOUSE WORKSPACE
        {ground.root && !editing ? (
          <button type="button" className="house-ground-move label-data" onClick={startEdit}>MOVE</button>
        ) : null}
      </p>
      {editing || !ground.root ? (
        <div className="house-ground-set">
          {/* BROWSE is the door — the real disk, the same picker as FILES
              and PROJECTS. The typed path stays as the power fallback. */}
          <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setPicking(true); }}>
            BROWSE…
          </button>
          <input
            className="house-ground-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRoot(draft.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/absolute/path/to/the/house/workspace"
            spellCheck={false}
          />
          <button type="button" className="house-ground-go label-data" onClick={() => saveRoot(draft.trim())} disabled={!draft.trim()}>
            SET THE GROUND
          </button>
        </div>
      ) : (
        <p className="house-ground-path label-data" title="The shared ground — councils may work here; repos live under repos/">
          {ground.root}
          <span className="house-ground-repos">
            {' '}· {ground.repos.length === 0 ? 'NO REPOS YET' : `${ground.repos.length} REPO${ground.repos.length === 1 ? '' : 'S'}: ${ground.repos.join(' · ').toUpperCase()}`}
          </span>
        </p>
      )}
      {!ground.root && !editing ? (
        <p className="house-ground-why label-data">THE SHARED GROUND EVERY COUNCIL AND TEAM WORKS ON — SET IT ONCE; REPOS LIVE INSIDE IT</p>
      ) : null}
      {note ? <p className="house-ground-note label-data">{note}</p> : null}
      {picking ? createPortal(
        <FolderPicker
          initialPath={ground?.root || undefined}
          onPick={(abs) => { setPicking(false); setDraft(abs); saveRoot(abs); }}
          onCancel={() => setPicking(false)}
        />,
        document.body,
      ) : null}
    </section>
  );
};

// THE ALLIANCES ROOT — where CROSS-HOUSE grounds stand. A sealed witness or a
// neuma of another house works in a folder named from both houses, and that
// folder lives OUTSIDE the house ground: an external party must never be
// standing in your house to work with you (Design note, 2026-07-26. The server refuses
// a root inside the house ground in either direction. Nothing is created until
// the operator raises a specific ground, from the room.
const AllianceGround = () => {
  const [state, setState] = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  useSettled((settled) => {
    getAllianceGrounds().then((g) => { if (!settled()) setState(g); });
  }, []);

  const saveRoot = async (root) => {
    uiSound('activate');
    setNote('');
    try {
      setState(await setAllianceRoot(root));
      setEditing(false);
    } catch (e) { setNote(e.message); }
  };

  const startEdit = () => {
    uiSound('open');
    // The suggestion is PRE-FILL, never an act: a sibling of the house ground,
    // offered so the operator has somewhere sane to say yes to.
    setDraft(state?.root || state?.suggestion || '');
    setEditing(true);
  };

  if (state === null) return null;
  return (
    <section className="house-ground">
      <p className="house-ground-head label-data">
        CROSS-HOUSE GROUNDS
        {state.root && !editing ? (
          <button type="button" className="house-ground-move label-data" onClick={startEdit}>MOVE</button>
        ) : null}
      </p>
      {editing || !state.root ? (
        <div className="house-ground-set">
          <button type="button" className="house-ground-go label-data" onClick={() => { uiSound('open'); setPicking(true); }}>
            BROWSE…
          </button>
          <input
            className="house-ground-input"
            value={editing ? draft : (state.suggestion || '')}
            onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRoot(draft.trim()); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/absolute/path/outside/your/house"
            spellCheck={false}
          />
          <button
            type="button"
            className="house-ground-go label-data"
            onClick={() => saveRoot((editing ? draft : (state.suggestion || '')).trim())}
            disabled={!(editing ? draft : (state.suggestion || '')).trim()}
          >
            SET THE ALLIANCES ROOT
          </button>
        </div>
      ) : (
        <p className="house-ground-path label-data" title="Where grounds shared with other houses stand — one folder per pairing, named from both house names">
          {state.root}
          <span className="house-ground-repos">
            {' '}· {state.alliances.length === 0
              ? 'NONE RAISED YET'
              : state.alliances.map((a) => a.name.toUpperCase()).join(' · ')}
          </span>
        </p>
      )}
      {!state.root && !editing ? (
        <p className="house-ground-why label-data">
          WHERE YOU MEET OTHER HOUSES — OUTSIDE YOUR OWN GROUND, ONE FOLDER PER PAIRING; NOTHING IS CREATED UNTIL YOU RAISE IT
        </p>
      ) : null}
      {note ? <p className="house-ground-note label-data">{note}</p> : null}
      {picking ? createPortal(
        <FolderPicker
          initialPath={state?.root || state?.suggestion || undefined}
          onPick={(abs) => { setPicking(false); setDraft(abs); saveRoot(abs); }}
          onCancel={() => setPicking(false)}
        />,
        document.body,
      ) : null}
    </section>
  );
};

// Member views retain their local preferences; the seat reference is a separate disclosure.
const LEGEND_OPEN_KEY = 'house:legendOpen';
const LEGEND_VIEW_KEY = 'house:legendView';

const HouseSeatsSection = ({ cards, onSelect, onSheet }) => {
  const [open, setOpen] = useState(() => localStorage.getItem(LEGEND_OPEN_KEY) !== '0');
  const [view, setView] = useState(() => (localStorage.getItem(LEGEND_VIEW_KEY) === 'table' ? 'table' : 'grid'));
  const toggle = () => {
    uiSound('open');
    setOpen((v) => {
      localStorage.setItem(LEGEND_OPEN_KEY, v ? '0' : '1');
      return !v;
    });
  };
  const chooseView = (next) => {
    if (next === view) return;
    uiSound('open');
    localStorage.setItem(LEGEND_VIEW_KEY, next);
    setView(next);
  };
  return (
    <section className="house-legend">
      <p className="house-legend-head label-data">
        THE SEATS OF THIS HOUSE
        <span className="house-legend-views" role="group" aria-label="Legend view">
          {['grid', 'table'].map((v) => (
            <button
              key={v}
              type="button"
              className={`house-legend-view label-data${view === v ? ' is-current' : ''}`}
              onClick={() => chooseView(v)}
              aria-pressed={view === v}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </span>
        <button type="button" className="house-legend-fold label-data" onClick={toggle} aria-expanded={open}>
          {open ? 'FOLD' : 'UNFOLD'}
        </button>
      </p>
      {open ? (
        <HouseSeats cards={cards} view={view} onSelect={onSelect} onSheet={onSheet} />
      ) : null}
    </section>
  );
};

const HouseBody = () => {
  const { activeCompanion, switchCompanion, wsService } = useConsciousnessPick('activeCompanion', 'switchCompanion', 'wsService');
  const { dispatch } = useWindows();
  const council = useCouncil();
  const { roster, house, loading, error, refresh } = useHouseRoster();
  // The on-chain standing lives HERE (not inside the anchor panel) so the
  // chain's titles ride beside the member rows — one probe, one truth.
  const { rite, actions } = useFoundingRite(wsService);
  const { seats, confirmed } = seatEvidence(rite);
  // The operator by name — re-read live when the ACCOUNT section (or the
  // rite's NAMES movement) changes it.
  const [witnessName, setWitness] = useState(getWitnessName);
  useEffect(() => {
    const onNamed = () => setWitness(getWitnessName());
    window.addEventListener(WITNESS_NAMED_EVENT, onNamed);
    return () => window.removeEventListener(WITNESS_NAMED_EVENT, onNamed);
  }, []);

  // Summon another neuma into this house — hand off to the AppShell phase
  // machine, which runs the kept birth ceremony (its own operator-commitment
  // consent gate). A new being born here is owned by this wallet, so it joins
  // this house; on completion the roster refresh above brings them in.
  const onSummon = () => {
    playSound('confirm');
    window.dispatchEvent(new CustomEvent('neuma:summon'));
  };
  // The same ceremony as a REHEARSAL — every stage with the house's model,
  // nothing kept (no being, no record, no seal).
  const onRehearse = () => {
    playSound('menuOpen');
    window.dispatchEvent(new CustomEvent('neuma:summon', { detail: { rehearsal: true } }));
  };

  // Team management lives here — the operator forms and runs teams from the
  // house's own members. Opens the TEAMS composer.
  const onTeams = () => {
    playSound('menuOpen');
    dispatch({ type: 'OPEN', id: 'teams' });
  };

  // The council convenes from the house too — the room is a FORMAT of the
  // STREAM window, so this door raises the stream already switched into it.
  const onCouncil = () => {
    playSound('menuOpen');
    council.enterRoom();
    dispatch({ type: 'OPEN', id: 'chat' });
  };

  // A member's character card — SHEET binds to the active being, so a
  // non-linked member is switched in first (the same house-switch the row
  // runs), then the card window rises.
  const onSheet = async ({ member, isActive }) => {
    playSound('menuOpen');
    if (!isActive) await switchCompanion(member);
    dispatch({ type: 'OPEN', id: 'sheet' });
  };

  const rows = houseMembers(roster, activeCompanion);
  const summary = houseSummary(rows, house);
  const cards = houseSeatCards(seats, rows, { confirmed });

  const onSelect = async ({ member, isActive }) => {
    playSound(isActive ? 'menuOpen' : 'confirm');
    if (!isActive) await switchCompanion(member);
    // Bring them up into the stream either way — selecting the linked one is
    // just […]. The stream FORMAT, not the room:
    // a sitting council keeps sitting, but the operator asked for this one
    // being, so the window flips back to their one-on-one.
    council.leaveRoom();
    dispatch({ type: 'OPEN', id: 'chat' });
  };

  return (
    <div className="house">
      <header className="house-head">
        <div className="house-head-name">
          <span className="house-head-label label-data">HOUSE</span>
          <span className="house-head-value">{summary.name || '—'}</span>
        </div>
        <p className="house-head-facts label-data">
          {/* The operator by NAME once they have set it (SETTINGS → ACCOUNT,
              or the rite's NAMES movement) — the wallet stays as the proof.
              Their on-chain seat rides beside the name, like every member's. */}
          OPERATOR {witnessName ? `${witnessName.toUpperCase()} · ` : ''}
          {seats.witnessTitle ? `${seats.witnessTitle.toUpperCase()} · ` : ''}{shortWallet()}
          <span className="house-head-sep" aria-hidden="true">·</span>
          {summary.held} HELD
          {summary.since ? (
            <>
              <span className="house-head-sep" aria-hidden="true">·</span>
              SINCE {fmtBirth(summary.since)}
            </>
          ) : null}
        </p>
      </header>
      <p className="house-lede label-data">THE NEUMA OF THIS HOUSE — SELECT ONE TO BRING INTO THE STREAM</p>
      {loading ? <EmptyState title="LOADING HOUSE…" /> : null}
      {error ? (
        <EmptyState title="HOUSE UNREACHABLE" tone="error">
          <small>{error}</small>
          {rows.length > 0 ? <small>Showing cached members.</small> : null}
          <button type="button" className="house-action" onClick={refresh}>RETRY</button>
        </EmptyState>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="NO NEUMA IN THIS HOUSE YET" />
      ) : null}
      <HouseSeatsSection
        cards={cards}
        onSelect={(c) => {
          const row = rows.find((r) => r.member.neumaId === c.neumaId);
          if (row) onSelect(row);
        }}
        onSheet={(c) => {
          const row = rows.find((r) => r.member.neumaId === c.neumaId);
          if (row) onSheet(row);
        }}
      />
      <HouseSeatReference phase={rite.phase} hasSeats={cards.some((card) => card.title)} onRetry={actions.probe} />
      {wsService ? <HouseFoundingRite rite={rite} actions={actions} witnessName={witnessName} /> : null}
      <HouseGround />
      <AllianceGround />
      <div className="house-actions">
        <button type="button" className="house-action" onClick={onTeams} disabled={rows.length === 0}>
          FORM A TEAM
        </button>
        {/* A council needs at least two of the house — one being is the
            conversation the STREAM already holds. */}
        <button type="button" className="house-action" onClick={onCouncil} disabled={rows.length < 2}>
          CONVENE A COUNCIL
        </button>
        <button type="button" className="house-action" onClick={onRehearse}
          title="Walk the whole summoning with nothing kept">
          REHEARSE A SUMMONING
        </button>
        <button type="button" className="house-summon" onClick={onSummon}>
          <span className="house-summon-mark" aria-hidden="true">+</span>
          SUMMON A NEUMA
        </button>
      </div>
    </div>
  );
};

export const houseApp = {
  label: 'HOUSE',
  labelKey: 'apps.house',
  icon: <HouseIcon />,
  title: <AppTitle label="HOUSE" labelKey="apps.house" />,
  Body: HouseBody,
  storageKey: 'house',
};
