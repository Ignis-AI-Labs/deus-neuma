// One seat on the strip: hand mark (red standby / yellow hold / green
// open), the name in the seat's own voice color, the seat's NUMBER in the
// speaking line while its hand is raised (1 = next — an OPEN raised late
// outranks an early HOLD, and the number is what makes that jump read as
// order instead of confusion), and THE FLOOR while speaking.
// `external` marks a sealed witness: it sits BESIDE the house, never in it
// (WR-I01). The seat says so in the room itself — an operator that looked like a
// housemate on the strip would make the misnaming everyone's first impression.
export const CouncilSeat = ({ name, color, hand, order, holdsFloor, considering, external = false }) => (
  <li
    className={`council-member${holdsFloor ? ' is-floor' : ''}${external ? ' is-external' : ''}`}
    title={external ? `${name} — a sealed witness, standing beside this house` : undefined}
  >
    <span
      className="council-member-mark"
      data-hand={hand}
      data-considering={considering ? 'true' : undefined}
      aria-hidden="true"
    />
    <span className="council-member-name" style={{ color }}>{name}</span>
    {external ? <span className="council-member-kin label-data">EXT</span> : null}
    {!holdsFloor && order ? (
      <span className="council-member-order label-data" data-hand={hand} title={order === 1 ? 'Next to speak' : `${order} in line`}>
        {order}
      </span>
    ) : null}
    {!holdsFloor ? <span className="council-member-state label-data">
      {considering ? 'CONSIDERING' : hand === 'open' ? 'OPEN' : hand === 'hold' ? 'HOLD' : 'STANDBY'}
    </span> : null}
    {holdsFloor ? <span className="council-member-floor label-data">THE FLOOR</span> : null}
  </li>
);

/** Visible turn state; the colored pulse is decorative. */
export const CouncilSpeaking = ({ pending = false }) => (
  <span className="council-speaking-state label-data">
    <span className="council-turn-speaking" aria-hidden="true" />
    {pending ? 'ABOUT TO SPEAK' : 'SPEAKING'}
  </span>
);
