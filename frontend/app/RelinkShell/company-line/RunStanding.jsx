// RunStanding — where each audience stands for a lead run, and its ONE next step in plain words (Design note, 2026-11-21:
// […]). One audience a line: how
// many gathered companies still wait to be screened, how the screened ones came out, how many in a hundred were a
// fit — and NEXT: START A RUN, GATHER MORE, or FEW ARE A FIT when almost nobody screened showed the first sign. The row
// opens onto why, in full: the last misses with the screener's reason for each (the wrong companies, or a sign no page
// says), and which source brought the fits.
// Pure rendering; LeadRun.jsx reads the standing and hands it in.
import { Sheet } from '../sheet/Sheet.jsx';
import { AudienceTest } from './AudienceTest.jsx';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const NEXT = Object.freeze({ running: 'RUNNING NOW', run: 'START A RUN', gather: 'GATHER MORE FIRST', few: 'FEW ARE A FIT — SEE WHY' });
const TONE = Object.freeze({ run: 'on', few: 'alert', gather: 'alert' });

/** @param {{audiences: object[], gathers?: object[], busy?: boolean, onGather?: (audienceId: string, source: string) => void}} props -
 *   audiences: backend lead-run-standing.js, the ones in view · gathers: the list gathers working or just ended */
export const RunStanding = ({ audiences = [], gathers = [], busy = false, onGather = () => {} }) => (audiences.length ? (
  <Sheet label="where each audience stands" rows={audiences} rowKey={(a) => a.id} rowName={(a) => a.name} rowAttrs={(a) => ({ 'data-run-standing': a.id, 'data-run-next': a.next.kind })}
    detailLabel={() => 'what to do next, and why'}
    detail={(a) => (
      <div className="spl-standing">
        <p className="spl-standing-next" data-run-next-words="">{a.next.words}</p>
        {a.firstSign ? <p className="spl-note label-data">ITS FIRST SIGN — WHAT A COMPANY&apos;S OWN PAGE MUST SHOW FOR A RUN TO CALL IT A FIT: “{a.firstSign}”</p> : null}
        {a.misses?.length ? (
          <ol className="spl-standing-src" aria-label={`the last companies screened for ${a.name} and found no fit, with why`}>
            <li className="label-data">THE LAST MISSES, AND WHY EACH WAS NO FIT:</li>
            {a.misses.map((m) => <li key={m.domain} data-run-miss={m.domain}><b>{m.name}</b> ({m.domain}) — {m.why}</li>)}
          </ol>
        ) : null}
        {a.lists?.length ? (
          <div className="spl-run-row" data-run-lists="">
            {a.lists.map((l) => {
              const g = gathers.find((x) => x.segmentId === a.id && x.source === l.source);
              return <button key={l.source} type="button" className="sec-scan label-data" disabled={busy || g?.active} data-run-gather={l.source} onClick={() => onGather(a.id, l.source)}>{g?.active ? `GATHERING FROM ${l.name.toUpperCase()}…` : `GATHER MORE FROM ${l.name.toUpperCase()} (FREE)`}</button>;
            })}
            {gathers.filter((x) => x.segmentId === a.id && !x.active && x.words).map((x) => <span key={x.id} className="spl-note label-data" role="status">{x.name.toUpperCase()}: {x.words}</span>)}
          </div>
        ) : null}
        <AudienceTest audience={a} busy={busy} />
        {a.sources.length ? (
          <ul className="spl-standing-src" aria-label={`where the companies of ${a.name} came from`}>
            {a.sources.map((s) => <li key={s.source}>{s.name.toUpperCase()}: {n(s.waiting)} WAITING · {s.scored ? `${n(s.fit)} OF ${n(s.scored)} SCREENED WERE A FIT` : 'NONE SCREENED YET'}</li>)}
          </ul>
        ) : null}
      </div>
    )}
    columns={[
      { head: 'AUDIENCE', cell: (a) => a.name },
      { head: 'WAIT TO BE SCREENED', cell: (a) => n(a.waiting), sort: (a) => a.waiting },
      { head: 'LOOK LIKELY', cell: (a) => n(a.likely), sort: (a) => a.likely ?? 0, title: () => 'Of those waiting: how many say something of what the audience is in what was gathered about them. A run reads these first.' },
      { head: 'SCREENED', cell: (a) => n(a.screened), sort: (a) => a.screened },
      { head: 'A FIT', cell: (a) => n(a.fit), sort: (a) => a.fit },
      { head: 'FITS IN 100', cell: (a) => (a.inHundred == null ? null : String(a.inHundred)), sort: (a) => a.inHundred ?? -1, tone: (a) => (a.next.kind === 'few' ? 'alert' : undefined) },
      { head: 'LEADS', cell: (a) => n(a.leads), sort: (a) => a.leads },
      { head: 'YOUR EXAMPLES', cell: (a) => (a.examples?.judged ? `${a.examples.kept.length} OF ${a.examples.judged} KEPT` : null), sort: (a) => a.examples?.share ?? -1, tone: (a) => (a.examples?.verdict === 'narrow' ? 'alert' : a.examples?.verdict === 'holds' ? 'on' : undefined), title: () => 'How many of the companies you named as right for this audience it kept. Open the row to test it.' },
      { head: 'NEXT', cell: (a) => NEXT[a.next.kind] ?? a.next.kind.toUpperCase(), tone: (a) => TONE[a.next.kind], text: (a) => a.next.words },
    ]} />
) : null);
