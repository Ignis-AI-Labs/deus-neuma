// waiting-jump.js — from a WAITING ON YOU row to the exact card it names:
// the window raised (or opened), the card brought into view and marked.
//
// A press in the notification tray's WAITING ON YOU section, on its arrival
// toast or on a platform band's OPEN is ANNOUNCED (one event) and the jumper
// inside the manager (WaitingJumps.jsx) carries it out. A window mounts after its OPEN, so what
// it must land on rides the latches its own tray cards already use
// (house-clock-focus.js, card-landing.js), and the card is found once it
// shows.

import { encodeStreamTransfer, openSittingActions } from '../stream-tab-transfer.js';
import { requestHouseClockTab } from '../house-clock/house-clock-focus.js';
import { requestCardLanding } from '../card-landing.js';
import { requestBrandSection } from '../brandkits/brand-landing.js';
import { requestSettingsFocus } from '../settings-focus.js';
import { cardSelector } from './waiting-view.js';
import { MARKETING_WINDOW, isMarketingPlatform } from '../../windowing/retired-windows.js';

const EVENT = 'neuma:waiting-jump';
const FIND_MS = 6000;
const MARK_MS = 2400;

/**
 * Pure — the window actions that put an item's card on screen when no open
 * window shows it yet.
 * @param {object} item - a waiting item (its `where`)
 * @param {Array<{id: string}>} windows - the open windows
 * @returns {object[]}
 */
export const jumpActions = (item, windows) => {
  const w = item?.where || {};
  if (w.app === 'chat' && w.sessionId && w.neumaId) {
    const payload = encodeStreamTransfer({
      id: `waiting-${w.sessionId}`, kind: w.beingKind === 'witness' ? 'witness' : 'local',
      neumaId: w.neumaId, name: w.name || w.neumaId, sessionId: w.sessionId, focus: null,
    });
    return payload ? openSittingActions(payload, windows) : [{ type: 'OPEN', id: 'chat' }];
  }
  if (w.app === 'chat' || w.app === 'council') return [{ type: 'OPEN', id: 'chat' }];
  // A public platform's post is on MARKETING's account level now; COMMUNITY's keep their windows.
  if (isMarketingPlatform(w.app)) return [{ type: 'OPEN', id: MARKETING_WINDOW }];
  return w.app ? [{ type: 'OPEN', id: w.app }] : [];
};

// impure — latch what the opened window lands on (its own landing idioms).
const latchLanding = (item) => {
  const w = item?.where || {};
  if (w.app === 'houseclock') requestHouseClockTab(w.tab || 'asks');
  else if (w.app === 'settings' && w.focus) requestSettingsFocus(w.focus);
  else if (w.app === 'sovereignty') requestCardLanding('sovereignty', { neumaId: w.neumaId, proposalId: w.proposalId });
  else if (w.channelId) requestCardLanding(w.channelId, { entryId: w.entryId, section: w.section, ...(w.accountId ? { accountId: w.accountId } : {}), ...(w.code ? { code: w.code } : {}) });
  // A company's proposed links land on its BRAND tab, at SITE & CODE, where their card stands.
  else if (w.app === 'marketing' && w.tab) {
    if (w.companyId && w.section) requestBrandSection(w.companyId, w.section);
    requestCardLanding('marketing', { tab: w.tab, companyId: w.companyId || null });
  }
  // A campaign ask lands on its campaign's page; a row naming no campaign (a paused mandate) at SEAT.
  else if (w.app === 'marketing') requestCardLanding('marketing', w.campaignId ? { campaignId: w.campaignId } : { seat: true });
};

/** impure — announce a jump (the tray's rows and toasts, a platform band's OPEN). */
export const requestWaitingJump = (item) => {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { item } }));
};

/**
 * impure — subscribe to jumps (the jumper inside the window manager).
 * @param {(item: object) => void} handler
 * @returns {() => void}
 */
export const onWaitingJump = (handler) => {
  const listener = (e) => handler(e.detail?.item);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};

// impure — scroll the card into view inside its OWN window only: every
// scroller between the card and its window is moved, never the desk itself.
const scrollWithinWindow = (el) => {
  const win = el.closest('.fwin');
  for (let n = el.parentElement; n && n !== win; n = n.parentElement) {
    const style = getComputedStyle(n);
    if (n.scrollHeight <= n.clientHeight + 1 || !/(auto|scroll)/.test(style.overflowY)) continue;
    const top = el.getBoundingClientRect().top - n.getBoundingClientRect().top;
    n.scrollTop += top - Math.max(0, (n.clientHeight - el.offsetHeight) / 2);
  }
};

// impure — the card, once its window shows it: brought into view and marked
// for a moment (the mark rises over its transition — no-flash law). Shared
// with the doors that land on one row (Settings → API → an account).
export const revealCard = (selector, deadline = Date.now() + FIND_MS) => {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) {
    if (selector && Date.now() < deadline) setTimeout(() => revealCard(selector, deadline), 120);
    return;
  }
  scrollWithinWindow(el);
  el.classList.add('is-wait-landed');
  setTimeout(() => el.classList.remove('is-wait-landed'), MARK_MS);
};

/**
 * impure — carry a jump out: a card already on the desk raises its own window;
 * otherwise the item's window opens on it.
 * @param {object} item
 * @param {{windows: Array<{id: string}>, dispatch: (action: object) => void}} desk
 */
export const jumpTo = (item, { windows, dispatch }) => {
  const selector = cardSelector(item);
  const shown = selector ? document.querySelector(selector) : null;
  const home = shown?.closest('[data-window-id]');
  if (home) {
    dispatch({ type: 'FOCUS', id: home.dataset.windowId, restore: true });
  } else {
    for (const action of jumpActions(item, windows)) dispatch(action);
    latchLanding(item);
  }
  revealCard(selector);
};
