// RiteLive — II · THE STAGES and THE FORGING, the witness's plane over
// the living birth art: the operator's words, the being's speech, the
// continue, THE MEASURE (each stage's own pitch, measured as it lands) and
// the forging. Transform and opacity are the only motion.
//
// SPECIMEN: no being speaks here, so its speech is drawn as the lines it
// fills — one per burst of chunks, at the rhythm they arrived; a live rite
// puts its words in the same panel.

import { OPERATOR_WORDS, SPECIMEN_WITNESS } from './rite-script.js';
import { romanOf } from '../Summoning/summoning-paint.js';

const NM = [380, 780];
const CHUNKS_PER_LINE = 14;
const LINES_SHOWN = 9;
const widthOf = (stage, i) => 58 + ((stage * 131 + i * 71) % 41); // a line's length, %

const Speech = ({ c }) => {
  const stage = c.stages[c.stage];
  if (!stage) return null;
  const lines = Math.ceil(stage.chunks / CHUNKS_PER_LINE);
  const from = Math.max(0, lines - LINES_SHOWN);
  const waiting = stage.chunks === 0;
  return (
    <section className="rite-panel rite-speech" aria-label="The being speaks">
      <span className="ba-inst-tag">ITS WORDS</span>
      <div className="rite-speech-lines">
        {Array.from({ length: lines - from }, (_, k) => {
          const i = from + k;
          const last = i === lines - 1 && stage.end === null;
          const fill = last ? ((stage.chunks % CHUNKS_PER_LINE) || CHUNKS_PER_LINE) / CHUNKS_PER_LINE : 1;
          return <span key={i} className="rite-speech-line" style={{ transform: `scaleX(${(widthOf(c.stage, i) / 100) * fill})` }} />;
        })}
        {waiting ? <span className="rite-typing"><i /><i /><i /></span> : null}
      </div>
      <span className="rite-panel-foot">SPECIMEN · NO BEING SPEAKS · ITS WORDS STREAM HERE</span>
    </section>
  );
};

const Operator = ({ c, answering }) => {
  const stage = answering ? c.stage + 1 : c.stage;
  const words = OPERATOR_WORDS[stage];
  if (!words) return null;
  return (
    <section className={`rite-panel rite-operator${answering ? ' is-answering' : ''}`} aria-label="The witness speaks">
      <span className="ba-inst-tag">{answering ? 'YOUR WORDS FOR THE NEXT STAGE' : `OPERATOR — ${SPECIMEN_WITNESS.toUpperCase()}`}</span>
      <p className="rite-operator-words">{words.replace('[witness_name]', SPECIMEN_WITNESS)}</p>
      {answering ? <span className="rite-continue">CONTINUE</span> : null}
    </section>
  );
};

// THE MEASURE — the visible octave as a graduated hairline (monochrome at
// rest); each stage's measured pitch stands on it in its own light, and the
// latest reads out beneath.
const Measure = ({ measure }) => {
  const x = (nm) => `${((Math.min(NM[1], Math.max(NM[0], nm)) - NM[0]) / (NM[1] - NM[0])) * 100}%`;
  const latest = measure.at(-1);
  return (
    <section className="rite-measure" aria-label="The measure">
      <span className="rite-measure-tag">THE MEASURE · {measure.length} / 7 · EACH STAGE&apos;S OWN PITCH, MEASURED — NEVER CHOSEN</span>
      <div className="rite-measure-rail">
        {[400, 450, 500, 550, 600, 650, 700, 750].map((nm) => (
          <span key={nm} className={`rite-grad${nm % 100 === 0 ? ' is-major' : ''}`} style={{ left: x(nm) }}>{nm % 100 === 0 ? <b>{nm} NM</b> : null}</span>
        ))}
        {measure.map((m) => (
          <span key={m.stage} className="rite-mark" style={{ left: x(m.nm), opacity: m.lit, color: `rgb(${m.line})` }}>
            <i className="rite-mark-tick" style={{ transform: `scaleY(${m.lit})` }} />
          </span>
        ))}
      </div>
      <span className="rite-measure-read" style={latest ? { color: `rgb(${latest.line})` } : undefined}>
        {latest ? `STAGE ${romanOf(latest.stage + 1)} · ${latest.frequency.toFixed(2)} HZ · ${latest.nm.toFixed(1)} NM` : 'AWAITING ITS FIRST STAGE'}
      </span>
    </section>
  );
};

const Forging = ({ forge }) => (
  <section className="rite-panel rite-forge" aria-label="The forging">
    <span className="ba-inst-tag">THE FORGING · {forge.steps.filter((x) => x.done).length} / {forge.steps.length}</span>
    {forge.steps.map((x) => (
      <div key={x.name} className={`rite-row${x.done ? ' is-done' : ''}`}>
        <span className="rite-row-k">{x.name}</span>
        <span className="rite-row-v">{x.done ? 'FORGED' : '—'}</span>
      </div>
    ))}
  </section>
);

/**
 * @param {{ s: ReturnType<import('./rite-state.js').riteAt>, c: ReturnType<import('../BirthArt/birth-art-ceremony.js').ceremonyAt>,
 *   art: ReturnType<import('../BirthArt/birth-art-state.js').artAt>, live?: boolean }} props
 *   live — a real ceremony (RiteCeremony): its own panels carry the words
 */
export const RiteLive = ({ s, c, art, live = false }) => {
  const forging = s.movement === 'forging';
  const stage = c.stages[c.stage];
  const answering = !forging && stage && stage.end !== null && c.stage < c.stages.length - 1;
  const caption = forging
    ? { index: 'THE FORGING', title: 'ITS SEAL · ITS NAME · ITS SOUL', line: 'FORGED FROM WHAT THE CEREMONY MEASURED · NOTHING CHOSEN' }
    : art.caption;
  return (
    <div className="rite-live" style={{ opacity: s.piece }}>
      {/* live, the ceremony's own panels carry its words and the operator's; a
          re-watch has none to show — a kept rite holds no words */}
      {!live && !forging && c.stage >= 0 ? <Operator c={c} answering={answering} /> : null}
      {!live && !forging && c.stage >= 0 ? <Speech c={c} /> : null}
      {forging ? <Forging forge={s.forge} /> : null}
      {c.stage >= 0 ? <Measure measure={s.measure} /> : null}
      {caption ? (
        <div className="gen-caption" key={caption.index + caption.title}>
          <span className="gen-caption-movement">II · {caption.index}</span>
          <span className="gen-caption-title">{caption.title}</span>
          <span className="gen-caption-line">{caption.line}</span>
        </div>
      ) : null}
    </div>
  );
};
