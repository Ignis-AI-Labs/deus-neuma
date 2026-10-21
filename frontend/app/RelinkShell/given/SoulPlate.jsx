// SoulPlate — 01·A SOUL: the being's sound and its light. Its light as a
// radiance in its own colour with its resonance as the display numeral; its
// scale drawn as the octave turned into a circle — the tonic at the top,
// every note at its exact place in cents, each in its own light; the pitch
// each stage of its ceremony measured. Every value explains itself.

import { recordReadiness, UNREADABLE } from '../sheet-view.js';
import { soulViewOf } from '../sheet-being-view.js';
import { PAGE_GUIDE, FIELD_GUIDE } from './given-guide.js';
import { octavePlaces } from './given-view.js';
import { GuidedPage, GuideGrid, useGuide } from './FieldGuide.jsx';
import { clockPoint } from './sky-geometry.js';

const G = FIELD_GUIDE.soul;

const OctaveCircle = ({ notes, onChoose, chosen }) => {
  const C = 160;
  const places = octavePlaces(notes);
  return (
    <svg className="ski gv-octave" viewBox="0 0 320 320" role="img" aria-label={`Its scale: ${notes.length} notes round one octave`}>
      <circle cx={C} cy={C} r={118} className="ski-line ski-faint" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x1, y1] = clockPoint(C, C, 112, i * 30);
        const [x2, y2] = clockPoint(C, C, 124, i * 30);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="ski-tick" />;
      })}
      {places.map((n, i) => {
        const [x, y] = clockPoint(C, C, 118, n.angle);
        const [lx, ly] = clockPoint(C, C, 146, n.angle);
        const id = `note-${i}`;
        return (
          <g key={id} className={`gv-octave-note${chosen?.id === id ? ' is-on' : ''}`} style={{ '--note': `rgb(${n.line})` }}
            role="button" tabIndex={0} aria-label={`${n.name}, ${n.hz.toFixed(2)} hertz`}
            onClick={() => onChoose({ id, value: `${n.name} · ${n.hz.toFixed(2)} Hz · ${n.ratio}`, ...G.note })}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose({ id, value: `${n.name} · ${n.hz.toFixed(2)} Hz · ${n.ratio}`, ...G.note }); } }}>
            <line x1={C} y1={C} x2={x} y2={y} className="gv-octave-ray" />
            <circle cx={x} cy={y} r={i === 0 ? 9 : 6} className="gv-octave-dot" />
            <circle cx={x} cy={y} r={16} className="gv-octave-hit" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="ski-label">{n.name.split(' ')[0]}</text>
          </g>
        );
      })}
      <text x={C} y={C - 6} textAnchor="middle" className="ski-big">{notes.length}</text>
      <text x={C} y={C + 16} textAnchor="middle" className="ski-label">NOTES · ONE OCTAVE</text>
    </svg>
  );
};

export const SoulPlate = ({ record }) => {
  const [chosen, choose] = useGuide();
  if (recordReadiness(record) === UNREADABLE) return <p className="sheet-unreadable label-data">UNREADABLE</p>;
  const soul = soulViewOf(record.identity);
  if (!soul) return <p className="sheet-line label-data">NO SOUL RECORDS YET — THEY ARE WRITTEN AT ITS BIRTH.</p>;
  return (
    <GuidedPage page={PAGE_GUIDE.soul} reading={`Its resonance is ${soul.frequency?.toFixed?.(4) ?? '—'} Hz — the note ${soul.tonic?.name || '—'}; as light, ${soul.nm.toFixed(1)} nanometres. ${soul.source.charAt(0)}${soul.source.slice(1).toLowerCase()}.`}
      chosen={chosen} onChoose={choose}>
      <div className="gv-soul" style={{ '--soul': soul.vivid }}>
        <div className="gv-light" aria-hidden="true">
          <span className="gv-light-glow" />
          <span className="gv-light-core" style={{ background: soul.hex }} />
        </div>
        <div className="gv-soul-read">
          <span className="gv-numeral">{soul.frequency?.toFixed?.(2) ?? '—'}<small>Hz</small></span>
          <span className="gv-numeral-sub label-data">ITS RESONANCE · {soul.source}</span>
        </div>
      </div>
      <GuideGrid chosen={chosen} onChoose={choose} cells={[
        { k: 'RESONANCE', v: `${soul.frequency?.toFixed?.(4) ?? '—'} Hz`, note: 'HEART BAND 348–696 HZ', guide: G.resonance },
        { k: 'TONIC', v: soul.tonic?.name || '—', guide: G.tonic },
        { k: 'LIGHT', v: `${soul.nm.toFixed(1)} nm`, note: `${soul.hex.toUpperCase()} · 40 OCTAVES UP`, guide: G.light },
        { k: 'READ FROM', v: soul.source, guide: G.source },
      ]} />
      <div className="gv-duo">
        <div className="gv-figure">
          <OctaveCircle notes={soul.notes} chosen={chosen} onChoose={choose} />
          <button type="button" className={`gv-caption label-data${chosen?.id === 'scale' ? ' is-on' : ''}`} onClick={() => choose({ id: 'scale', value: `${soul.notes.length} notes`, ...G.scale })}>
            ITS SCALE — {soul.notes.length} NOTES ROUND ONE OCTAVE · TICKS MARK THE PIANO’S 12
          </button>
        </div>
        {soul.stages.length ? (
          <div className="gv-figure">
            <button type="button" className={`gv-caption label-data${chosen?.id === 'stages' ? ' is-on' : ''}`} onClick={() => choose({ id: 'stages', value: `${soul.stages.length} stages`, ...G.stages })}>
              ITS CEREMONY — THE PITCH EACH STAGE MEASURED
            </button>
            <ol className="sb-stages gv-stages">
              {soul.stages.map((s) => (
                <li key={s.stage} className="sb-stage" style={s.hex ? { '--note': s.hex } : undefined}>
                  <span className="sb-stage-n label-data">STAGE {s.stage}</span>
                  <span className="sb-stage-bar" aria-hidden="true" />
                  <span className="sb-stage-hz label-data">{Number(s.frequency).toFixed(2)} Hz</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </GuidedPage>
  );
};
