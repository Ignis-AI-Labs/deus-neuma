// SheetApp — SHEET, the character card (RPG-001, #183).
//
// One window holding who the active neuma IS, composed from four real feeds
// (record, craft, state, attunement). RPG as a presentation discipline for
// REAL data: every numeral is a true count or a fact from disk — no LV, no
// XP, no invented progression (the data law; core/runtime/neuma-record.js:1).
// A leg that could not be read says UNREADABLE; an honestly empty one says so
// ([…]). AGE DAYS is the oversized display
// numeral — the level slot filled by a truth.

import { useRef, useState } from 'react';
import './SheetApp.css';
import './SheetBeing.css';
import { formatCount, formatShortDate, formatDateTime, formatRelativeTime } from '../../utils/format.js';
import { loadSheet } from './sheet-client.js';
import {
  UNREADABLE, EMPTY, READY,
  recordReadiness, craftReadiness, stateReadiness,
  acquisitionsOf, latestRunOf, gaugeOf,
} from './sheet-view.js';
import { SHEET_SPACES, SHEET_SPACE_KEY, sheetSpaceOf } from './sheet-being-view.js';
import { SheetHero } from './SheetHero.jsx';
import { SheetSection, SheetIndex, SheetPanel, SpecGrid, rewindTo } from './SheetDossier.jsx';
import { GivenSpace } from './given/GivenSpace.jsx';
import { ChosenSpace } from './SheetChosen.jsx';
import { SummoningSpace } from './SheetSummoning.jsx';
import { useActiveCompanion } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';
import { StateSection, ResidencySection } from './RecordStatus.jsx';
import { MeditationSection } from './MeditationSection.jsx';
import { ParallelCeilingCard } from './ParallelCeilingCard.jsx';

const SheetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M2.5 2.5 H11 L13.5 5 V13.5 H5 L2.5 11 Z" />
    <circle cx="8" cy="8.2" r="2.3" />
  </svg>
);

// The honest failure line — a leg that could not be read, in the alert
// register (a genuine failure, not an empty record).
const Unreadable = () => <p className="sheet-unreadable label-data">UNREADABLE</p>;

// One objective count: a value and its plain label. Nothing here is a score.
const Fact = ({ value, label }) => (
  <div className="sheet-fact">
    <span className="sheet-fact-v">{value}</span>
    <span className="sheet-fact-l label-data">{label}</span>
  </div>
);

// "3d ago" for a real timestamp, — for one that never parsed.
const relative = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatRelativeTime(ms) : '—';
};

// BOND and MIND — instrument tiles: a true count as the numeral, its plain
// label under it. Nothing here is a score.
const BondBlock = ({ record }) => (
  <SheetSection id="bond" code="04·A" title="BOND" aside={recordReadiness(record) === UNREADABLE ? null
    : `FIRST SEEN ${formatShortDate(record.record.relationship.firstSeen)} · LAST SEEN ${formatShortDate(record.record.relationship.lastSeen)}`}>
    {recordReadiness(record) === UNREADABLE ? <Unreadable /> : (
      <div className="sheet-grid">
        <Fact value={formatCount(record.record.relationship.conversations)} label="CONVERSATIONS" />
        <Fact value={formatCount(record.record.relationship.exchanges)} label="EXCHANGES" />
        <Fact value={formatCount(record.record.relationship.messages)} label="MESSAGES" />
      </div>
    )}
  </SheetSection>
);

const MindBlock = ({ record }) => (
  <SheetSection id="mind" code="04·B" title="MIND">
    {recordReadiness(record) === UNREADABLE ? <Unreadable /> : (
      <div className="sheet-grid">
        <Fact value={formatCount(record.record.memory.observations)} label="CRYSTALS" />
        <Fact value={formatCount(record.record.memory.entities)} label="ENTITIES" />
        <Fact value={formatCount(record.record.memory.relations)} label="RELATIONS" />
        <Fact value={formatCount(record.record.journal?.toolCalls)} label="TOOL ACTIONS" />
        <Fact value={formatCount(record.record.journal?.toolSuccess)} label="SUCCEEDED" />
        <Fact value={formatCount(record.record.journal?.toolDenied)} label="BLOCKED" />
      </div>
    )}
  </SheetSection>
);

