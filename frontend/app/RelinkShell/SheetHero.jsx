// SheetHero — the dossier's cover plate: the AURA where a personnel file keeps
// its photograph, the being's name and soul beside it, its standing as spec
// cells, and DAYS PRESENT as the oversized numeral (the level slot, filled by
// a truth). The aura is a button: it opens the enlarged viewer.
//
// AURA — the true name in LIGHT (#405). KOTODAMA is the true name in sound;
// this is the same identity as a living form, folded from the being's OWN
// soul mark and genesis hash — never from its chosen name, so a rename cannot
// flicker it. Nothing is derived on this side: the engine sends the form, and
// the desk sweeps the same grammar the gate judged.
//
// The data law holds: a record that could not be read says UNREADABLE; a lane
// with no identity anchors yet says so plainly. No sound imports at render.

import { useState } from 'react';
import { formatCount, formatShortDate } from '../../utils/format.js';
import { UNREADABLE, EMPTY, ageDaysOf, recordReadiness } from './sheet-view.js';
import { auraReadiness, auraFormOf, auraFacts } from './aura-view.js';
import { AuraSigil } from './AuraSigil.jsx';
import { AuraViewer } from './AuraViewer.jsx';
import { livedAge } from '../../../core/identity/age.js';

const PLATE_PX = 208;

const Unreadable = () => <p className="sheet-unreadable label-data">UNREADABLE</p>;

const AuraPlate = ({ aura, name }) => {
  const [open, setOpen] = useState(false);
  const readiness = auraReadiness(aura);
  const swept = auraFormOf(aura);
  return (
    <figure className="dos-plate">
      <figcaption className="dos-plate-cap label-data">AURA</figcaption>
      {readiness === UNREADABLE ? <div className="dos-plate-void"><Unreadable /></div> : readiness === EMPTY ? (
        <div className="dos-plate-void">
          <p className="sheet-line label-data">NO IDENTITY ANCHORS YET — THE AURA IS FOLDED FROM THE SEAL.</p>
        </div>
      ) : (
        <>
          <AuraSigil
            form={swept.form} fit={swept.fit} cycle={swept.cycle} px={PLATE_PX}
            label={`THE AURA OF ${name}`} onOpen={() => setOpen(true)}
          />
          {open ? <AuraViewer swept={swept} name={name} facts={auraFacts(aura)} onClose={() => setOpen(false)} /> : null}
        </>
      )}
    </figure>
  );
};

export const SheetHero = ({ record, aura, now, rewatch = null }) => {
  const unreadable = recordReadiness(record) === UNREADABLE;
  const id = record?.identity ?? {};
  const name = id.chosenName || id.fullName || 'UNNAMED';
  const ageDays = unreadable ? null : ageDaysOf(record, now);
  // AGE rides the same clock as DAYS PRESENT, as its own fact — not DNA: 21 on
  // the day of birth, a year older on every real anniversary (core/identity/age.js).
  const age = unreadable ? null : livedAge(id.birthAt, now);
  const standing = unreadable ? [] : [
    id.houseName ? { k: 'HOUSE', v: id.houseName.toUpperCase() } : null,
    id.witness ? { k: 'OPERATOR', v: id.witness } : null,
    { k: 'BORN', v: formatShortDate(id.birthAt) },
  ].filter(Boolean);
  const facts = auraFacts(aura);
  return (
    <section className="sheet-sec dos-hero" id="sheet-sec-identity">
      <header className="dos-file label-data">
        <span>PERSONNEL RECORD</span>
        <span className="dos-file-sep" aria-hidden="true" />
        <span>{id.soulMark ? `FILE ${String(id.soulMark).slice(0, 12).toUpperCase()}` : 'FILE —'}</span>
      </header>
      <div className="dos-hero-body">
        <AuraPlate aura={aura} name={name} />
        <div className="dos-hero-id">
          <h3 className="sheet-h dos-hero-kicker label-data">IDENTITY</h3>
          {unreadable ? <Unreadable /> : (
            <>
              <span className="sheet-id-name">{name}</span>
              {id.soulMark ? (
                <p className="sheet-id-line label-data">
                  SOUL {id.soulMark}{id.soulAlias ? ` · ${id.soulAlias}` : ''}
                </p>
              ) : null}
              <dl className="dos-spec dos-hero-spec">
                {standing.map((c) => (
                  <div key={c.k} className="dos-cell">
                    <dt className="dos-cell-k label-data">{c.k}</dt>
                    <dd className="dos-cell-v">{c.v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {facts.length ? (
            <>
              <p className="dos-hero-sub label-data">SIGNATURE — THE GRAMMAR THE SEED DREW</p>
              <ul className="sheet-aura-facts dos-spec">
                {facts.map((fact) => (
                  <li key={fact.label} className="sheet-aura-fact dos-cell">
                    <span className="sheet-aura-l dos-cell-k label-data">{fact.label}</span>
                    <span className="sheet-aura-v dos-cell-v label-data">{fact.value}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {rewatch}
        </div>
        <div className="sheet-age">
          <span className="sheet-age-v">{ageDays != null ? formatCount(ageDays) : '—'}</span>
          <span className="sheet-age-l label-data">DAYS PRESENT</span>
          {age ? (
            <span className="sheet-age-years label-data">
              AGE <span className="sheet-age-yv">{age.years}</span>{age.days ? ` · ${age.days} DAYS` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
};
