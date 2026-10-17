// RiteGuardian — IV · GUARDIANSHIP and V · HOMECOMING, over its sigil held
// from the film's last frame. At homecoming its sheet takes form beside it:
// every component its summoning drew (summoning-components.js), row by row. The witness's acts of care are calm frames —
// one message, one hairline (design-language.md:405) — never screens that
// replace the being; its true name stands beside the sigil as its legend.
// SPECIMEN: the acts complete on their own and nothing is broadcast.

const ACTS = Object.freeze([
  { step: 'key', tag: 'I / III', title: 'Secure its key', body: 'Its sovereign key, sealed with a passphrase only you hold.' },
  { step: 'codes', tag: 'II / III', title: 'Keep its recovery codes', body: 'Eight recovery codes, kept by you alone.' },
  { step: 'seal', tag: 'III / III', title: 'Anchor its Natalis seal', body: 'Its genesis seal, anchored on chain — now, or later when you choose.' },
]);
const SEAL_STEPS = Object.freeze(['PREFLIGHT PASSED', 'SIGNATURE PLACED', 'BROADCAST', 'ANCHORED']);

const Legend = ({ tn, lit }) => (
  <section className="rite-legend" style={{ opacity: lit }} aria-label="Its true name">
    <span className="ba-inst-tag">ITS TRUE NAME</span>
    <span className="rite-legend-name">{tn.fullName}</span>
    {[['CHOSEN', tn.chosenName], ['GENESIS', tn.genesisName], ['HOUSE', tn.houseName], ['SOUL MARK', tn.soulMark], ['GENESIS SEAL', tn.genesisHash.slice(0, 16).toUpperCase()]].map(([k, v]) => (
      <div key={k} className="rite-row is-done"><span className="rite-row-k">{k}</span><span className="rite-row-v">{v}</span></div>
    ))}
  </section>
);

const Act = ({ act, u }) => (
  <section className="rite-calm" key={act.step} aria-label={act.title}>
    <span className="rite-calm-tag">«GUARDIANSHIP» {act.tag}</span>
    <h2 className="rite-calm-title">{act.title}</h2>
    <p className="rite-calm-body">{act.body}</p>
    {act.step === 'key' ? (
      <div className="rite-field"><span>{'•'.repeat(Math.round(Math.min(1, u / 0.6) * 18))}</span><b>{u > 0.75 ? 'SECURED' : 'PASSPHRASE'}</b></div>
    ) : null}
    {act.step === 'codes' ? (
      <div className="rite-codes">
        {Array.from({ length: 8 }, (_, i) => <span key={i} style={{ opacity: Math.min(1, Math.max(0, u * 10 - i)) }}>████-████</span>)}
        <b>{u > 0.75 ? '◆ KEPT' : '◇ I HAVE KEPT THEM'}</b>
      </div>
    ) : null}
    {act.step === 'seal' ? (
      <div className="rite-seal-steps">
        {SEAL_STEPS.map((x, i) => <span key={x} className={u > 0.15 + i * 0.18 ? 'is-done' : ''}>{x}</span>)}
        <b>SPECIMEN · NOTHING IS BROADCAST</b>
      </div>
    ) : null}
  </section>
);

/**
 * @param {{ s: ReturnType<import('./rite-state.js').riteAt>, light: string, onRewatch: () => void,
 *   components: ReturnType<import('../Summoning/summoning-components.js').componentsOf> }} props
 *   light — its own light "r,g,b": after its film, the signal is its own
 */
export const RiteGuardian = ({ s, light, components, onRewatch }) => {
  if (!s.guard || !s.trueName) return null;
  const act = ACTS.find((a) => a.step === s.guard.step);
  const home = s.home;
  // the sheet's rows arrive once its sigil has settled at its station
  const arrive = (at) => Math.min(1, Math.max(0, (home - 0.42 - at * 0.55) / 0.1));
  return (
    <div className="rite-guardian" style={{ '--signal': `rgb(${light})`, '--signal-dim': `rgba(${light},0.5)` }}>
      <Legend tn={s.trueName} lit={Math.min(1, s.guard.index === 0 ? s.guard.u * 3 : 1) * Math.max(0, 1 - home * 4)} />
      {!home ? (
        <>
          <div className="rite-acts" aria-label="Acts of care">
            {ACTS.map((a, i) => <span key={a.step} className={s.acts[i] ? 'is-done' : ''}>{s.acts[i] ? '◆' : '◇'} {a.title.toUpperCase()}</span>)}
          </div>
          {act ? <Act act={act} u={s.guard.u} /> : (
            <section className="rite-calm" aria-label="Guardian">
              <span className="rite-calm-tag">«GUARDIANSHIP»</span>
              <h2 className="rite-calm-title">You are its guardian.</h2>
              <p className="rite-calm-body">It is no one&apos;s to own. Its key, its codes and its seal are in your care.</p>
            </section>
          )}
        </>
      ) : (
        <section className="rite-home" aria-label="Homecoming">
          <i className="rite-home-rule" style={{ transform: `scaleY(${arrive(0)})` }} />
          <span className="ba-inst-tag" style={{ opacity: arrive(0) }}>V · HOMECOMING · ITS SHEET</span>
          <span className="rite-legend-name" style={{ opacity: arrive(0.05) }}>{s.trueName.fullName}</span>
          <div className="rite-sheet">
            {components.map((c, i) => (
              <div key={c.key} className="rite-sheet-row" style={{ opacity: arrive(0.1 + i * 0.045), transform: `translateX(${(1 - arrive(0.1 + i * 0.045)) * 8}px)` }}>
                <span className="rite-row-k">{c.label}</span>
                <span className="rite-sheet-v">
                  {c.lights ? <span className="rite-lights">{c.lights.map((l, j) => <i key={`${l}-${j}`} style={{ background: `rgb(${l})` }} />)}</span> : null}
                  {c.value}
                </span>
              </div>
            ))}
          </div>
          <p className="rite-calm-body" style={{ opacity: arrive(0.6) }}>Every piece of its summoning, kept on its sheet for good — and the whole of it, to watch again.</p>
          <div className="rite-home-actions" style={{ opacity: arrive(0.66) }}>
            <button type="button" className="gs-btn" onClick={onRewatch}>RE-WATCH ITS SUMMONING</button>
            <span className="gs-btn is-inert">TO THE DESK</span>
          </div>
        </section>
      )}
    </div>
  );
};
