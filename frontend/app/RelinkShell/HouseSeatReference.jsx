import { TitleLegend } from './TitleLegend.jsx';

/** Seat reference and lookup state, separate from each member's actual assignment. */
export const HouseSeatReference = ({ phase, hasSeats, onRetry }) => (
  <div className="house-seat-reference">
    {phase !== 'founded' ? <div className="house-seat-status" role="status">
      <span>{phase === 'probing' ? (hasSeats ? 'Showing recorded seats while checking the registry…' : 'Loading seat assignments…') : hasSeats
        ? 'Showing the last loaded seats from saved records. Live registry verification is unavailable.'
        : 'Seat assignments are unavailable. The registry has not returned a confirmed roster.'}</span>
      {phase !== 'probing' ? <button type="button" onClick={onRetry}>Retry lookup</button> : null}
    </div> : null}
    <details>
      <summary>Seat legend <span>Titles, positions and responsibilities</span></summary>
      <TitleLegend showHeading={false} purpose="A reference to the house’s roles. Member cards show recorded assignments; a successful registry lookup verifies their current standing." />
    </details>
  </div>
);
