// SaleProcess — THE SALE, ONE PROCESS, on every position's hub (Design note, 2026-11-16: […]). One folded line per hub: the seven stages every sale of every company walks,
// and which of them this seat works. Open, the stages stand in order as a rail: the law each keeps (Blue Ocean,
// SPIN, the straight line), what is done, the record that proves it, and one press onto that record. The same
// words the seat's holder reads at the top of every turn (backend makoto.js). Pure rendering.

import { Fold } from '../fold/Fold.jsx';
import { saleLine, stageIsMine } from './positions-view.js';

/** @param {{sale: ?{stages: object[], laws: object, parts: object}, position: object, onDoor?: Function}} props */
export const SaleProcess = ({ sale, position, onDoor = null }) => {
  if (!sale?.stages?.length) return null;
  return (
    <Fold id={`sale:${position.office}`} title="THE SALE — ONE PROCESS" stats={saleLine(sale, position.office)}>
      <p className="pos-covers">Every sale of every company walks these stages in order. Blue Ocean says where you stand and for whom, SPIN what to ask, the straight line how to carry it. A stage whose proof is missing has not happened.</p>
      <ol className="pos-sale" aria-label="the stages of a sale">
        {sale.stages.map((s) => (
          <li key={s.id} className={`pos-sale-stage${stageIsMine(s, position.office) ? ' is-mine' : ''}`} data-sale-stage={s.id}>
            <p className="pos-sale-h label-data"><span className="pos-sale-n">{s.n}</span> {s.name}</p>
            <p className="pos-sale-tags"><span className="cline-chip">{sale.laws[s.law] ?? s.law}</span>{stageIsMine(s, position.office) ? <span className="cline-chip is-on">THIS SEAT</span> : null}</p>
            <p className="pos-sale-does">{s.does}</p>
            <p className="pos-sale-proof label-data">PROOF: {String(s.record).toUpperCase()}</p>
            {onDoor ? <button type="button" className="sec-scan cline-mini label-data" aria-label={`OPEN stage ${s.n}, ${s.name}: ${s.record}`} onClick={() => onDoor({ kind: 'position', office: 'cro', tab: s.tab })}>OPEN</button> : null}
          </li>
        ))}
      </ol>
      {sale.parts?.[position.office] ? <p className="pos-covers" data-sale-part="">THIS SEAT&apos;S PART: {sale.parts[position.office]}.</p> : null}
    </Fold>
  );
};
