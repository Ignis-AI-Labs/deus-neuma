// token-performance.jsx — the ACTIVITY panel's token sections beside its live
// instruments: the reply streaming now (or the last one), the last replies
// together, and the server since it started. Rows come from token-rows.js.

import './token-performance.css';
import { StackBar } from './hud-instruments.jsx';
import { lifetimeRows, phaseParts, recentRows, replyRows } from './token-rows.js';

/** A column of label · value rows; the active phase of a streaming reply is lit. */
const FactRows = ({ rows }) => (
  <dl className="tok-facts">
    {rows.map((r) => (
      <div key={r.k} className={`tok-fact${r.active ? ' is-active' : ''}`}>
        <dt className="hud-label">{r.k}</dt>
        <dd>
          <b>{r.v}</b><span className="hud-unit">{r.unit}</span>
          {r.sub ? <span className="tok-sub">{r.sub}</span> : null}
        </dd>
      </div>
    ))}
  </dl>
);

const Head = ({ title, live }) => (
  <h4 className="tok-head hud-label">{live ? <i className="tok-live" aria-hidden="true" /> : null}{title}</h4>
);

/**
 * The three token columns. `view` is replyInView(tokens) — computed once by
 * the panel, which also names how many replies stream in its title row.
 */
export const TokenColumns = ({ tokens, view }) => {
  const reply = view?.reply ?? null;
  const parts = reply ? phaseParts(reply) : null;
  const replies = tokens?.summary?.replies ?? 0;
  return (
    <>
      <section className="tok-col">
        <Head title={view?.live ? 'THIS REPLY' : 'LAST REPLY'} live={view?.live} />
        {parts ? <StackBar parts={parts} total={parts.reduce((n, p) => n + p.value, 0)} legend={false} /> : null}
        {reply ? <FactRows rows={replyRows(reply, view.live)} /> : <p className="sub-empty-row label-data">no reply yet</p>}
      </section>
      <section className="tok-col">
        <Head title={replies ? `LAST ${replies} ${replies === 1 ? 'REPLY' : 'REPLIES'}` : 'RECENT REPLIES'} />
        <FactRows rows={recentRows(tokens?.summary)} />
      </section>
      <section className="tok-col">
        <Head title="SINCE SERVER START" />
        <FactRows rows={lifetimeRows(tokens?.lifetime)} />
      </section>
    </>
  );
};
