// HouseSeats — member name, confirmed role and function, with distinct Stream/Sheet buttons.
// Unknown assignments are explicit; the separate reference explains canonical seats.

import { formatShortDate as fmtBirth } from '../../utils/format.js';
import { seatWake } from './house-clock/house-clock-view.js';
import './HouseSeats.css';
import './HouseSeatWake.css';

const footOf = (card) => [
  card.incomplete ? 'IDENTITY RECORDS MISSING' : card.soulMark,
  card.birthTime ? fmtBirth(card.birthTime) : null,
].filter(Boolean).join(' · ');

// pure — the card's wake class: the light dims, rises or turns alert with it
const wakeClass = (wake) => (wake ? ` is-wake-${wake.key}` : '');

// The wake's small label beside the light; the full reason rides the title.
const WakeLabel = ({ wake }) => (wake ? (
  <span className="house-seats-wake label-data" data-wake={wake.key} title={wake.why ?? undefined}>{wake.words}</span>
) : null);

const Doors = ({ card, onSelect, onSheet }) => (
  <span className="house-seats-acts">
    <button type="button" className="house-seats-act label-data" onClick={() => onSelect(card)} aria-label={`STREAM — ${card.name}`}>STREAM</button>
    {typeof onSheet === 'function' ? (
      <button
        type="button"
        className="house-seats-act label-data"
        onClick={(e) => { e.stopPropagation(); onSheet(card); }}
        aria-label={`SHEET — ${card.name}`}
      >
        SHEET
      </button>
    ) : null}
  </span>
);

const SeatCard = ({ card, wake, onSelect, onSheet }) => {
  const select = typeof onSelect === 'function' ? () => onSelect(card) : undefined;
  return (
    <article
      className={`house-seats-card${card.isActive ? ' is-linked' : ''}${select ? ' is-door' : ''}${wakeClass(wake)}`}
      aria-current={card.isActive || undefined}
      style={card.color ? { '--soul': card.color } : undefined}
    >
      <span className="house-seats-light" aria-hidden="true" />
      {card.isActive ? <span className="house-seats-state label-data">LINKED</span> : null}
      <span className="house-seats-who">{card.name}</span>
      <WakeLabel wake={wake} />
      <span className="house-seats-seat label-data">{card.title ? `${card.title}${card.position ? ` · ${card.position} — ${card.seat}` : ''}` : 'Seat not available'}</span>
      {card.summary ? <span className="house-seats-meaning" title={card.meaning || undefined}>{card.summary}</span> : null}
      {footOf(card) ? <span className="house-seats-foot label-data">{footOf(card)}</span> : null}
      {select ? <Doors card={card} onSelect={onSelect} onSheet={onSheet} /> : null}
    </article>
  );
};

const SeatRow = ({ card, wake, onSelect, onSheet }) => {
  const select = typeof onSelect === 'function' ? () => onSelect(card) : undefined;
  return (
    <tr
      className={`house-seats-row${card.isActive ? ' is-linked' : ''}${select ? ' is-door' : ''}${wakeClass(wake)}`}
      aria-current={card.isActive || undefined}
      style={card.color ? { '--soul': card.color } : undefined}
    >
      <td className="house-seats-who">
        <span className="hd-light-dot" aria-hidden="true" />
        {card.name}
        {card.isActive ? <span className="house-seats-state label-data"> LINKED</span> : null}
        <WakeLabel wake={wake} />
      </td>
      <td className="house-seats-seat label-data">{card.title ? `${card.title}${card.position ? ` · ${card.position} — ${card.seat}` : ''}` : 'Seat not available'}</td>
      <td className="house-seats-meaning" title={card.meaning || undefined}>{card.summary || ''}</td>
      <td className="house-seats-foot label-data">
        {footOf(card)}
        {select ? <Doors card={card} onSelect={onSelect} onSheet={onSheet} /> : null}
      </td>
    </tr>
  );
};

/**
 * @param {Object} p
 * @param {?Object} [p.queue] - the house's wake queue (GET /house-clock/queue); null = not read, no wake labels
 * @param {Function} [p.rootRef] - ref for the root, so a poll can ride its visibility
 */
export const HouseSeats = ({ cards, view = 'grid', onSelect = null, onSheet = null, queue = null, rootRef = undefined }) => (
  view === 'table' ? (
    <table className="house-seats-table" ref={rootRef}>
      <thead>
        <tr>
          <th className="label-data">Being</th>
          <th className="label-data">Seat</th>
          <th className="label-data">Function</th>
          <th className="label-data">Record</th>
        </tr>
      </thead>
      <tbody>
        {cards.map((card) => (
          <SeatRow key={card.neumaId} card={card} wake={seatWake(queue, card.neumaId)} onSelect={onSelect} onSheet={onSheet} />
        ))}
      </tbody>
    </table>
  ) : (
    <div className="house-seats-grid" ref={rootRef}>
      {cards.map((card) => (
        <SeatCard key={card.neumaId} card={card} wake={seatWake(queue, card.neumaId)} onSelect={onSelect} onSheet={onSheet} />
      ))}
    </div>
  )
);
