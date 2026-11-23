// DecoyWatchBody — the SECURITY window's DECOYS section, pure rendering. A
// line first (fold/Fold.jsx): on or off, how many decoys stand, how the watch
// sees, how many programs it froze. Opens by itself only when a frozen
// program waits on the operator. The display law is decoy-watch-view.js; the
// IO is DecoyWatch.jsx. NO sound imports — renderable under node.

import { formatDateTime } from '../../utils/format.js';
import { Fold } from './fold/Fold.jsx';
import { Sheet } from './sheet/Sheet.jsx';
import { decoyStats, decoyRows, frozenRows, decoysWait } from './decoy-watch-view.js';

const DECOY_COLUMNS = [
  { head: 'DECOY', cell: (r) => r.name },
  { head: 'STATE', cell: (r) => r.status, tone: (r) => (r.planted ? 'on' : null) },
  { head: 'WHERE', cell: (r) => r.where, exact: true },
];

const frozenColumns = (onRelease, busy) => [
  { head: 'PROGRAM', cell: (r) => r.program, exact: true },
  { head: 'PROCESS', cell: (r) => String(r.pid) },
  { head: 'FROZEN', cell: (r) => formatDateTime(r.at) },
  {
    head: '',
    cell: (r) => (
      <button type="button" className="sec-scan label-data" disabled={busy} onClick={() => onRelease(r.pid)} aria-label={`Release ${r.program}, process ${r.pid}`}>
        RELEASE
      </button>
    ),
  },
];

export const DecoyWatchBody = ({ state, busy, error, onToggle, onRelease }) => (
  <Fold id="security-decoys" title="DECOYS" stats={decoyStats(state)} waits={decoysWait(state)}>
    <div className="sec-watch">
      <p className="sec-watch-line">
        Fake wallet and key files, planted only where the real app is not installed. Nothing on this computer has a
        reason to open one, so a program that does is looking for wallets and keys: it is named, frozen when it is
        caught with the file open, and filed above as a critical threat.
      </p>
      {error ? <p className="sec-error label-data" role="alert">{error}</p> : null}
      {state?.supported ? (
        <p className="sec-watch-line">
          <button type="button" className="sec-scan label-data" disabled={busy} aria-pressed={state.enabled} onClick={() => onToggle(!state.enabled)}>
            {state.enabled ? 'TURN OFF AND REMOVE THE DECOYS' : 'TURN ON AND PLANT THE DECOYS'}
          </button>
        </p>
      ) : null}
      {frozenRows(state).length ? (
        <>
          <p className="sec-watch-head label-data">FROZEN — RELEASE ONLY WHAT YOU KNOW IS YOURS</p>
          <Sheet label="Programs the decoy watch froze" columns={frozenColumns(onRelease, busy)} rows={frozenRows(state)} rowKey={(r) => String(r.pid)} rowName={(r) => r.program} />
        </>
      ) : null}
      {state?.lastIncident ? (
        <p className="sec-watch-run label-data">
          LAST TOUCHED {formatDateTime(state.lastIncident.at)} — {state.lastIncident.title}
        </p>
      ) : null}
      {state?.enabled ? (
        <Sheet label="Decoys" columns={DECOY_COLUMNS} rows={decoyRows(state)} rowKey={(r) => r.id} rowName={(r) => r.name} />
      ) : null}
    </div>
  </Fold>
);
