// CompositionView — the CONTEXT MAP's COMPOSITION view, extracted whole from
// ContextMapApp (size law). The context window's anatomy per turn, drawn from
// real telemetry only: the portal's context:composition event (counts, never
// the assembled text). Every token figure carries its honest source per the
// honest-stats ladder — a measured total is a plain number; attributed and
// approx counts read ~N with an EST tag; a bare figure never pretends to be
// a measurement.

import { EmptyState } from './empty-state.jsx';
import { formatClockStamp, formatCount } from '../../utils/format.js';
import { approxTokensFromChars } from '../../../core/continuity/layers/record-util.js';
import { TokenFigure } from './context-token-figure.jsx';
import { StandingRow, PeakRow } from './CompositionUsage.jsx';
export { TokenFigure } from './context-token-figure.jsx';

// Collapsed compressed region — a tool result that crossed the compression
// cap, held in the record under its ref. The numbers are the real byte
// truth of what was kept on the wire versus what the tool produced.
// The kept/original figures arrive as char counts, but the operator budgets
// in TOKENS (Design note, 2026-08-28: […]) — so they read as ~N TOK, the same honest-estimate register
// TokenFigure uses for its approx source.
const RefNode = ({ r }) => (
  <div
    className="ctx-ref cham"
    tabIndex={0}
    aria-label={`${r.ref} — ${r.tool}, kept about ${approxTokensFromChars(r.sentChars)} of ${approxTokensFromChars(r.originalChars)} tokens, ${r.kind}`}
  >
    <div className="ctx-ref-in cham-in">
      <span className="ctx-ref-id">{r.ref}</span>
      <span className="ctx-ref-kind label-data">{(r.kind || '').toUpperCase()}</span>
      <span className="ctx-ref-kept label-data">
        {(r.tool || '').toUpperCase()} · KEPT ~{formatCount(approxTokensFromChars(r.sentChars))} OF ~{formatCount(approxTokensFromChars(r.originalChars))} TOK
      </span>
    </div>
  </div>
);

const BudgetRow = ({ budget, totals }) => (
  <div className="ctx-row ctx-budget">
    <span className="ctx-row-label label-data">BUDGET</span>
    {Number.isFinite(budget?.contextTokens) ? (
      <span className="ctx-budget-val label-data">
        <TokenFigure tokens={totals.tokens} tokenSource={totals.tokenSource} />
        {' / '}{formatCount(budget.contextTokens)} · {(budget.source || 'unknown').toUpperCase()}
      </span>
    ) : (
      <span className="ctx-budget-val label-data">— / UNKNOWN</span>
    )}
  </div>
);

// Pure view of one composition event. Exported for the component-level
// vitest (real event objects from the real builder — no browser needed).
export const CompositionView = ({ composition }) => {
  if (!composition) {
    return (
      <EmptyState title="NO TURN OBSERVED YET THIS SESSION">
        <small>
          The map draws from real telemetry only. Send a thought — the
          window&apos;s anatomy appears with the first turn.
        </small>
      </EmptyState>
    );
  }

  const { sections, totals, budget, toolResults, usage, degraded, shed } = composition;
  const used = Number.isFinite(usage?.usedTokens)
    ? { tokens: usage.usedTokens, tokenSource: usage.source }
    : totals;

  // A replayed event is the session's recorded truth, not a live turn — the
  // heading says so, with the recorded moment when the record carries one.
  const recordedStamp = composition.replayed
    ? ` · AS RECORDED${composition.at ? ` ${formatClockStamp(composition.at).toUpperCase()}` : ''}`
    : '';

  return (
    <div className="ctx-comp">
      <p className="ctx-h label-data">WINDOW ANATOMY · LAST TURN{recordedStamp}</p>

      <div className="ctx-bar" aria-hidden="true">
        {sections.map((s) => (
          <div
            key={s.id}
            className="ctx-seg"
            style={{ flexGrow: Math.max(s.tokens > 0 ? s.tokens : s.chars, 1) }}
            title={s.label}
          />
        ))}
      </div>

      <div className="ctx-rows" role="list" aria-label="context sections">
        {sections.map((s) => (
          <div
            key={s.id}
            className="ctx-row"
            role="listitem"
            tabIndex={0}
            aria-label={`${s.label} — ${s.chars} chars, ${s.tokenSource === 'measured' ? '' : 'about '}${s.tokens} tokens (${s.tokenSource})`}
          >
            <span className="ctx-row-label label-data">{(s.label || s.id).toUpperCase()}</span>
            <span className="ctx-row-chars label-data">{formatCount(s.chars)} CH</span>
            <TokenFigure tokens={s.tokens} tokenSource={s.tokenSource} />
          </div>
        ))}
        <div className="ctx-row ctx-total" tabIndex={0} aria-label={`total — ${totals.chars} chars, ${totals.tokens} tokens (${totals.tokenSource})`}>
          <span className="ctx-row-label label-data">SECTION TOTAL</span>
          <span className="ctx-row-chars label-data">{formatCount(totals.chars)} CH</span>
          <TokenFigure tokens={totals.tokens} tokenSource={totals.tokenSource} />
        </div>
        <StandingRow usage={usage} />
        <BudgetRow budget={budget} totals={used} />
        <PeakRow usage={usage} />
        {Array.isArray(degraded) && degraded.length > 0 ? (
          <div className="ctx-row ctx-degraded" tabIndex={0} aria-label={`context degraded — ${degraded.join(', ')} unavailable this turn`}>
            <span className="ctx-row-label label-data">DEGRADED</span>
            <span className="ctx-budget-val label-data">{degraded.join(', ').toUpperCase()} · FAILED SOFT THIS TURN</span>
          </div>
        ) : null}
        {/* What the shed ladder cut this turn — the window could not hold it, and the operator is told. */}
        {Array.isArray(shed) && shed.length > 0 ? (
          <div className="ctx-row ctx-degraded" tabIndex={0} aria-label={`shed this turn — ${shed.map((s) => s.id).join(', ')} did not fit the window`}>
            <span className="ctx-row-label label-data">SHED</span>
            <span className="ctx-budget-val label-data">{shed.map((s) => `${s.id} ~${formatCount(s.tokens)}`).join(', ').toUpperCase()} · THE WINDOW COULD NOT HOLD THEM</span>
          </div>
        ) : null}
      </div>

      <p className="ctx-h label-data">COMPRESSED REGIONS</p>
      {(toolResults || []).length === 0 ? (
        <p className="ctx-note">
          None this session — no tool result has crossed the compression cap.
        </p>
      ) : (
        <div className="ctx-refs" role="list" aria-label="compressed tool results">
          {toolResults.map((r) => <RefNode key={r.ref} r={r} />)}
        </div>
      )}
    </div>
  );
};
