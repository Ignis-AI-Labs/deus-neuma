// BenchLaunch — the LAUNCH tab, pure rendering, orchestrated: the two
// columns of BenchLaunchRun.jsx (pick on the left, THIS RUN on the right),
// with the folds that sit under the picker — ADVANCED (window/night, the
// operator's overnight instrument) and the harness checks — and the server's
// last answer riding in THIS RUN. Every act is the operator's own and every
// answer renders the server's own text — a refusal reads verbatim in the
// alert register; a launch renders the argv the server fired. The catalog
// (cells/models/plans), the serving reading, and the acts live in
// BenchApp.jsx.

import { useState } from 'react';
import './BenchApp.css';
import { EmptyState } from './empty-state.jsx';
import { Select } from './Select.jsx';
import { planLabel } from './bench-view.js';
import { BenchLaunchRun } from './BenchLaunchRun.jsx';

// ADVANCED — WINDOW / NIGHT, collapsed by default: run a whole planned queue
// against a deadline. NIGHT START opens a real GPU window, so it stands
// behind a «NOTICE» confirmation, never a bare click.
const WindowCard = ({ plans, form, onForm, busy, onPlanVerb, confirmNight, onAskNight, onCancelNight, startOpen = false }) => {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="bl-fold">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾ ADVANCED — WINDOW / NIGHT' : '▸ ADVANCED — WINDOW / NIGHT'}
      </button>
      {open ? (
        <div className="bl-fold-body">
          <p className="bench-line label-data">
            Run a whole planned queue against a deadline — the operator&apos;s overnight instrument.
          </p>
          {!plans ? (
            <EmptyState title="READING THE PLANS…" />
          ) : (
            <>
              <label className="bench-field">
                <span className="bench-field-label label-data">PLAN</span>
                <Select
                  fill
                  ariaLabel="Bench plan"
                  value={form.plan}
                  onChange={(v) => onForm({ plan: v })}
                  placeholder="— choose the window plan —"
                  options={plans.map((p) => ({ value: p.name, label: planLabel(p) }))}
                />
              </label>
              <div className="bench-controls">
                <button type="button" className="bl-btn label-data" disabled={busy || !form.plan} onClick={() => onPlanVerb('validate-window')}>
                  VALIDATE WINDOW
                </button>
                <button type="button" className="bl-btn label-data" disabled={busy || !form.plan} onClick={() => onPlanVerb('night-check')}>
                  NIGHT CHECK
                </button>
                {!confirmNight ? (
                  <button type="button" className="bl-btn is-danger label-data" disabled={busy || !form.plan} onClick={onAskNight}>
                    NIGHT START
                  </button>
                ) : null}
              </div>
              {confirmNight ? (
                <div className="bench-confirm">
                  <span className="bench-confirm-notice">
                    «NOTICE» NIGHT START opens a real benchmark window on the GPU — the rig locks to it until the
                    deadline or a stop. The window runs the plan {form.plan ? `“${form.plan}” ` : ''}under the
                    harness's own attended law.
                  </span>
                  <button type="button" className="bl-btn is-danger label-data" disabled={busy} onClick={() => onPlanVerb('night-start')}>
                    START THE WINDOW
                  </button>
                  <button type="button" className="bl-btn label-data" disabled={busy} onClick={onCancelNight}>
                    CANCEL
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
};

// READ VERBS — doctor/list read, behind a fold like the night window. The
// plane's STOP lives on THIS RUN, beside the run it stops.
const OpsCard = ({ busy, onReadVerb, startOpen = false }) => {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="bl-fold">
      <button type="button" className="bl-fold-toggle label-data" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾ HARNESS CHECKS — DOCTOR / LIST' : '▸ HARNESS CHECKS — DOCTOR / LIST'}
      </button>
      {open ? (
        <div className="bench-controls bl-fold-body">
          <button type="button" className="bl-btn label-data" disabled={busy} onClick={() => onReadVerb('doctor')}>
            DOCTOR
          </button>
          <button type="button" className="bl-btn label-data" disabled={busy} onClick={() => onReadVerb('list')}>
            LIST
          </button>
        </div>
      ) : null}
    </section>
  );
};

// THE ANSWER PANEL — the last act's own words: a refusal verbatim, or the
// fired argv + exit + log + captured stdout.
const ResultPanel = ({ refusal, result }) => {
  if (refusal) {
    return (
      <section className="bl-fold">
        <p className="bl-kicker label-data">THE SERVER REFUSED</p>
        <p className="bench-line label-data is-alert">{refusal}</p>
      </section>
    );
  }
  if (!result) return null;
  return (
    <section className="bl-fold">
      <p className="bl-kicker label-data">{result.title}</p>
      <p className="bench-argv">{result.argvLine}</p>
      {result.lines.map((line) => (
        <p key={line} className="bench-line label-data">{line}</p>
      ))}
      {result.stdout ? <pre className="bench-pre">{result.stdout}</pre> : null}
    </section>
  );
};

export const BenchLaunch = ({
  cells, models, lanes, plans, serving, machine = null, form, onForm, busy, refusal, result,
  preflightResults, runFired, chain, runRows = [], advancedStartOpen = false, fineStartOpen = false,
  onPreflight, onRun, onPlanVerb, onReadVerb, confirmNight, onAskNight, onCancelNight,
  owned, nowMs, live = [], onWatch,
}) => (
  <BenchLaunchRun
    cells={cells} models={models} lanes={lanes} serving={serving} machine={machine} form={form} onForm={onForm}
    busy={busy} preflightResults={preflightResults}
    launchResult={runFired}
    ownedRun={(owned ?? []).find((child) => child.long) ?? null}
    chainState={chain}
    live={live}
    runRows={runRows}
    onPreflight={onPreflight} onRun={onRun} nowMs={nowMs} onWatch={onWatch}
    fineStartOpen={fineStartOpen}
    answer={<ResultPanel refusal={refusal} result={result} />}
    extras={(
      <>
        <WindowCard
          plans={plans} form={form} onForm={onForm} busy={busy}
          onPlanVerb={onPlanVerb} confirmNight={confirmNight}
          onAskNight={onAskNight} onCancelNight={onCancelNight}
          startOpen={advancedStartOpen}
        />
        <OpsCard busy={busy} onReadVerb={onReadVerb} />
      </>
    )}
  />
);
