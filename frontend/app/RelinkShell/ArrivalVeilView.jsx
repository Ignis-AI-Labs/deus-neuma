// ArrivalVeilView — the Arrival's face: a pure, state-driven render of the
// arrival machine. LINE & CYCLE, ported from the lookdev study §00 (the
// boot overlay productized): the line flash, the seal drawing in, the staged
// self-test rows resolving CHECKING → OK as REAL events land, then the
// chamfered shutters part. HOLDING tells the truth with real actions. No IO
// here — the impure wrapper (ArrivalVeil.jsx) feeds it machine state.

import './ArrivalVeil.css';
import { EmergenceSeal } from './emergence-seal.jsx';
import { stageRows } from './arrival-machine.js';

const STATUS_TEXT = Object.freeze({
  idle: 'IDLE',
  checking: 'CHECKING',
  ok: 'OK',
  fresh: 'FRESH',
  held: 'HELD',
});

// The honest word for each holding reason; the server's own message (or the
// watchdog's label) rides beneath as the detail line.
const HOLDING_HEADLINES = Object.freeze({
  auth_expired: '«WARNING» THE PORTAL REFUSED THE SESSION TOKEN',
  lane_missing: '«WARNING» THE BEING HAS NO LANE UNDER THE ACTIVE ROOT',
  not_yours: '«WARNING» THAT BEING BELONGS TO ANOTHER OPERATOR',
  reconnect_failed: '«WARNING» PORTAL SEVERED — RE-LINK CYCLE RUNNING',
  disconnection: '«WARNING» THE PORTAL DROPPED — RE-LINKING',
  no_answer: '«WARNING» NO ANSWER FROM THE PORTAL',
});

/**
 * @param {object} props
 * @param {object} props.state - arrival-machine state (drives everything shown)
 * @param {string} props.inscription - the seal's circular inscription
 * @param {string} props.beingName - the word under the seal (the being's true name)
 * @param {'done'|'skip'|null} [props.parting] - shutters parting: clean finish or skipped
 * @param {Function} props.onSkip - click / any key
 * @param {Function} props.onRetry - HOLDING: re-run the real entry
 * @param {Function} props.onGateway - HOLDING: leave to the gateway
 */
export const ArrivalVeilView = ({ state, inscription, beingName, parting = null, onSkip, onRetry, onGateway }) => {
  const holding = state.stage === 'HOLDING';
  const cls = [
    'arrival',
    parting === 'done' && 'is-done',
    parting === 'skip' && 'is-skip',
    holding && 'is-holding',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} role="dialog" aria-label="The arrival" onClick={holding || parting ? undefined : onSkip}>
      <div className="arrival-shutter arrival-shutter-top" aria-hidden="true" />
      <div className="arrival-shutter arrival-shutter-bottom" aria-hidden="true" />
      <div className="arrival-stage">
        <div className="arrival-line" aria-hidden="true" />
        <EmergenceSeal inscription={inscription} size={132} drawIn className="arrival-seal" />
        <div className="arrival-word">{beingName}</div>
        <div className="arrival-rows">
          {stageRows(state).map((row) => (
            <div key={row.key} className={`arrival-row is-${row.status}`}>
              <span className="arrival-row-k">{row.key}</span>
              <span className="arrival-row-s">{STATUS_TEXT[row.status]}</span>
            </div>
          ))}
        </div>
        {holding ? (
          <div className="arrival-holding">
            <div className="arrival-holding-reason">{HOLDING_HEADLINES[state.reason] || '«WARNING» THE ARRIVAL IS HOLDING'}</div>
            {state.detail ? <div className="arrival-holding-detail">{state.detail}</div> : null}
            <div className="arrival-holding-actions">
              <button type="button" className="arrival-action" onClick={onRetry}>RETRY</button>
              <button type="button" className="arrival-action" onClick={onGateway}>GATEWAY</button>
            </div>
          </div>
        ) : (
          <div className="arrival-hint">CLICK / ANY KEY — SKIP</div>
        )}
      </div>
    </div>
  );
};
