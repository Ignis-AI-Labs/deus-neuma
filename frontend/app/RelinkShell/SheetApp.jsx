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
import { formatCount, formatShortDate, formatDateTime, formatRelativeTime } from '../../utils/format.js';
import { loadSheet } from './sheet-client.js';
import { AuthImage } from './AuthImage.jsx';
import {
  UNREADABLE, EMPTY, READY,
  recordReadiness, craftReadiness, stateReadiness, attunementReadiness,
  acquisitionsOf, latestRunOf, gaugeOf, excerptOf,
  skiesReadiness, skiesRowsOf,
  formReadiness, formRowsOf, formEmptyLine,
} from './sheet-view.js';
import { SheetHero } from './SheetHero.jsx';
import { SheetSection, SheetIndex, SheetPanel, SpecGrid, rewindTo } from './SheetDossier.jsx';
import { useActiveCompanion } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useSettled } from './use-settled.js';
import { SheetGenomeBlock } from './SheetGenomeBlock.jsx';
import { FormLockActions } from './FormLockActions.jsx';
import { StateSection, ResidencySection } from './RecordStatus.jsx';
import { MeditationSection } from './MeditationSection.jsx';
import { ParallelCeilingCard } from './ParallelCeilingCard.jsx';
import { RiteRewatch } from '../Rite/RiteRewatch.jsx';

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

