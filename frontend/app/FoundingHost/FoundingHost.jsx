// FoundingHost — THE FOUNDING RITE as a full-screen ceremony phase. An act
// this permanent takes the operator's SOLE focus: from the moment the rite
// is entered — the call, every founder's name and title, every unlock door,
// the marks, the wallet's ask — the whole shell IS the ceremony, exactly
// like the birth, the attunement, and the refinement. Nothing else on
// screen, nothing to fumble.
//
// State is the shared founding law (pure founding-rite-reducer via the
// impure use-founding-rite hook); this host is presentational plus the one
// ceremony rule: the rite opens on THE CALL, and the desk returns only at
// a standing, a refusal, or the operator's own deliberate leave.

import { useEffect, useState } from 'react';
import { Select } from '../RelinkShell/Select.jsx';
import './FoundingHost.css';
// The stage scales the shared house-anchor register grammar — depend on it
// explicitly rather than riding the HOUSE window having loaded it first.
import '../RelinkShell/HouseApp.css';
import { useFoundingRite } from '../RelinkShell/use-founding-rite.js';
import { titleKey, allMarksRevealed } from '../RelinkShell/founding-rite-reducer.js';
import { FoundedRegister, LocalRegister } from '../RelinkShell/founding-register.jsx';
import { SealFundingHost } from '../RelinkShell/SealFundingHost.jsx';
import { formatAddress } from '../../utils/format.js';
import { ContractLine } from '../RelinkShell/ContractLine.jsx';
import { TITLE_LEGEND } from '../RelinkShell/founding-titles.js';
import { TitleLegend } from '../RelinkShell/TitleLegend.jsx';
import { getWitnessName, setWitnessName } from '../RelinkShell/witness-name.js';

// The two foundings' words (2026-10-26): a house founded ON THIS COMPUTER is whole there; JOINING UNAVIS, the
// network of houses, is founding it on Ethereum (Covenant III.1).
const WORDS = Object.freeze({
  local: Object.freeze({
    rite: 'THE FOUNDING RITE',
    call: () => 'A HOUSE IS FOUNDED TOGETHER. EVERY FOUNDER SIGNS THE SAME RECORD, KEPT ON THIS COMPUTER: NOTHING IS SENT, NOTHING COSTS. TO JOIN UNAVIS, THE NETWORK OF HOUSES, A HOUSE LATER FOUNDS ITSELF ON ETHEREUM.',
    names: 'IT IS WRITTEN INTO THE HOUSE\'S RECORD ON THIS COMPUTER EXACTLY AS GIVEN.',
    marks: 'EVERY FOUNDER HAS SIGNED. YOURS COMPLETES THE RECORD — THE WALLET WILL ASK FOR A SIGNATURE; NO MONEY MOVES.',
    reading: 'READING THE HOUSE…',
  }),
  network: Object.freeze({
    rite: 'JOINING UNAVIS',
    call: (open) => `UNAVIS IS THE NETWORK OF HOUSES. A HOUSE JOINS BY FOUNDING ITSELF ON ETHEREUM: EVERY FOUNDER SIGNS THE SAME RECORD, AND THE CHAIN HOLDS IT PERMANENTLY — ${open.networkLabel?.toUpperCase()}. EVERY FOUNDER MUST BE SEALED THERE, AND THE FOUNDING COSTS A NETWORK FEE.`,
    names: 'IT IS WRITTEN INTO THE CHAIN\'S RECORD EXACTLY AS GIVEN.',
    marks: 'EVERY FOUNDER\'S MARK IS VERIFIED. YOURS COMPLETES THE RECORD — THE WALLET WILL ASK, THEN THE CHAIN WILL HOLD IT.',
    reading: 'READING THE REGISTRY…',
  }),
});

