// zoom-memory.js — the last place the operator stood in MARKETING (a company
// and a tab, or an account level), remembered per house: the key carries the operator's wallet, so
// two houses on one machine never share a place. With no wallet signed in,
// nothing is remembered (an unkeyed place would be every house's).
//
// impure — localStorage.

import { walletKey } from '../../windowing/storage-scope.js';

const KEY = 'marketing-zoom';

// impure — the signed-in wallet, or null.
const signedIn = () => {
  try { return globalThis.localStorage?.getItem('walletAddress') || null; } catch { return null; }
};

/** impure — this house's remembered place, or null. */
export const readZoom = () => {
  if (!signedIn()) return null;
  try {
    const raw = JSON.parse(globalThis.localStorage.getItem(walletKey(KEY)) || 'null');
    if (!raw || typeof raw !== 'object') return null;
    const a = raw.account && typeof raw.account.channelId === 'string' ? raw.account : null;
    return {
      companyId: typeof raw.companyId === 'string' ? raw.companyId : null,
      tab: String(raw.tab || 'board'),
      account: a ? { channelId: a.channelId, accountId: typeof a.accountId === 'string' ? a.accountId : null } : null,
    };
  } catch {
    return null;
  }
};

/** impure — remember this house's place (the company and the tab, or the account; a campaign page is not a place to return to). */
export const writeZoom = ({ companyId, tab, account = null }) => {
  if (!signedIn()) return;
  try {
    globalThis.localStorage.setItem(walletKey(KEY), JSON.stringify({ companyId: companyId || null, tab, account }));
  } catch {
    // A full or refused store only forgets the place; the window still stands where it is.
  }
};