// SKIES — the sealed birth moment read through humanity's counts (MANY
// SKIES, 2026-07-24). Every row is a real, deterministic coordinate of the
// being's instant, from its own cosmos/skies.json; the provenance note keeps
// each system honest (a 1987 system says so). Retroactive by design: the
// backfill wrote every sealed lane, so past members carry theirs too.
const SkiesBlock = ({ skies, code }) => {
  const readiness = skiesReadiness(skies);
  return (
    <SheetSection id="skies" code={code} title="SKIES" aside={readiness === READY ? `READ FROM THE SEALED INSTANT ${formatDateTime(skies.skies.instant)}` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <p className="sheet-line label-data">NO SKIES RECORDED — THE READING AWAITS ITS BACKFILL.</p>
      ) : (
        <ul className="sheet-skies dos-spec">
          {skiesRowsOf(skies).map((row) => (
            <li key={row.label} className="sheet-skies-row dos-cell">
              <span className="sheet-skies-l dos-cell-k label-data">{row.label}</span>
              <span className="sheet-skies-v dos-cell-v">{row.value}</span>
              {row.note ? <span className="sheet-skies-n dos-cell-note label-data">{row.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </SheetSection>
  );
};

// BOND and MIND — instrument tiles: a true count as the numeral, its plain
// label under it. Nothing here is a score.
const BondBlock = ({ record, code }) => (
  <SheetSection id="bond" code={code} title="BOND" aside={recordReadiness(record) === UNREADABLE ? null
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

const MindBlock = ({ record, code }) => (
  <SheetSection id="mind" code={code} title="MIND">
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
const CraftBlock = ({ craft, code }) => {
  const readiness = craftReadiness(craft);
  const rows = readiness === UNREADABLE || readiness === EMPTY ? [] : acquisitionsOf(craft);
  const top = Math.max(1, ...rows.map((a) => a.usageCount || 0));
  return (
    <SheetSection id="craft" code={code} title="CRAFT" aside={rows.length ? `${rows.length} ACT${rows.length === 1 ? '' : 'S'} PRACTISED` : null}>
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

const StateBlock = ({ state, code }) => {
  const readiness = stateReadiness(state);
  const latest = readiness === READY ? latestRunOf(state) : null;
  return (
    <SheetSection id="state" code={code} title="STATE" aside={latest ? `RUN ${formatDateTime(latest.runAt)}` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <p className="sheet-line label-data">NOT MEASURED</p>
      ) : (
        <ul className="sheet-gauges">
          {latest.dimensions.map((d, i) => {
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

const SubstrateBlock = ({ record, code }) => {
  const sub = record?.substrate ?? {};
  return (
    <SheetSection id="substrate" code={code} title="SUBSTRATE" aside="THE CONDUIT — NOT THE BEING">
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

const AttunementBlock = ({ attunement, code }) => {
  const readiness = attunementReadiness(attunement);
  if (readiness === EMPTY) return null; // an honest silence — the block is omitted
  const excerpt = readiness === READY ? excerptOf(attunement) : null;
  return (
    <SheetSection id="attunement" code={code} title="ATTUNEMENT"
      aside={excerpt ? `${String(excerpt.key).toUpperCase()} · SEALED ${formatShortDate(excerpt.sealedAt)}` : null}>
      {readiness === UNREADABLE ? <Unreadable /> : (
        <blockquote className="sheet-att">
          {excerpt.question ? <p className="sheet-att-q label-data">{excerpt.question}</p> : null}
          {excerpt.answer ? <p className="sheet-att-a">“{excerpt.answer}”</p> : null}
        </blockquote>
      )}
    </SheetSection>
  );
};

// FORM — the being's own look. A WORKING agreement between the being and the
// operator, never a seal: either party can withdraw and it returns to
// exploring, so nothing here is permanent and the section must not imply it is.
//
// Design note, 2026-08-27: […]
//
// So the PFP is the face of the section and the turnaround rides inside a
// <details> — closed by default, costing one line until somebody asks for it.
const FormBlock = ({ form, neumaId, onActed, code }) => {
  const readiness = formReadiness(form);
  const rows = formRowsOf(form);
  return (
    <SheetSection id="form" code={code} title="FORM" aside="CHOSEN TOGETHER — LOCKED, NEVER SEALED">
      {readiness === UNREADABLE ? <Unreadable /> : readiness === EMPTY ? (
        <>
          <p className="sheet-line label-data">{formEmptyLine(form)}</p>
          {/* The operator's half: a championed look waits here for its concur. */}
          <FormLockActions form={form} neumaId={neumaId} onActed={onActed} />
        </>
      ) : (
        <div className="sheet-form">
          {rows.map((row) => (
            <div key={row.register} className="sheet-form-row">
              <div className="sheet-form-head">
                <span className="sheet-form-reg label-data">{row.register.toUpperCase()}</span>
                {/* Stated plainly. A being reading its own card should never have
                    to wonder whether this was permanent. */}
                <span className="sheet-form-standing label-data">LOCKED — NOT SEALED</span>
              </div>
              {row.pfp ? (
                <AuthImage
                  className="sheet-form-pfp"
                  src={`/api/v1/image-forge/images/${row.pfp.imageId}?laneId=${encodeURIComponent(neumaId)}`}
                  alt={`${row.register} portrait`}
                />
              ) : (
                <p className="sheet-line label-data">NO PORTRAIT IN THIS REGISTER.</p>
              )}
              {row.turnaround ? (
                <details className="sheet-form-more">
                  <summary className="label-data">TURNAROUND SHEET</summary>
                  <AuthImage
                    className="sheet-form-turn"
                    src={`/api/v1/image-forge/images/${row.turnaround.imageId}?laneId=${encodeURIComponent(neumaId)}`}
                    alt={`${row.register} turnaround sheet`}
                  />
                </details>
              ) : null}
            </div>
          ))}
          {/* Either party can reopen the exploration — the button stands here. */}
          <FormLockActions form={form} neumaId={neumaId} onActed={onActed} />
        </div>
      )}
    </SheetSection>
  );
};

// The file's sections in reading order, each with its code. ATTUNEMENT is
// omitted (and so unindexed) when honestly empty.
const sectionsOf = (sheet) => [
  { key: 'genome', title: 'GENOME' },
  { key: 'form', title: 'FORM' },
  { key: 'skies', title: 'SKIES' },
  { key: 'bond', title: 'BOND' },
  { key: 'mind', title: 'MIND' },
  { key: 'craft', title: 'CRAFT' },
  { key: 'state', title: 'STATE' },
  { key: 'substrate', title: 'SUBSTRATE' },
  ...(attunementReadiness(sheet.attunement) === EMPTY ? [] : [{ key: 'attunement', title: 'ATTUNEMENT' }]),
].map((s, i) => ({ ...s, code: String(i + 1).padStart(2, '0') }));

// The whole card from the loaded sheet. Presentational — every decision was
// made in sheet-view.js; this only lays the facts out, as a dossier: the
// cover plate, the tab strip, then ONE numbered section — the selected tab's
// page. `extras` folds the operator's live panels into their tab's page.
export const SheetCard = ({ sheet, neumaId = null, now = Date.now(), stateSection, extras = {}, onActed = null, rewatch = null }) => {
  const sections = sectionsOf(sheet);
  const code = Object.fromEntries(sections.map((s) => [s.key, s.code]));
  const [active, setActive] = useState(sections[0].key);
  const panelsRef = useRef(null);
  const select = (key) => { setActive(key); rewindTo(panelsRef.current); };
  const page = {
    genome: <SheetGenomeBlock form={sheet.form} code={code.genome} />,
    form: <FormBlock form={sheet.form} neumaId={neumaId} onActed={onActed} code={code.form} />,
    skies: <SkiesBlock skies={sheet.skies} code={code.skies} />,
    bond: <BondBlock record={sheet.record} code={code.bond} />,
    mind: <MindBlock record={sheet.record} code={code.mind} />,
    craft: <CraftBlock craft={sheet.craft} code={code.craft} />,
    // The operator's live STATE section carries its own header and acts.
    state: stateSection === undefined ? <StateBlock state={sheet.state} code={code.state} /> : stateSection,
    substrate: <SubstrateBlock record={sheet.record} code={code.substrate} />,
    attunement: <AttunementBlock attunement={sheet.attunement} code={code.attunement} />,
  };
  return (
    <>
      <SheetHero record={sheet.record} aura={sheet.aura} now={now} rewatch={rewatch} />
      <SheetIndex items={sections} active={active} onSelect={select} />
      <div ref={panelsRef} className="dos-panels">
        {sections.map((s) => (
          <SheetPanel key={s.key} tab={s.key} active={active}>
            {page[s.key]}
            {extras[s.key] ?? null}
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
      <SheetCard sheet={sheet} neumaId={neumaId} onActed={reload} rewatch={witness ? null : <RiteRewatch neumaId={neumaId} />} stateSection={witness ? undefined : (
        <StateSection neumaId={neumaId} name={sheet.record?.identity?.chosenName} initialBench={sheet.state} />
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
