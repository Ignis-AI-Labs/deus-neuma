// board-change — a board saved in one MARKETING window (or arranged by the CMO) reaches the others.
// The desk's own precedent for a change every window must hear (DeskSection,
// text-size): a window event for the windows of this page, and a localStorage
// stamp, whose `storage` event reaches every other desk page of this origin
// (a second desk, a torn-out window). The stamp carries only the level and is
// keyed by the operator's wallet, so another house's page never hears it; the
// board itself is always re-read from the house's own route.
//
// impure — window events, localStorage.

import { walletKey } from '../../windowing/storage-scope.js';

const EVENT = 'neuma:marketing-board';
const KEY = 'marketing-board-changed';
// The CMO's arrangement names its level only in words, so it is told to every level: each reader re-reads its own.
export const EVERY_LEVEL = '*';
// The act's chip once it settled (intent-sweep.js): `intents/<policy row>`, status ok.
const ARRANGED = 'intents/marketing.board-arrange';

/**
 * Tell every other board reader that a level's board changed. impure.
 * @param {string} level
 * @param {string} from - the announcing reader, which does not hear itself
 */
export const announceBoardChange = (level, from) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { level, from } }));
  try {
    globalThis.localStorage.setItem(walletKey(KEY), JSON.stringify({ level, at: Date.now(), from }));
  } catch {
    // A refused store only keeps other desk pages from hearing at once; they read the board on their next open.
  }
};

/**
 * Hear a level's board change from another reader of this page or another
 * desk page. impure.
 * @param {string} self - this reader, never told of its own changes
 * @param {(level: string) => void} onLevel
 * @returns {() => void} stop listening
 */
export const onBoardChange = (self, onLevel) => {
  const here = (e) => { if (e.detail?.from !== self) onLevel(e.detail?.level); };
  const elsewhere = (e) => {
    if (e.storageArea !== globalThis.localStorage || e.key !== walletKey(KEY) || !e.newValue) return;
    try { onLevel(JSON.parse(e.newValue).level); } catch { /* a stamp this page cannot read names no level */ }
  };
  window.addEventListener(EVENT, here);
  window.addEventListener('storage', elsewhere);
  return () => {
    window.removeEventListener(EVENT, here);
    window.removeEventListener('storage', elsewhere);
  };
};

/**
 * A CMO's arrangement, settled in a chat this desk is showing (its `tool:usage`
 * chip), reaches every board reader: this page's windows and the other desk
 * pages, the same way the operator's own change does. A refused or pending
 * arrangement changed nothing and says nothing. impure.
 * @param {{tool?: string, status?: string}} frame - a `tool:usage` frame
 */
export const announceBoardArrangement = (frame) => {
  if (frame?.tool === ARRANGED && frame.status === 'ok') announceBoardChange(EVERY_LEVEL, 'cmo');
};
