// BenchRelight — the OVERVIEW's recovery panel, pure rendering. It stands
// only while serving is DOWN. Two honest shapes: the driver-silent shape
// (relight is pointless into a dead driver — the panel says so and offers
// nothing) and the relight shape (model picker, a «WARNING» confirm — a swap
// drops whatever rides the endpoint — then the act, with the server's refusal
// verbatim or who now stands).

import './BenchApp.css';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { modelLabel, relightResultLines } from './bench-view.js';

export const BenchRelight = ({
  gpu, models, model, onModel, busy, refusal, outcome, confirm, onAsk, onCancel, onRelight,
}) => {
  // The driver-silent shape: no button, no picker — the truth and its remedy.
  if (gpu && gpu.ok === false) {
    return (
      <section className="bench-sec">
        <p className="bench-sec-head label-data">RELIGHT SERVING</p>
        <p className="bench-line label-data is-alert">
          «WARNING» THE GPU DRIVER IS NOT ANSWERING — only the operator can recover it
          (module reload or clean reboot). Relight is pointless into a dead driver.
        </p>
      </section>
    );
  }
  return (
    <section className="bench-sec">
      <p className="bench-sec-head label-data">RELIGHT SERVING</p>
      {!models ? (
        <EmptyState title="READING THE MODELS…" />
      ) : (
        <>
          <Select
            fill
            ariaLabel="Relight model"
            value={model}
            onChange={onModel}
            placeholder="— the model to swap onto the endpoint —"
            options={models.map((m) => ({ value: m.key, label: modelLabel(m), disabled: !m.hasSha256 }))}
          />
          {!confirm ? (
            <div className="bench-controls">
              <button type="button" className="bench-btn is-danger label-data" disabled={busy || !model} onClick={onAsk}>
                RELIGHT
              </button>
            </div>
          ) : (
            <div className="bench-confirm">
              <span className="bench-confirm-notice">
                «WARNING» relight swaps the model on the serving endpoint — anything mid-flight on it
                dies. The serving watchdog and the swap daemon stand back up (systemd when its units are
                installed), and serving relights under the watchdog.
              </span>
              <button type="button" className="bench-btn is-danger label-data" disabled={busy} onClick={onRelight}>
                {busy ? 'STANDING THE DAEMONS…' : 'RELIGHT NOW'}
              </button>
              <button type="button" className="bench-btn label-data" disabled={busy} onClick={onCancel}>
                CANCEL
              </button>
            </div>
          )}
          {refusal ? <p className="bench-line label-data is-alert">{refusal}</p> : null}
          {outcome ? (
            <>
              {relightResultLines(outcome).map((line) => (
                <p key={line} className="bench-row label-data is-live">{line}</p>
              ))}
            </>
          ) : null}
        </>
      )}
    </section>
  );
};
