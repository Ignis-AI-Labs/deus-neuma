import { formatCount } from '../../utils/format.js';

/** Pure — each token figure identifies its measurement or estimate source. */
export const TokenFigure = ({ tokens, tokenSource }) => {
  if (tokenSource === 'measured') {
    return <span className="ctx-tok ctx-tok-measured" title="measured — the provider's own usage count">{formatCount(tokens)}</span>;
  }
  if (tokenSource === 'carried') {
    return <span className="ctx-tok" title="carried — last measured turn">{formatCount(tokens)} <span className="ctx-est">CARRIED</span></span>;
  }
  return (
    <span className="ctx-tok" title={tokenSource === 'attributed'
      ? 'attributed — proportional split of the measured turn total'
      : 'approx — chars/4 estimate, no usage arrived'}>
      ~{formatCount(tokens)} <span className="ctx-est">EST</span>
    </span>
  );
};
