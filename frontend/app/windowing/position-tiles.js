// position-tiles.js — the launcher's COMPANY section (Design note, 2026-11-15: […]).
// Each position of the house is a tile; pressing one opens the POSITIONS window
// on that position, where everything the seat handles stands together. The
// seat windows the hubs took in (CHIEF OF STAFF, LEGAL, SECURITY, TREASURY,
// and POSITIONS itself) no longer take a tile of their own; search still finds
// each by name. MARKETING keeps its tile under REACH beside its platforms: it
// is the house's most-used window and its hub tab is still a door to it.
//
// The tile order and names twin backend/services/positions/position-map.js; a
// unit test pins the two together. Pure, but for the one event.

/** [office, the plain name on the tile, the words search also answers to]. */
export const POSITION_TILES = Object.freeze([
  ['cos', 'MANAGEMENT', ['optio', 'chief of staff', 'board']],
  ['cro', 'SALES', ['mercator', 'leads', 'deals', 'mailbox', 'email', 'outreach']],
  ['cmo', 'MARKETING', ['cmo', 'campaigns', 'brand', 'posts']],
  ['clo', 'LAW', ['clo', 'legal']],
  ['cso', 'SECURITY', ['cso', 'guard']],
  ['cfo', 'TREASURY', ['quaestor', 'cfo', 'spend', 'invoices']],
  ['cao', 'BOOKS', ['logista', 'accounts', 'ledger']],
].map((t) => Object.freeze(t)));

const PREFIX = 'position-';
export const positionTileId = (office) => `${PREFIX}${office}`;
/** The office a tile id opens, or null when the id is not a position tile. */
export const officeOfTile = (id) => (typeof id === 'string' && id.startsWith(PREFIX) && POSITION_TILES.some(([o]) => o === id.slice(PREFIX.length)) ? id.slice(PREFIX.length) : null);

/** The windows whose work now stands inside a position's hub: no tile, still searchable. */
export const FOLDED_INTO_POSITIONS = Object.freeze(['positions', 'staff', 'legal', 'security', 'treasury']);

const EVENT = 'neuma:position-place';
export const POSITION_PLACE_KEY = 'neuma:positions:place';

/** impure — ask the POSITIONS window (open or about to be) to stand on one position. */
export const requestPositionPlace = (office) => {
  let place;
  try { place = JSON.parse(localStorage.getItem(POSITION_PLACE_KEY)) ?? {}; } catch { place = {}; }
  localStorage.setItem(POSITION_PLACE_KEY, JSON.stringify({ ...place, office }));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { office } }));
};

/** impure — hear a place asked for while the window is open. */
export const onPositionPlace = (handler) => {
  const listener = (e) => handler(e.detail?.office);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
