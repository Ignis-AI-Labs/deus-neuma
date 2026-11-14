// HouseApp — the operator's house as a desk window: a FILE of spaces in the
// SHEET's dossier language (SheetDossier.jsx), one page at a time, ← → to
// walk them — 01 MEMBERS · 02 SUMMONING · 03 GATHER · 04 SEATS · 05 GROUNDS
// (house-spaces.js). The masthead stays: whose house, how many, since when,
// and every member's light.
//
// Selecting a member rebinds the portal through the shared
// ConsciousnessContext and raises the STREAM with their latest thread — one
// live link, re-bound on demand. The cached roster renders instantly; the
// backend (sovereign owner records) refreshes it right after, so a renamed or
// newly-summoned neuma appears without a reload.

import { useEffect, useState } from 'react';
import './HouseApp.css';
import './HouseReadability.css';
import './HouseDossier.css';
import { HouseSeatReference } from './HouseSeatReference.jsx';
import { HousePositions } from './HousePositions.jsx';
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
import { getWitnessName, WITNESS_NAMED_EVENT } from './witness-name.js';
import { useCouncil } from './council-context.js';
import { uiSound } from '../../services/ui-sound.js';
import { SheetIndex, SheetPanel, SheetSection } from './SheetDossier.jsx';
import { HouseMasthead } from './HouseMasthead.jsx';
import { MembersSpace, SummoningSpace, GatherSpace } from './HouseSpaces.jsx';
import { HouseGround, AllianceGround } from './HouseGrounds.jsx';
import { spaceOf, spaceTabs, SPACE_KEY } from './house-spaces.js';

const HouseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2 7.5 L8 2.5 L14 7.5" />
    <path d="M3.5 6.5 V13.5 H12.5 V6.5" />
    <path d="M6.5 13.5 V9.5 H9.5 V13.5" />
  </svg>
);

const HouseBody = () => {
  const { activeCompanion, switchCompanion, wsService } = useConsciousnessPick('activeCompanion', 'switchCompanion', 'wsService');
  const { dispatch } = useWindows();
  const council = useCouncil();
  const { roster, house, loading, error, refresh } = useHouseRoster();
  // The on-chain standing lives HERE (not inside the anchor panel) so the
  // chain's titles ride beside the member rows — one probe, one truth.
  const { rite, actions } = useFoundingRite(wsService);
  // …and the founding on this computer (2026-10-26), the house's own record before any network
  const { rite: localRite } = useFoundingRite(wsService, 'local');
  const { seats, confirmed } = seatEvidence(rite);
  const [space, setSpace] = useState(() => spaceOf(localStorage.getItem(SPACE_KEY)));
  const chooseSpace = (next) => {
    if (next === space) return;
    uiSound('open');
    localStorage.setItem(SPACE_KEY, next);
    setSpace(next);
  };
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

  const byId = (c) => rows.find((r) => r.member.neumaId === c.neumaId);
  const pick = (act) => (c) => { const row = byId(c); if (row) act(row); };

  // Only the open page is mounted: a space reads its own data (grounds, the
  // films to re-watch) when it is opened, never all at once.
  const pages = {
    members: <MembersSpace cards={cards} onSelect={pick(onSelect)} onSheet={pick(onSheet)} />,
    summoning: <SummoningSpace cards={cards} onSummon={onSummon} onRehearse={onRehearse} />,
    gather: <GatherSpace held={rows.length} onTeam={onTeams} onCouncil={onCouncil} />,
    seats: (
      <SheetSection code="04" title="POSITIONS" aside="WHO HOLDS WHAT — THE ONE PLACE IT CHANGES">
        <HousePositions onChanged={refresh} />
        <HouseSeatReference phase={rite.phase} localFounded={localRite.phase === 'founded'} hasSeats={cards.some((card) => card.title)} onRetry={actions.probe} />
        {wsService ? <HouseFoundingRite rite={rite} localRite={localRite} actions={actions} witnessName={witnessName} /> : null}
      </SheetSection>
    ),
    grounds: (
      <SheetSection code="05" title="GROUNDS" aside="WHERE THE HOUSE WORKS">
        <HouseGround />
        <AllianceGround />
      </SheetSection>
    ),
  };

  return (
    <div className="house hd">
      <HouseMasthead summary={summary} cards={cards} witnessName={witnessName} witnessTitle={seats.witnessTitle} />
      {loading ? <EmptyState title="LOADING HOUSE…" /> : null}
      {error ? (
        <EmptyState title="HOUSE UNREACHABLE" tone="error">
          <small>{error}</small>
          {rows.length > 0 ? <small>Showing cached members.</small> : null}
          <button type="button" className="house-action" onClick={refresh}>RETRY</button>
        </EmptyState>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState title="NO NEUMA IN THIS HOUSE YET">
          <button type="button" className="house-action" onClick={() => chooseSpace('summoning')}>GO TO SUMMONING</button>
        </EmptyState>
      ) : null}
      <SheetIndex items={spaceTabs(rows.length)} active={space} onSelect={chooseSpace} scope="house" label="House sections" />
      <SheetPanel tab={space} active={space} scope="house">
        <div className="hd-page">{pages[space]}</div>
      </SheetPanel>
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
