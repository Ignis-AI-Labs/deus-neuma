// HouseSeats — member name, confirmed role and function, with distinct Stream/Sheet buttons.
// Unknown assignments are explicit; the separate reference explains canonical seats.

import { formatShortDate as fmtBirth } from '../../utils/format.js';
import './HouseSeats.css';

const footOf = (card) => [
  card.incomplete ? 'IDENTITY RECORDS MISSING' : card.soulMark,
  card.birthTime ? fmtBirth(card.birthTime) : null,
].filter(Boolean).join(' · ');

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

const SeatCard = ({ card, onSelect, onSheet }) => {
  const select = typeof onSelect === 'function' ? () => onSelect(card) : undefined;
  return (
    <article
      className={`house-seats-card${card.isActive ? ' is-linked' : ''}${select ? ' is-door' : ''}`}
      aria-current={card.isActive || undefined}
    >
      {card.isActive ? <span className="house-seats-state label-data">LINKED</span> : null}
      <span className="house-seats-who">{card.name}</span>
      <span className="house-seats-seat label-data">{card.title ? `${card.title}${card.position ? ` · ${card.position}` : ''}` : 'Seat not available'}</span>
      {card.meaning ? <span className="house-seats-meaning label-data">{card.meaning}</span> : null}
      {footOf(card) ? <span className="house-seats-foot label-data">{footOf(card)}</span> : null}
      {select ? <Doors card={card} onSelect={onSelect} onSheet={onSheet} /> : null}
    </article>
  );
};

const SeatRow = ({ card, onSelect, onSheet }) => {
  const select = typeof onSelect === 'function' ? () => onSelect(card) : undefined;
  return (
    <tr
      className={`house-seats-row${card.isActive ? ' is-linked' : ''}${select ? ' is-door' : ''}`}
      aria-current={card.isActive || undefined}
    >
      <td className="house-seats-who">
        {card.name}
        {card.isActive ? <span className="house-seats-state label-data"> LINKED</span> : null}
      </td>
      <td className="house-seats-seat label-data">{card.title ? `${card.title}${card.position ? ` · ${card.position}` : ''}` : 'Seat not available'}</td>
      <td className="house-seats-meaning label-data">{card.meaning || ''}</td>
      <td className="house-seats-foot label-data">
        {footOf(card)}
        {select ? <Doors card={card} onSelect={onSelect} onSheet={onSheet} /> : null}
      </td>
    </tr>
  );
};

export const HouseSeats = ({ cards, view = 'grid', onSelect = null, onSheet = null }) => (
  view === 'table' ? (
    <table className="house-seats-table">
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
          <SeatRow key={card.neumaId} card={card} onSelect={onSelect} onSheet={onSheet} />
        ))}
      </tbody>
    </table>
  ) : (
    <div className="house-seats-grid">
      {cards.map((card) => (
        <SeatCard key={card.neumaId} card={card} onSelect={onSelect} onSheet={onSheet} />
      ))}
    </div>
  )
);
