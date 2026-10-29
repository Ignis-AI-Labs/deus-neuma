// retired-windows.js — the windows MARKETING took in (marketing-panel-plan.md
// §5, ruling 2026-10-24: […]). Each public
// platform's window became the ACCOUNT level inside MARKETING; SOCIAL CHECK
// became its ACCOUNTS tab, BRAND KITS its BRAND tab, LEADS its LEADS tab.
//
// Their ids still arrive — a saved layout, a pinned launcher, a WAITING ON YOU
// row (the backend names a post's platform), a card, a palette command — so
// each one opens MARKETING at the same place instead of a blank window or
// nothing. TELEGRAM and DISCORD are COMMUNITY's (the private circles, never
// marketed through): they keep their own windows and are not in this table.
//
// Pure — the window manager, the card latch and the taskbar carry it out.

export const MARKETING_WINDOW = 'marketing';

/** The public platforms whose windows are now MARKETING's account level. */
export const MARKETING_PLATFORMS = Object.freeze(['x', 'facebook', 'mastodon', 'bluesky', 'linkedin', 'youtube', 'tiktok']);

/**
 * Each platform's name. The launcher still lists every platform (Founder
 * 2026-10-27: […]): a tile opens MARKETING on that
 * platform, and a pin of one stays a pin of that platform.
 */
export const PLATFORM_LABELS = Object.freeze({
  x: 'X', facebook: 'Facebook', mastodon: 'Mastodon', bluesky: 'Bluesky', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok',
});

const TAB_OF = Object.freeze({ socialCheck: 'accounts', brandKits: 'brand', leads: 'leads' });

/** Whether a platform's space lives in MARKETING now (COMMUNITY's do not). */
export const isMarketingPlatform = (id) => MARKETING_PLATFORMS.includes(id);

/**
 * Where a retired window's id lands in MARKETING, as a MARKETING landing
 * (zoom-fold.js landingPlace), or null when the id is not a retired window.
 * @param {string} id
 * @returns {?({account: {channelId: string}}|{tab: string})}
 */
export const retiredPlace = (id) => {
  if (isMarketingPlatform(id)) return { account: { channelId: id } };
  return typeof id === 'string' && Object.hasOwn(TAB_OF, id) ? { tab: TAB_OF[id] } : null;
};

/**
 * An OPEN of a retired window, turned into an OPEN of MARKETING and the place
 * it lands on. Every other action passes through untouched.
 * @param {object} action - a window-manager action
 * @returns {{action: object, landing: ?object}}
 */
export const redirectAction = (action) => {
  const place = action && (action.type === 'OPEN' || action.type === 'TOGGLE') ? retiredPlace(action.id) : null;
  return place ? { action: { ...action, id: MARKETING_WINDOW }, landing: place } : { action, landing: null };
};

/**
 * A landing latched for a retired platform's window ([…],
 * […]), as MARKETING's account-level landing. Null
 * for any other app: its landing stands as it was.
 * @param {string} appId
 * @param {?object} item - {entryId?, section?, accountId?}
 * @returns {?object}
 */
export const marketingLandingOf = (appId, item) => {
  if (!isMarketingPlatform(appId)) return null;
  const { accountId = null, ...rest } = item || {};
  return { ...rest, account: { channelId: appId, accountId } };
};

/**
 * A saved open-set with every retired window folded into one MARKETING, and
 * the place the first of them names — only when MARKETING was not itself open
 * (its own remembered place then stands). Never a blank window.
 * @param {?Array<{id: string}>} list
 * @returns {{list: Array<{id: string}>, landing: ?object}}
 */
export const migrateOpenSet = (list) => {
  const saved = Array.isArray(list) ? list : [];
  const hadMarketing = saved.some((w) => w?.id === MARKETING_WINDOW);
  let landing = null;
  const out = [];
  for (const w of saved) {
    const place = retiredPlace(w?.id);
    if (!place) { out.push(w); continue; }
    if (!landing && !hadMarketing) landing = place;
    if (!out.some((o) => o?.id === MARKETING_WINDOW)) out.push({ id: MARKETING_WINDOW });
  }
  return { list: out, landing };
};

/**
 * App ids (a launcher's pins) with every retired window as MARKETING, once, in
 * place. A platform stays itself: its launcher tile opens MARKETING on it.
 */
export const migrateAppIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [])
  .map((id) => (retiredPlace(id) && !isMarketingPlatform(id) ? MARKETING_WINDOW : id)))];
