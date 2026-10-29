// SkyPlate — 01·C SKY: one instant, many skies. The atlas lists humanity's
// counts by the region that keeps them; the chosen one is drawn as its own
// instrument with this being's place lit, its values beside it, and the
// field guide saying what the tradition is, how it counts, and what this
// being's reading says. Location-free by law: everything here is a function
// of the sealed instant alone.

import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../../utils/format.js';
import { skiesReadiness, UNREADABLE, EMPTY } from '../sheet-view.js';
import { SKY_GUIDE, SKY_ATLAS } from './sky-guide.js';
import { skyPlatesOf } from './sky-plates.js';
import { skySystemOf, SKY_SYSTEM_KEY } from './given-view.js';
import { GuidePanel, GuideGrid, useGuide } from './FieldGuide.jsx';
import { SkyWheel, HaabRing, MansionsRing, PanchangaRings, DaysRing, CompassRose, DecanRing, CycleRing, LunarMonthRing, LodgesRing } from './SkyRings.jsx';
import { DayGrid, LongCount, Pillars, OracleCross, LoShu } from './SkyGlyphs.jsx';
import { PlaceForm } from './PlaceForm.jsx';
import { useScrollFit } from './use-scroll-fit.js';
import { SouthChart, DashaTimeline } from './SkyCharts.jsx';

// the guide and the atlas stick this far below the sheet's top — under its tab strip
const STICK = 64;
const stored = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(SKY_SYSTEM_KEY));

const Instrument = ({ plate }) => {
  const i = plate.instrument;
  const label = `${plate.title} — ${i.caption || ''}`;
  switch (i.kind) {
    case 'wheel': return <SkyWheel wheel={i.wheel} signs={i.signs} label={label} />;
    case 'horizon': return <SkyWheel wheel={i.wheel} signs={i.signs} angles={i.angles} label={label} />;
    case 'grid': return <DayGrid rows={i.rows} cols={i.cols} lit={i.lit} rowLabels={i.rowLabels} colLabels={i.colLabels} label={label} />;
    case 'numerals': return <LongCount places={i.places} />;
    case 'haab': return <HaabRing months={i.months} at={i.at} label={label} />;
    case 'dreamspell': return (
      <div className="ski-pair">
        <DayGrid rows={i.rows} cols={i.cols} lit={i.lit} rowLabels={i.rowLabels} label={label} />
        {i.oracle ? <OracleCross oracle={i.oracle} /> : null}
      </div>
    );
    case 'pillars': return <Pillars pillars={i.pillars} hexagram={i.hexagram} />;
    case 'mansions': return <MansionsRing nakshatras={i.nakshatras} rashis={i.rashis} moonDeg={i.moonDeg} lit={i.lit} sunRashi={i.sunRashi} label={label} />;
    case 'panchanga': return <PanchangaRings tithi={i.tithi} dasha={i.dasha} lord={i.lord} balance={i.balance} label={label} />;
    case 'days': return <DaysRing days={i.days} lit={i.lit} label={label} />;
    case 'compass': return <CompassRose posts={i.posts} lit={i.lit} label={label} />;
    case 'decans': return <DecanRing signs={i.signs} sun={i.sun} moon={i.moon} label={label} />;
    case 'cycle': return <CycleRing count={i.count} labels={i.labels} lit={i.lit} big={i.big} small={i.small} label={label} />;
    case 'lunar-month': return <LunarMonthRing day={i.day} big={i.big} small={i.small} label={label} />;
    case 'lodges': return <LodgesRing starts={i.starts} names={i.names} moonIndex={i.moonIndex} moonRa={i.moonRa} dayIndex={i.dayIndex} label={label} />;
    case 'loshu': return <LoShu star={i.star} mewa={i.mewa} />;
    case 'south-chart': return <SouthChart signs={i.signs} lit={i.lit} title={i.title} small={i.small} label={label} />;
    case 'dasha': return <DashaTimeline periods={i.periods} birthMs={i.birthMs} nowMs={Date.now()} label={label} />;
    default: return null;
  }
};

