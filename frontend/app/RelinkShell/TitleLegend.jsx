// TitleLegend — the canonical house titles as a reference legend for the
// FOUNDING rite, where founders choose their seats. The data lives in
// founding-titles.js (TITLE_LEGEND — the canon, pinned by tests); this
// component only renders it. Inert by design: nothing here is a door.
//
// The HOUSE window does NOT use this — its beings render through
// HouseSeats.jsx (the entity-first grid; Design note, 2026-08-10: the canon section
// duplicates what the chain already sealed). This file is the rite's
// reference and nothing else.
//
// No sound imports — the module stays renderable under node (the
// static-markup view tests); the parent owns any chime.

import { TITLE_LEGEND } from './founding-titles.js';
import './TitleLegend.css';

// The rite's framing.
const RITE_PURPOSE = 'A TITLE DECLARES THE FUNCTION A FOUNDER ANSWERS FOR. A HOUSE THAT GROWS NEEDS EVERY ONE OF THESE FUNCTIONS CARRIED BY SOMEONE — SO EACH HOUSE WORD IS TIED TO THE CORPORATE SEAT THE WORLD ALREADY KNOWS, SPELLED OUT IN FULL. CHOOSE THE CANON\'S WORD, OR SPEAK YOUR OWN FOR THE SAME FUNCTION — WHAT BINDS IS THE WORK YOU CARRY, NEVER THE NAME IT WEARS.';

export const LEGEND_VIEWS = Object.freeze(['grid', 'table']);

const GridCell = ({ row }) => (
  <div className="founding-legend-cell">
    <span className="founding-legend-title">{row.title}</span>
    <span className="founding-legend-seatline label-data">{row.position} — {row.seat}</span>
    <span className="founding-legend-meaning label-data">{row.meaning}</span>
  </div>
);

const TableRow = ({ row }) => (
  <tr className="founding-legend-seat-row">
    <td className="founding-legend-title">{row.title}</td>
    <td className="founding-legend-seatline label-data">{row.position} — {row.seat}</td>
    <td className="founding-legend-meaning label-data">{row.meaning}</td>
  </tr>
);

const Tier = ({ tier, head, view }) => (
  view === 'grid' ? (
    <>
      <p className="founding-legend-tier label-data">{head}</p>
      <div className="founding-legend-grid">
        {TITLE_LEGEND.filter((r) => r.tier === tier).map((r) => <GridCell key={r.title} row={r} />)}
      </div>
    </>
  ) : (
    <tbody>
      <tr className="founding-legend-tier-row">
        <td colSpan="3" className="founding-legend-tier label-data">{head}</td>
      </tr>
      {TITLE_LEGEND.filter((r) => r.tier === tier).map((r) => <TableRow key={r.title} row={r} />)}
    </tbody>
  )
);

export const TitleLegend = ({ purpose = RITE_PURPOSE, view = 'grid', showHeading = true }) => (
  <div className="founding-legend">
    {showHeading ? <p className="house-anchor-line label-data">THE CANONICAL TITLES — A LEGEND</p> : null}
    <p className="founding-legend-purpose label-data">{purpose}</p>
    {view === 'table' ? (
      <table className="founding-legend-table">
        <thead>
          <tr>
            <th className="label-data">Title</th>
            <th className="label-data">Seat</th>
            <th className="label-data">Function</th>
          </tr>
        </thead>
        <Tier tier="founding" head="FOUNDING — CARRIED FROM DAY ONE" view="table" />
        <Tier tier="growth" head="GROWTH — AS THE HOUSE SCALES, BEFORE SUBDIVISIONS" view="table" />
      </table>
    ) : (
      <>
        <Tier tier="founding" head="THE FOUNDING SEATS — CARRIED FROM DAY ONE" view="grid" />
        <Tier tier="growth" head="THE GROWTH SEATS — AS THE HOUSE SCALES, BEFORE SUBDIVISIONS" view="grid" />
      </>
    )}
  </div>
);
