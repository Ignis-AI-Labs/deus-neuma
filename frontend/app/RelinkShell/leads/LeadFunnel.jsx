// LeadFunnel — the house's leads as one funnel before they are a list
// (show-dont-tell-audit.md finding 5; JŌHŌ SEKKEI): one bar split by stage,
// cold to won (lost stands last), each part as wide as its count; under it
// each stage's mark and count. Every part and every count is a door that
// narrows the list below to that stage (the BOARD's press-to-narrow), with
// SHOWING … · SHOW ALL the way back. What the ledger is rides the hover.
//
// pure rendering — the narrowing is the caller's.

import { LeadStageMark } from './LeadStageMark.jsx';

const LEDGER_LINE = 'the house lead ledger: every prospect being worked, from first sighting to won or lost. Your neuma capture and move leads through their lead tools; every change lands on the lead\'s permanent touch history under whoever made it.';

/**
 * @param {{funnel: Array<{stage: string, count: number}>, stage: ?string, onStage: (stage: ?string) => void}} props
 *   stage — the one the list is narrowed to (null: every lead)
 */
export const LeadFunnel = ({ funnel, stage, onStage }) => {
  const press = (s) => onStage(stage === s ? null : s);
  const shown = funnel.filter((p) => p.count > 0);
  return (
    <div className="lfn" title={LEDGER_LINE}>
      <div className="lfn-track" role="group" aria-label="the funnel, by stage">
        {shown.map((p) => (
          <button key={p.stage} type="button" className={`lfn-part is-${p.stage}${stage === p.stage ? ' is-lit' : ''}`}
            style={{ flexGrow: p.count }} aria-pressed={stage === p.stage} aria-label={`${p.count} ${p.stage}`} title={`${p.count} ${p.stage.toUpperCase()} — show only these`}
            onClick={() => press(p.stage)} />
        ))}
      </div>
      <div className="lfn-legend" role="group" aria-label="leads by stage">
        {funnel.map((p) => (
          <button key={p.stage} type="button" className={`lfn-n${stage === p.stage ? ' is-lit' : ''}${p.count ? '' : ' is-zero'}`}
            disabled={!p.count} aria-pressed={stage === p.stage} title={`${p.count} ${p.stage.toUpperCase()} — show only these`} onClick={() => press(p.stage)}>
            <LeadStageMark stage={p.stage} /><b>{p.count}</b>
          </button>
        ))}
        {stage ? (
          <button type="button" className="lfn-showing" data-showing onClick={() => onStage(null)}>
            SHOWING {stage.toUpperCase()} · SHOW ALL
          </button>
        ) : null}
      </div>
    </div>
  );
};
