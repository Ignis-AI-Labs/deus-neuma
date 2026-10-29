// mandate-glyphs — the MANDATE's own marks (show-dont-tell-audit.md findings
// 4, 6): one small drawn shape per tripwire that pauses it, for the hostile-
// text hold, and for each law no mandate covers. The shape says it at a
// glance, the hover says it in words (CHOKKAN 1); drawn in currentColor so
// the surrounding tone carries the state. Custom SVG, never an emoji.

const PATHS = Object.freeze({
  // tripwires: what pauses the mandate
  pace: 'M2 4 L7 9 L2 14 M7 4 L12 9 L7 14 M15 3 V15',
  legal: 'M9 3 V15 M5 15 H13 M3 6 H15 M3 6 L1.5 10.5 H4.5 Z M15 6 L13.5 10.5 H16.5 Z',
  spam: 'M9 3 A6 6 0 1 0 9.01 3 Z M4.8 13.2 L13.2 4.8',
  rogue: 'M1.5 9 Q9 2 16.5 9 Q9 16 1.5 9 Z M9 7 A2 2 0 1 0 9.01 7 Z',
  widen: 'M2 6.5 V2 H6.5 M11.5 2 H16 V6.5 M16 11.5 V16 H11.5 M6.5 16 H2 V11.5 M5 5 L13 13 M13 5 L5 13',
  'cross-company': 'M1.5 5 H7.5 V13 H1.5 Z M10.5 5 H16.5 V13 H10.5 Z M6 9 H12',
  'cross-house': 'M2 9 L9 2.5 L16 9 M4 7.5 V15.5 H14 V7.5 M11 12 H17 M15 10 L17 12 L15 14',
  // the hostile-text hold: text from outside, held
  hold: 'M2 3 H16 V12 H8 L4.5 15.5 V12 H2 Z M7 6 V9.5 M11 6 V9.5',
  // what no mandate covers
  money: 'M9 2.5 A6.5 6.5 0 1 0 9.01 2.5 Z M9 5.5 V12.5 M11.2 7 Q9 5.6 7.2 7 Q7 9 9 9 Q11 9 10.8 11 Q9 12.4 6.8 11',
  content: 'M2.5 3.5 H15.5 V14.5 H2.5 Z M2.5 11.5 L6.5 7.5 L10 11 L12 9 L15.5 12.5',
  ai: 'M9 2 L16 9 L9 16 L2 9 Z M9 5.5 L12.5 9 L9 12.5 L5.5 9 Z',
  secrets: 'M6 6 A3 3 0 1 0 6.01 6 Z M9 9 H16.5 M14 9 V12 M16.5 9 V11',
  house: 'M2 9 L9 2.5 L16 9 M4 7.5 V15.5 H14 V7.5',
  asks: 'M9 2.5 L15.5 9 L9 15.5 L2.5 9 Z',
});

/** One mandate mark, by name; nothing for a name it does not know. */
export const Glyph = ({ name }) => (PATHS[name] ? (
  <svg className="mandate-glyph" width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
) : null);
