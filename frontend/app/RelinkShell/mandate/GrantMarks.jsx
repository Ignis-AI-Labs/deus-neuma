// GrantMarks — a mandate as marks and numbers (ruling, 2026-10-24): its
// accounts by company with each one's pace a day, its acts (a box filled
// when granted), and — on the grant screen — the term it turns itself off
// after. The grant screen draws the draft (GrantProtocol.jsx); SEAT draws the
// mandate that stands, with a days-left bar in place of the term
// (MandateStanding.jsx; show-dont-tell-audit.md finding 4).

/**
 * @param {{marks: ReturnType<typeof import('./mandate-grant-view.js').grantMarks>, term?: boolean}} props
 *   term — draw the OFF AFTER chip (the grant screen); SEAT draws its days-left bar instead
 */
export const GrantMarks = ({ marks, term = true }) => (
  <div className="mandate-marks" data-mandate-marks>
    {marks.companies.length ? marks.companies.map((c) => (
      <div key={c.name} className="mandate-marks-co">
        <span className="mandate-marks-k">{c.name}</span>
        {c.accounts.map((a) => <span key={a.id} className="mandate-mark-chip">{a.id} · <b>{a.pace}</b>/DAY</span>)}
      </div>
    )) : <div className="mandate-marks-co"><span className="mandate-marks-k">NO ACCOUNT CHOSEN</span></div>}
    <div className="mandate-marks-co">
      <span className="mandate-marks-k">ACTS</span>
      {marks.acts.map((a) => (
        <span key={a.id} className="mandate-mark-chip" data-on={a.on ? 'true' : 'false'} title={a.on ? undefined : `${a.label}: not granted — still asks you`}>
          <span className="mandate-toggle-box" aria-hidden="true" />{a.label}{a.pace ? <> · <b>{a.pace}</b>/DAY</> : null}
        </span>
      ))}
    </div>
    {term ? (
      <div className="mandate-marks-co">
        <span className="mandate-marks-k">OFF AFTER</span>
        <span className="mandate-mark-chip"><b>{marks.days}</b> DAYS · {marks.ends}</span>
      </div>
    ) : null}
  </div>
);
