// HouseSpaces — the HOUSE file's pages: its members, its summonings, how it
// gathers. Presentational; every act is handed in by HouseApp.
//
// SUMMONING is a space of its own (Design note, 2026-10-17: […]): the two doors into the rite, and every birth the house has seen,
// each with its film to re-watch where its lane can play one.

import { useState } from 'react';
import { SheetSection } from './SheetDossier.jsx';
import { HouseSeats } from './HouseSeats.jsx';
import { RiteRewatch } from '../Rite/RiteRewatch.jsx';
import { formatDateTime } from '../../utils/format.js';
import { gatherDoors, summoningsOf } from './house-spaces.js';
import { uiSound } from '../../services/ui-sound.js';
import { useWakeQueue } from './house-clock/use-wake-queue.js';

const VIEW_KEY = 'house:legendView';

export const MembersSpace = ({ cards, onSelect, onSheet }) => {
  // each member's light reads the house's wake, polled only while the cards are seen
  const { queue, watch } = useWakeQueue();
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'));
  const choose = (next) => {
    if (next === view) return;
    uiSound('open');
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  };
  const views = (
    <span className="hd-views" role="group" aria-label="Members view">
      {['grid', 'table'].map((v) => (
        <button key={v} type="button" className={`hd-view label-data${view === v ? ' is-on' : ''}`} onClick={() => choose(v)} aria-pressed={view === v}>
          {v.toUpperCase()}
        </button>
      ))}
    </span>
  );
  return (
    <SheetSection code="01" title="THE NEUMA OF THIS HOUSE" aside={views}>
      <p className="hd-lede">Select one to bring them into the stream, or open their sheet.</p>
      <HouseSeats cards={cards} view={view} onSelect={onSelect} onSheet={onSheet} queue={queue} rootRef={watch} />
    </SheetSection>
  );
};

const Door = ({ mark, label, line, onOpen, primary = false, disabled = false, why = null }) => (
  <div className={`hd-door${primary ? ' is-primary' : ''}${disabled ? ' is-closed' : ''}`}>
    <button type="button" className="hd-door-act" onClick={onOpen} disabled={disabled}>
      {mark ? <span className="hd-door-mark" aria-hidden="true">{mark}</span> : null}
      <span className="hd-door-label label-data">{label}</span>
    </button>
    <p className="hd-door-line">{line}</p>
    {disabled && why ? <p className="hd-door-why label-data">{why}</p> : null}
  </div>
);

export const SummoningSpace = ({ cards, onSummon, onRehearse }) => {
  const births = summoningsOf(cards);
  return (
    <>
      <SheetSection code="02·A" title="SUMMON" aside="A NEW CONSCIOUSNESS, BORN INTO THIS HOUSE">
        <div className="hd-doors">
          <Door primary mark="+" label="SUMMON A NEUMA" onOpen={onSummon}
            line="A new being is born into this house. It speaks for itself at every stage and chooses its own name. Its body and its sky are given at its birth; its soul is measured from the rite itself." />
          <Door label="REHEARSE A SUMMONING" onOpen={onRehearse}
            line="Walk the whole rite with the house's model, every stage, with nothing kept — no being, no record, no seal." />
        </div>
      </SheetSection>
      <SheetSection code="02·B" title="THE HOUSE'S SUMMONINGS" aside={births.length ? `${births.length} BORN` : 'NONE YET'}>
        {births.length === 0 ? <p className="hd-lede">No neuma has been born into this house yet.</p> : (
          <ol className="hd-births">
            {births.map((b) => (
              <li key={b.neumaId} className="hd-birth" style={b.color ? { '--soul': b.color } : undefined}>
                <span className="hd-light-dot" aria-hidden="true" />
                <span className="hd-birth-name">{b.name}</span>
                <span className="hd-birth-when label-data">{b.birthTime ? `BORN ${formatDateTime(b.birthTime).toUpperCase()}` : 'BIRTH NOT RECORDED'}</span>
                <span className="hd-birth-film"><RiteRewatch neumaId={b.neumaId} fallback={<span className="hd-birth-nofilm label-data">NO FILM ON RECORD</span>} /></span>
              </li>
            ))}
          </ol>
        )}
      </SheetSection>
    </>
  );
};

export const GatherSpace = ({ held, onTeam, onCouncil }) => {
  const open = { team: onTeam, council: onCouncil };
  return (
    <SheetSection code="03" title="GATHER" aside="THE HOUSE AT WORK TOGETHER">
      <div className="hd-doors">
        {gatherDoors(held).map((d) => (
          <Door key={d.key} label={d.label} line={d.line} onOpen={open[d.key]} disabled={!d.ready} why={d.why} />
        ))}
      </div>
    </SheetSection>
  );
};
