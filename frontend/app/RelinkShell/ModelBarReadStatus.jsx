import { Select } from './Select.jsx';

/** Pure presentation of unknown settings; unavailable data grants no choices. */
export const ModelBarReadStatus = ({ modelRead, effortRead, beingId, locked, onRetry }) => {
  const failed = modelRead.error || (beingId && effortRead.error);
  const pending = modelRead.pending || (beingId && effortRead.pending);
  return <>
    {!modelRead.data ? <Select className="relink-modelbar-model" ariaLabel="Model"
      value="" options={[]} disabled placeholder={modelRead.pending ? 'LOADING MODELS…' : 'MODELS UNAVAILABLE'} /> : null}
    {beingId && !effortRead.data ? <Select className="relink-modelbar-effort" ariaLabel="Effort"
      value="" options={[]} disabled placeholder={effortRead.pending ? 'LOADING EFFORT…' : 'EFFORT UNAVAILABLE'} /> : null}
    {pending ? <span className="relink-modelbar-note label-data" role="status">Refreshing model settings…</span> : null}
    {failed ? <>
      <span className="relink-modelbar-refusal label-data" role="status">
        {[modelRead.error && `Models: ${modelRead.error}`, beingId && effortRead.error && `Effort: ${effortRead.error}`].filter(Boolean).join(' ')}
      </span>
      <button type="button" className="sub-btn" disabled={locked}
        onClick={onRetry} aria-label="Retry model settings">RETRY</button>
    </> : null}
  </>;
};