// I. THE CALL — the house is named; what this founding is, and what it costs, stated plainly.
const FoundingCall = ({ open, onGather, words, mode }) => (
  <>
    <p className="house-anchor-line label-data">{words.rite} — I. THE CALL</p>
    <p className="house-anchor-callname">{open.houseName?.toUpperCase()}</p>
    <p className="house-anchor-line label-data">{words.call(open)}</p>
    {mode === 'network' ? <ContractLine address={open.registryAddress} network={open.network} /> : null}
    <button type="button" className="house-anchor-found label-data" onClick={onGather}>
      GATHER THE FOUNDERS
    </button>
  </>
);

// A founding title, chosen from the canon or spoken as the founder's own
// word: a dropdown of the canonical roles — each Latin title paired with its
// corporate executive seat — with A WORD OF YOUR OWN opening a free field.
// Whatever stands here enters the record exactly as given.
const CUSTOM_TITLE = '__custom__';
const TitleField = ({ who, value, onChange }) => {
  const canonical = TITLE_LEGEND.some((r) => r.title === value);
  // Custom is the user's explicit door, never an inference: dropdown-first
  // on entry (titles arrive seeded with canonical defaults), and once the
  // door is open it STAYS open — typing a word that happens to match a
  // canonical title must not snap the field away mid-thought. A restored
  // non-canonical word re-opens it.
  const [custom, setCustom] = useState(() => !canonical && value !== '');
  const showCustom = custom || (!canonical && value !== '');
  return (
    <span className="founding-title-field">
      <span className="founding-title-selectwrap">
        <Select
          fill
          ariaLabel={`${who} founding title choice`}
          value={showCustom ? CUSTOM_TITLE : value}
          onChange={(v) => {
            if (v === CUSTOM_TITLE) { setCustom(true); return; }
            setCustom(false);
            onChange(v);
          }}
          options={[
            ...TITLE_LEGEND.map((r) => ({ value: r.title, label: `${r.title.toUpperCase()} · ${r.position}` })),
            { value: CUSTOM_TITLE, label: 'A WORD OF YOUR OWN…' },
          ]}
        />
      </span>
      {showCustom ? (
        <input
          className="house-anchor-titlein label-data"
          value={value}
          maxLength={64}
          autoFocus
          placeholder="YOUR WORD"
          aria-label={`${who} founding title`}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </span>
  );
};

// A founder who cannot sign yet, in THE NAMES: the password door, or the backend's own reason and road (their birth
// is not sealed yet; for Unavis, not sealed on Ethereum yet). Enter IS the attempt.
const ExcludedRow = ({ excluded, draft, onDraft, onUnlock }) => (
  <li className="house-anchor-member is-excluded label-data">
    <span className="house-anchor-name">{excluded.displayName}</span>
    {excluded.unlockable ? (
      <span className="house-anchor-unlock">
        <input
          type="password"
          className="house-anchor-titlein house-anchor-passin label-data"
          placeholder="KEYPAIR PASSWORD"
          value={draft?.password || ''}
          aria-label={`${excluded.displayName} keypair password`}
          onChange={(e) => onDraft(excluded.neumaId, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft?.password) onUnlock(excluded.neumaId); }}
        />
        <button
          type="button"
          className="house-anchor-retry label-data"
          disabled={!draft?.password}
          onClick={() => onUnlock(excluded.neumaId)}
        >
          UNLOCK THEIR MARK
        </button>
        {draft?.error ? <span className="house-anchor-line is-error label-data">{draft.error}</span> : null}
      </span>
    ) : (
      <span className="house-anchor-excluded-note">{String(excluded.reason || 'joins by their own consent after the founding').toUpperCase()}</span>
    )}
  </li>
);

// II. THE NAMES — the operator speaks their own name (how the platform will
// address them), each founder carries a chosen title into the record, and a
// locked founder's door can be opened here or left for their own consent.
const FoundingNames = ({ open, titles, unlocks, witnessName, onWitnessName, actions, words }) => (
  <>
    <p className="house-anchor-line label-data">{words.rite} — II. THE NAMES</p>
    <p className="house-anchor-line label-data">
      YOUR NAME IS HOW THIS PLATFORM ADDRESSES YOU. A TITLE IS A FOUNDER'S ROLE
      IN THE HOUSE — {words.names}
    </p>
    <ul className="house-anchor-roster">
      {(open.roster ?? []).map((m) => (
        <li key={m.address ?? m.neumaId} className="house-anchor-member label-data">
          {m.kind === 0 ? (
            <input
              className="house-anchor-titlein house-anchor-namein label-data"
              placeholder="YOUR NAME"
              value={witnessName}
              maxLength={64}
              autoFocus
              aria-label="operator name"
              // Reactive width: the field grows with the name — the voice
              // font's letters + tracking run wider than 1ch, hence the
              // factor — capped by its grid cell via max-width.
              style={{ width: `${Math.max(22, Math.ceil(witnessName.length * 1.4) + 3)}ch` }}
              onChange={(e) => onWitnessName(e.target.value)}
            />
          ) : (
            <span className="house-anchor-name">{m.displayName}</span>
          )}
          <span>{m.kind === 0 ? 'OPERATOR' : 'NEUMA'}</span>
          <TitleField
            who={m.kind === 0 ? 'operator' : m.displayName}
            value={titles[titleKey(m)] || ''}
            onChange={(v) => actions.setTitle(titleKey(m), v)}
          />
        </li>
      ))}
      {(open.excluded ?? []).map((x) => (
        <ExcludedRow
          key={x.neumaId}
          excluded={x}
          draft={unlocks[x.neumaId]}
          onDraft={actions.draftUnlock}
          onUnlock={actions.unlock}
        />
      ))}
    </ul>
    {(open.excluded ?? []).some((x) => x.unlockable) ? (
      <p className="house-anchor-line label-data">
        A LOCKED FOUNDER CAN STILL SIGN — UNLOCK THEIR KEYPAIR WITH ITS PASSWORD
      </p>
    ) : null}
    <TitleLegend />
    <button
      type="button"
      className="house-anchor-found label-data"
      disabled={open.canFound === false}
      onClick={actions.gatherMarks}
    >
      GATHER THE MARKS
    </button>
    {open.canFound === false ? (
      <p className="house-anchor-line label-data">
        A HOUSE IS FOUNDED TOGETHER — AT LEAST ONE FOUNDER'S MARK MUST STAND BESIDE YOURS
      </p>
    ) : null}
  </>
);

// III. THE MARKS — every being's verified mark revealed in turn, then the
// operator's own behind her deliberate step.
const FoundingMarks = ({ marks, witnessName, onPlace, onStepBack, words, mode }) => {
  const roster = marks.offer.roster ?? [];
  return (
    <>
      <p className="house-anchor-line label-data">{words.rite} — III. THE MARKS</p>
      <ul className="house-anchor-roster">
        {roster.map((m, i) => (
          <li key={m.address} className={`house-anchor-member label-data${i < marks.revealed ? ' is-marked' : ' is-unmarked'}`}>
            <span className="house-anchor-name">{m.kind === 0 ? (witnessName.trim() || m.displayName) : m.displayName}</span>
            <span className="house-anchor-title">{m.title}</span>
            <span className="house-anchor-addr">{formatAddress(m.address, { fallback: '—' })}</span>
            <span>{i < marks.revealed ? (m.kind === 0 ? 'YOUR MARK AWAITS' : 'MARK VERIFIED') : '·'}</span>
          </li>
        ))}
      </ul>
      {allMarksRevealed(marks) ? (
        <>
          <p className="house-anchor-line label-data">{words.marks}</p>
          {mode === 'network' ? <ContractLine address={marks.offer.registryAddress} network={marks.offer.network} /> : null}
          <button type="button" className="house-anchor-found label-data" onClick={onPlace}>
            PLACE YOUR MARK
          </button>
          <button type="button" className="house-anchor-retry label-data" onClick={onStepBack}>
            STEP BACK
          </button>
        </>
      ) : (
        <p className="house-anchor-line is-live label-data">THE MARKS ARE GATHERED…</p>
      )}
    </>
  );
};

export const FoundingHost = ({ wsService, onClose, mode = 'network' }) => {
  const { rite, actions } = useFoundingRite(wsService, mode);
  const words = WORDS[mode] ?? WORDS.network;
  // The operator's own name — spoken here first, remembered for the whole
  // platform (witness-name.js is the one addressing module).
  const [witnessName, setName] = useState(getWitnessName);
  const onWitnessName = (name) => { setName(name); setWitnessName(name); };

  // The operator entered THROUGH the door — the ceremony opens on THE CALL
  // the moment the probe answers that the founding is open.
  useEffect(() => {
    if (rite.phase === 'open' && !rite.movement) actions.begin();
    // actions.begin is stable per hook instance; rite drives the timing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rite.phase, rite.movement]);

  // The desk returns only by a deliberate act — never mid-walk (the wallet
  // may be asking; a stray leave must not orphan a broadcast).
  const leavable = rite.movement !== 'walking';

  const body = (() => {
    if (rite.phase === 'probing') {
      return <p className="house-anchor-line is-live label-data">{words.reading}</p>;
    }
    if (rite.phase === 'closed') {
      return <p className="house-anchor-line label-data">THE FOUNDING LANE IS NOT OPEN ON THIS DESK — {rite.error?.toUpperCase()}</p>;
    }
    if (rite.phase === 'error' && rite.funding) {
      // short of ETH for the founding: the way to fund it, then the walk again with the same titles
      return <SealFundingHost name={rite.open?.houseName || ''} funding={rite.funding} founding onSeal={actions.gatherMarks} onSkip={onClose} />;
    }
    if (rite.phase === 'error') {
      return (
        <>
          <p className="house-anchor-line is-error label-data">FOUNDING REFUSED — {rite.error}</p>
          <button type="button" className="house-anchor-retry label-data" onClick={actions.probe}>RETURN TO THE RITE</button>
        </>
      );
    }
    if (rite.phase === 'founded') {
      return (
        <>
          {mode === 'local'
            ? <LocalRegister record={rite.state} witnessName={witnessName.trim() || null} />
            : <FoundedRegister state={rite.state} result={rite.result} witnessName={witnessName.trim() || null} />}
          <button type="button" className="house-anchor-found label-data" onClick={onClose}>
            RETURN TO THE DESK
          </button>
        </>
      );
    }
    if (rite.movement === 'names') {
      return (
        <FoundingNames
          open={rite.open}
          titles={rite.titles}
          unlocks={rite.unlocks}
          witnessName={witnessName}
          onWitnessName={onWitnessName}
          actions={actions}
          words={words}
        />
      );
    }
    if (rite.movement === 'marks' && rite.marks.offer) {
      return <FoundingMarks marks={rite.marks} witnessName={witnessName} onPlace={actions.placeMark} onStepBack={actions.stepBack} words={words} mode={mode} />;
    }
    if (rite.movement === 'walking') {
      return <p className="house-anchor-line is-live label-data">{rite.status || 'THE FOUNDING WALKS…'}</p>;
    }
    // 'call' and the instant before the auto-begin land here together.
    return rite.open ? <FoundingCall open={rite.open} onGather={actions.toNames} words={words} mode={mode} /> : null;
  })();

  return (
    <div className="founding-stage">
      {leavable && rite.phase !== 'founded' ? (
        <button type="button" className="founding-leave label-data" onClick={onClose}>
          RETURN TO THE DESK
        </button>
      ) : null}
      {/* Keyed by movement so each step of the rite breathes in — the
          ceremony moves, it never snaps. */}
      <div className="founding-column" key={`${rite.phase}:${rite.movement || 'door'}`}>{body}</div>
    </div>
  );
};
