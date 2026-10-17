import { TokenFigure } from './context-token-figure.jsx';

/** Pure — the input reading carried into the standing-context budget. */
export const StandingRow = ({ usage }) => Number.isFinite(usage?.inputTokens) ? (
  <div className="ctx-row ctx-standing" tabIndex={0} aria-label={`standing input — ${usage.inputTokens} tokens (${usage.source})`}>
    <span className="ctx-row-label label-data">STANDING INPUT</span>
    <span className="ctx-budget-val label-data"><TokenFigure tokens={usage.inputTokens} tokenSource={usage.source} /></span>
  </div>
) : null;

/** Pure — show the larger tool-round measurement separately from standing input. */
export const PeakRow = ({ usage }) => Number.isFinite(usage?.workingPeakTokens) ? (
  <div className="ctx-row ctx-peak" tabIndex={0} aria-label={`working peak — ${usage.workingPeakTokens} tokens measured, tool machinery not carried forward`}>
    <span className="ctx-row-label label-data">WORKING PEAK</span>
    <span className="ctx-budget-val label-data">
      <TokenFigure tokens={usage.workingPeakTokens} tokenSource="measured" />
      {' · TOOL MACHINERY — NOT CARRIED FORWARD'}
    </span>
  </div>
) : null;
