// door-words — what a door is called (its press: at most three words, the
// arrow drawn beside it) and where it lands (its hover: the path, said once).
// One table for every door on the desk, so the same door reads the same
// everywhere (design language § SHOW, DON'T TELL 8). Pure.

import { isMarketingPlatform } from '../../windowing/retired-windows.js';

const TAB_WORDS = Object.freeze({
  board: 'BOARD', campaigns: 'CAMPAIGNS', accounts: 'ACCOUNTS', brand: 'BRAND', leads: 'LEADS', seat: 'SEAT',
});

/** The door's press, in one to three words: its own `label` where the door names one, else its kind's. */
export const doorLabel = (door) => {
  if (door?.label) return door.label;
  switch (door?.kind) {
    case 'keys': return door.connect ? 'CONNECT' : door.add ? '+ ACCOUNT' : 'KEYS';
    case 'handle': return 'RECORD';
    case 'brand': return door.section === 'sources' ? 'SITE & CODE' : 'BRAND KITS';
    case 'account': return 'ACCOUNT';
    case 'standing': return door.drawer === 'crew' ? 'CREW' : 'HOLDER';
    case 'queue': return 'QUEUE';
    case 'marketing': return door.campaignId ? 'CAMPAIGN' : TAB_WORDS[door.tab] || 'SEAT';
    case 'app': return String(door.app || '').toUpperCase() || 'OPEN';
    case 'chat': return 'CHAT';
    default: return 'OPEN';
  }
};

// A platform account's place: MARKETING's account level for a public platform, COMMUNITY's own window else.
const accountWhere = (door, channelName) => {
  const name = channelName || String(door.channelId || '').toUpperCase();
  return isMarketingPlatform(door.channelId) ? `MARKETING → ${name}${door.accountId ? ` ${door.accountId}` : ''}` : name;
};

/** Where the door lands, for its hover. */
export const doorPlace = (door, channelName = '') => {
  switch (door?.kind) {
    case 'keys': return `Settings → API → Channel keys${door.accountId ? ` → ${door.accountId}` : door.channelId ? ` → ${channelName || door.channelId}` : ''}`;
    case 'handle': return `record ${door.accountId}'s expected @handle here`;
    case 'brand': return door.companyId ? `MARKETING → ${door.companyId} → BRAND${door.section === 'sources' ? ' → SITE & CODE' : ''}` : 'MARKETING → BRAND';
    case 'account': return accountWhere(door, channelName);
    case 'standing': return `${accountWhere(door, channelName)} → STANDING → ${door.drawer === 'crew' ? 'CREW' : 'HOLDER'}`;
    case 'queue': return `${accountWhere(door, channelName)} → QUEUE${door.entryId ? ` → ${door.entryId}` : ''}`;
    case 'marketing': return `MARKETING → ${door.campaignId ? 'CAMPAIGNS → the campaign' : TAB_WORDS[door.tab] || 'SEAT'}${door.accountId ? ` → ${door.accountId}` : ''}`;
    case 'app': return String(door.app || '').toUpperCase();
    case 'chat': return `${door.name || door.neumaId}'s chat${door.sessionId ? '' : ' — the newest sitting'}`;
    default: return '';
  }
};
