// door-plan — THE DOOR TABLE (show-dont-tell-audit.md, pattern 4; design
// language § SHOW, DON'T TELL 4: […]). A fix is data,
// `door: {kind, …where}`, and this says, for every kind, exactly where it
// lands: the window opened, and the place inside it latched in that window's
// own idiom (Settings' focus, a card landing, a brand kit's section, a
// waiting jump onto a card, a sitting, a place revealed and marked).
// open-door.js carries a plan out.
//
//   keys       {channelId?, accountId?, add?}
//                                           Settings → API → Channel keys (→ the platform → the account
//                                           row, or its ADD ACCOUNT, marked)
//   brand      {companyId, section?}        MARKETING → that company → BRAND (→ the kit's section)
//   account    {channelId, accountId?, companyId?}
//                                           MARKETING → the account level (that account, else the first
//                                           on the platform — under that company, else the house's)
//   standing   {channelId, accountId?, drawer}
//                                           the account level → STANDING → HOLDER / CREW
//   queue      {channelId, accountId?, entryId}
//                                           the account level → POSTS → that post's card, marked
//
// A public platform's space is MARKETING's account level (retired-windows.js);
// COMMUNITY's platforms (TELEGRAM, DISCORD) keep their own windows, and a
// `standing` or `queue` door onto one of them lands there.
//   marketing  {tab, companyId?, campaignId?, accountId?, reveal?}
//                                           MARKETING → the tab (→ the campaign's page / that account's
//                                           card on ACCOUNTS / a place on the tab, marked)
//   app        {app, reveal?}               that window (→ a place in it, marked)
//   chat       {neumaId, sessionId?, name?} that member's sitting (else their newest one-on-one)
//
// THIS HOUSE ONLY: a door names its place by id, and every window it opens
// reads that place from the signed-in operator's own house — a door cannot
// land in another's. Pure.

import { MARKETING_WINDOW, isMarketingPlatform } from '../../windowing/retired-windows.js';

// pure — an id made safe inside an attribute selector.
const safe = (v) => String(v).replace(/["\\]/g, '');

const inWindow = (app, selector) => (selector ? `[data-window-id="${safe(app)}"] ${selector}` : null);

const keysFocus = ({ channelId, accountId }) => {
  if (!channelId) return 'channel-keys';
  return accountId ? `channel-keys/${channelId}/${accountId}` : `channel-keys/${channelId}`;
};

// pure — MARKETING's own landing (zoom-fold.js landingPlace): a campaign's page, else a tab.
const marketingPlan = ({ tab, companyId = null, campaignId = null, accountId = null, reveal = null }) => ({
  open: 'marketing',
  landings: [
    { app: 'marketing', item: campaignId ? { campaignId } : { tab: tab || 'seat', companyId } },
    ...(accountId ? [{ app: 'social-check', item: { accountId } }] : []),
  ],
  reveal: accountId ? inWindow('marketing', `.sc-card[data-account="${safe(accountId)}"]`) : inWindow('marketing', reveal),
});

// pure — MARKETING's account level, with a drawer or a post on it to open.
const accountPlan = ({ channelId, accountId = null, companyId = null, section = null }) => ({
  open: MARKETING_WINDOW,
  landings: [{ app: MARKETING_WINDOW, item: { account: { channelId, accountId, companyId }, ...(section ? { section } : {}) } }],
});

/**
 * Where a door lands, as data. Pure.
 * @param {?{kind: string}} door
 * @returns {?{open?: string, settingsFocus?: string, landings?: Array<{app: string, item: object}>,
 *   brandSection?: {companyId: string, section: string}, jump?: object, sitting?: {neumaId: string, name: ?string},
 *   reveal?: ?string}} null when it is not a door this table knows (or it names no place)
 */
export const doorPlan = (door) => {
  switch (door?.kind) {
    case 'keys':
      return {
        open: 'settings',
        settingsFocus: keysFocus(door),
        reveal: door.add && door.channelId && !door.accountId ? inWindow('settings', '.cred-item.is-open .account-add') : null,
      };
    case 'brand':
      return {
        open: 'marketing',
        landings: [{ app: 'marketing', item: { companyId: door.companyId || null, tab: 'brand' } }],
        brandSection: door.companyId && door.section ? { companyId: door.companyId, section: door.section } : null,
      };
    case 'account':
      return door.channelId ? accountPlan(door) : null;
    case 'standing':
      if (!door.channelId) return null;
      return isMarketingPlatform(door.channelId) ? accountPlan({ ...door, section: door.drawer })
        : { open: door.channelId, landings: [{ app: door.channelId, item: { section: door.drawer } }] };
    case 'queue':
      return door.channelId && door.entryId ? {
        jump: { where: {
          app: isMarketingPlatform(door.channelId) ? MARKETING_WINDOW : door.channelId,
          channelId: door.channelId, accountId: door.accountId || null, entryId: door.entryId, section: 'posts',
        } },
      } : null;
    case 'marketing':
      return marketingPlan(door);
    case 'app':
      return door.app ? { open: door.app, reveal: inWindow(door.app, door.reveal) } : null;
    case 'chat':
      if (!door.neumaId) return null;
      return door.sessionId
        ? { jump: { where: { app: 'chat', neumaId: door.neumaId, sessionId: door.sessionId, name: door.name || null } } }
        : { sitting: { neumaId: door.neumaId, name: door.name || null } };
    default:
      return null;
  }
};