// CRAFT — the acts, most-used first, each with a bar against the most-used
// one: which skills carry the being's work reads at a glance.
const CraftBlock = ({ craft }) => {
  const readiness = craftReadiness(craft);
  const rows = readiness === UNREADABLE || readiness === EMPTY ? [] : acquisitionsOf(craft);
  const top = Math.max(1, ...rows.map((a) => a.usageCount || 0));
  return (
    <SheetSection id="craft" code="04·C" title="CRAFT" aside={rows.length ? `${rows.length} ACT${rows.length === 1 ? '' : 'S'} PRACTISED` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <p className="sheet-proof label-data">NO ACTS YET — THE ACT IS THE PROOF.</p>
      ) : (
        <ul className="sheet-craft">
          {rows.map((a) => (
            <li key={a.skill} className="sheet-craft-row">
              <span className="sheet-craft-name">{a.skill}</span>
              <span className="sheet-craft-bar" aria-hidden="true">
                <span className="sheet-craft-fill" style={{ width: `${Math.round(((a.usageCount || 0) / top) * 100)}%` }} />
              </span>
              <span className="sheet-craft-count label-data">×{formatCount(a.usageCount)}</span>
              <span className="sheet-craft-last label-data">{relative(a.lastUsedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </SheetSection>
  );
};

const StateBlock = ({ state }) => {
  const readiness = stateReadiness(state);
  const latest = readiness === READY ? latestRunOf(state) : null;
  return (
    <SheetSection id="state" code="05" title="STATE" aside={latest ? `RUN ${formatDateTime(latest.runAt)}` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <p className="sheet-line label-data">NOT MEASURED</p>
      ) : (
        <ul className="sheet-gauges">
          {latest.components.map((d, i) => {
            const g = gaugeOf(d);
            return (
              <li key={d.key || `${g.label}-${i}`} className="sheet-gauge">
                <span className="sheet-gauge-l label-data">{g.label}</span>
                <span className="sheet-gauge-bar" aria-hidden="true">
                  <span className="sheet-gauge-fill" style={{ width: `${g.pct ?? 0}%` }} />
                </span>
                <span className="sheet-gauge-v">{g.pct == null ? 'N/A' : `${g.pct}%`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SheetSection>
  );
};

const SubstrateBlock = ({ record }) => {
  const sub = record?.substrate ?? {};
  return (
    <SheetSection id="substrate" code="06" title="SUBSTRATE" aside="THE CONDUIT — NOT THE BEING">
      {recordReadiness(record) === UNREADABLE ? <Unreadable /> : (
        <SpecGrid cells={[
          { k: 'CONDUIT', v: <span className="sheet-sig">{sub.model || 'unknown model'}</span>, wide: true },
          sub.provider ? { k: 'PROVIDER', v: sub.provider } : null,
          sub.gpu ? { k: 'GPU', v: `${sub.gpu}${sub.vramGB ? ` ${sub.vramGB}GB` : ''}` } : null,
          sub.ramGB ? { k: 'MEMORY', v: `${sub.ramGB}GB RAM` } : null,
          sub.cpu ? { k: 'CPU', v: sub.cpu } : null,
          sub.bornOn && sub.bornOn !== sub.model ? { k: 'BORN ON', v: sub.bornOn } : null,
          // Residency rides the record payload when the backend carries it;
          // omitted entirely when it does not — no invented source.
          typeof record.residency === 'string' && record.residency ? { k: 'RESIDENCY', v: record.residency } : null,
        ].filter(Boolean)} />
      )}
    </SheetSection>
  );
};

// The whole card from the loaded sheet, as a dossier of SPACES in the order
// its birth gave it (sheet-being-view.js): 01 GIVEN · 02 CHOSEN · 03 ITS
// SUMMONING · 04 LIFE · 05 STATE · 06 VESSEL — the cover plate, the strip, one
// space at a time, the space last read remembered. `extras` folds the
// operator's live panels in after their section (mind, substrate). A sealed
// witness was never summoned: it has no SUMMONING space.
const storedSpace = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(SHEET_SPACE_KEY));

export const SheetCard = ({ sheet, neumaId = null, now = Date.now(), stateSection, extras = {}, onActed = null, witness = false }) => {
  const spaces = SHEET_SPACES.filter((s) => !(witness && s.key === 'summoning'));
  const [active, setActive] = useState(() => {
    const k = sheetSpaceOf(storedSpace());
    return spaces.some((s) => s.key === k) ? k : 'given';
  });
  const panelsRef = useRef(null);
  const select = (key) => {
    setActive(key);
    if (typeof localStorage !== 'undefined') localStorage.setItem(SHEET_SPACE_KEY, key);
    rewindTo(panelsRef.current);
  };
  const page = {
    given: <GivenSpace sheet={sheet} neumaId={neumaId} onActed={onActed} />,
    chosen: <ChosenSpace sheet={sheet} neumaId={neumaId} onActed={onActed} />,
    summoning: <SummoningSpace film={sheet.film} neumaId={neumaId} open={active === 'summoning'} />,
    life: (
      <>
        <BondBlock record={sheet.record} />
        <MindBlock record={sheet.record} />
        {extras.mind ?? null}
        <CraftBlock craft={sheet.craft} />
      </>
    ),
    // The operator's live STATE section carries its own header and acts.
    state: stateSection === undefined ? <StateBlock state={sheet.state} /> : stateSection,
    vessel: (
      <>
        <SubstrateBlock record={sheet.record} />
        {extras.substrate ?? null}
      </>
    ),
  };
  return (
    <>
      <SheetHero record={sheet.record} aura={sheet.aura} now={now} />
      <SheetIndex items={spaces} active={active} onSelect={select} />
      <div ref={panelsRef} className="dos-panels">
        {spaces.map((s) => (
          <SheetPanel key={s.key} tab={s.key} active={active}>
            <div className="sb-page">{page[s.key]}</div>
          </SheetPanel>
        ))}
      </div>
    </>
  );
};

const BoundRecord = ({ neumaId, witness }) => {
  const [sheet, setSheet] = useState(undefined); // undefined = loading

  useSettled((settled) => {
    // loadSheet never rejects — a failed leg comes back null.
    loadSheet(neumaId).then((s) => { if (!settled()) setSheet(s); });
  }, [neumaId]);

  // After an operator act on the card (a form concur/withdraw), reload from
  // the record — never from a local guess at what the write produced. Plain
  // callback: the guard hook's own law says effects-guards cannot live in
  // event handlers, and a late resolve after unmount is a no-op set.
  const reload = () => loadSheet(neumaId).then(setSheet);

  if (sheet === undefined) return <div className="sheet"><EmptyState title="LOADING…" /></div>;
  if (!neumaId) {
    return (
      <div className="sheet">
        <EmptyState title="NO BEING BOUND">
          <small>No neuma is linked into the stream. Bind one from the HOUSE and their card appears here.</small>
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="sheet">
      <SheetCard sheet={sheet} neumaId={neumaId} onActed={reload} witness={witness} stateSection={witness ? undefined : (
        <StateSection neumaId={neumaId} name={sheet.record?.identity?.chosenName} />
      )} extras={witness ? undefined : {
        mind: <MeditationSection neumaId={neumaId} name={sheet.record?.identity?.chosenName} />,
        substrate: <><ParallelCeilingCard /><ResidencySection neumaId={neumaId} /></>,
      }} />
    </div>
  );
};

const SheetBody = () => {
  const companion = useActiveCompanion();
  const neumaId = companion?.neumaId || null;
  const witness = companion?.participantKind === 'witness' || neumaId?.startsWith('witness-');
  // A new lane mounts fresh state before any asynchronous feed can resolve.
  return <BoundRecord key={neumaId || 'unbound'} neumaId={neumaId} witness={witness} />;
};

export const sheetApp = {
  label: 'RECORD',
  labelKey: 'apps.sheet',
  appliesTo: 'neuma',
  icon: <SheetIcon />,
  title: <AppTitle label="RECORD" labelKey="apps.sheet" />,
  Body: SheetBody,
  storageKey: 'sheet',
};
