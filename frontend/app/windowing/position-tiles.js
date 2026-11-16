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

/** [office, the seat on the tile, the words search also answers to] — the seat's corporate name,
 *  as the POSITIONS rail names it (Design note, 2026-11-16: the same terms and titles everywhere); its short
 *  form, house title and function are what search also finds it by. */
export const POSITION_TILES = Object.freeze([
  ['cos', 'CHIEF OF STAFF', ['cos', 'optio', 'management', 'board']],
  ['cro', 'CHIEF REVENUE OFFICER', ['cro', 'mercator', 'sales', 'leads', 'deals', 'mailbox', 'email', 'outreach']],
  ['cmo', 'CHIEF MARKETING OFFICER', ['cmo', 'legatus', 'marketing', 'campaigns', 'brand', 'posts']],
  ['clo', 'CHIEF LEGAL OFFICER', ['clo', 'praetor', 'law', 'legal']],
  ['cso', 'CHIEF SECURITY OFFICER', ['cso', 'praefectus', 'security', 'guard']],
  ['cfo', 'CHIEF FINANCIAL OFFICER', ['cfo', 'quaestor', 'treasury', 'spend', 'invoices']],
  ['cao', 'CHIEF ACCOUNTING OFFICER', ['cao', 'logista', 'books', 'accounts', 'ledger']],
].map((t) => Object.freeze(t)));

const PREFIX = 'position-';
export const positionTileId = (office) => `${PREFIX}${office}`;
/** The office a tile id opens, or null when the id is not a position tile. */
export const officeOfTile = (id) => (typeof id === 'string' && id.startsWith(PREFIX) && POSITION_TILES.some(([o]) => o === id.slice(PREFIX.length)) ? id.slice(PREFIX.length) : null);

/** The windows whose work now stands inside a position's hub: no tile, still searchable. */
export const FOLDED_INTO_POSITIONS = Object.freeze(['positions', 'staff', 'legal', 'security', 'treasury']);

const EVENT = 'neuma:position-place';
export const POSITION_PLACE_KEY = 'neuma:positions:place';

/** pure — a kept place moved onto one position, and onto one of its tabs when a tab is named. */
export const placeOn = (place, office, tab = null) => ({ ...place, office, ...(tab ? { tabs: { ...(place?.tabs ?? {}), [office]: tab } } : {}) });

/** impure — ask the POSITIONS window (open or about to be) to stand on one position, and one of its tabs. */
export const requestPositionPlace = (office, tab = null) => {
  let place;
  try { place = JSON.parse(localStorage.getItem(POSITION_PLACE_KEY)) ?? {}; } catch { place = {}; }
  localStorage.setItem(POSITION_PLACE_KEY, JSON.stringify(placeOn(place, office, tab)));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { office, tab } }));
};

/** impure — hear a place asked for while the window is open. */
export const onPositionPlace = (handler) => {
  const listener = (e) => handler(e.detail?.office, e.detail?.tab ?? null);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