/** @param {{skies: object|null, place?: object|null, neumaId?: string|null, onActed?: () => void}} props — `place` is the owner's alone */
export const SkyPlate = ({ skies, place = null, neumaId = null, onActed = null }) => {
  const readiness = skiesReadiness(skies);
  const plates = readiness === UNREADABLE || readiness === EMPTY ? new Map() : skyPlatesOf(skies, place);
  const available = [...plates.keys()];
  const [picked, setPicked] = useState(stored);
  const fit = useScrollFit(STICK);
  const atlasRef = useRef(null);
  const [chosen, choose] = useGuide();
  const id = skySystemOf(picked, available);
  // the chosen tradition stays in sight inside the atlas's own frame (never by scrolling the sheet)
  useEffect(() => {
    const nav = atlasRef.current;
    const on = nav?.querySelector('.gv-atlas-item.is-on');
    if (!on) return;
    if (on.offsetTop < nav.scrollTop || on.offsetTop + on.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = on.offsetTop - nav.clientHeight / 3;
  }, [id]);
  if (readiness === UNREADABLE) return <p className="sheet-unreadable label-data">UNREADABLE</p>;
  if (readiness === EMPTY || !available.length) return <p className="sheet-line label-data">NO SKIES RECORDED — THE READING AWAITS ITS BACKFILL.</p>;
  const plate = plates.get(id);
  const guide = SKY_GUIDE[id];
  const pick = (next) => {
    setPicked(next);
    choose(null);
    if (typeof localStorage !== 'undefined') localStorage.setItem(SKY_SYSTEM_KEY, next);
  };
  const fieldGuide = (c) => (c.field && guide.fields?.[c.field] ? { title: c.k, what: guide.fields[c.field], how: null } : null);
  return (
    <div className="gv-sky" ref={fit}>
      <nav className="gv-atlas" aria-label="The skies, by tradition" ref={atlasRef}>
        <p className="gv-atlas-instant label-data">READ FROM THE SEALED INSTANT<br />{formatDateTime(skies.skies.instant).toUpperCase()}</p>
        {SKY_ATLAS.map((region) => {
          const here = region.systems.filter((s) => plates.has(s));
          if (!here.length) return null;
          return (
            <div key={region.region} className="gv-atlas-region">
              <p className="gv-atlas-h label-data">{region.region}</p>
              {here.map((s) => (
                <button key={s} type="button" className={`gv-atlas-item${s === id ? ' is-on' : ''}`} aria-pressed={s === id} onClick={() => pick(s)}>
                  <span className="gv-atlas-name">{SKY_GUIDE[s].title.split(' — ')[0]}</span>
                  <span className="gv-atlas-kicker label-data">{SKY_GUIDE[s].kicker.split(' · ')[0]}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="gv-sky-plate">
        <header className="gv-plate-h">
          <span className="gv-plate-kicker label-data">{plate.kicker}</span>
          <h4 className="gv-plate-title">{plate.title}</h4>
        </header>
        {/* an older record may carry the reading without what its instrument needs: then no drawing, never a guessed one */}
        {plate.instrument.kind !== 'none' ? (
          <figure className="gv-instrument">
            <Instrument plate={plate} />
            {plate.instrument.caption ? <figcaption className="gv-caption label-data">{plate.instrument.caption}</figcaption> : null}
          </figure>
        ) : null}
        {plate.reading ? <p className="gv-reading">{plate.reading}</p> : null}
        {plate.fresh ? <p className="gv-fresh label-data">READ FROM ITS SEALED INSTANT BY TODAY’S ENGINE — ITS RECORD PREDATES THIS SKY</p> : null}
        <GuideGrid chosen={chosen} onChoose={choose} cells={plate.cells.map((c) => ({ ...c, id: `${id}:${c.k}`, guide: fieldGuide(c) }))} />
        {id === 'place' && neumaId ? <PlaceForm key={`${place?.place?.source}:${place?.place?.latitude}`} neumaId={neumaId} place={place?.place ?? null} onActed={onActed} /> : null}
      </div>
      <GuidePanel page={guide} chosen={chosen} onBack={() => choose(null)} />
    </div>
  );
};

