// platform-row.js — every platform MARKETING speaks on, in view at every
// level whatever its accounts are doing: a broken or locked keys file never
// hides the platforms, nor the way in to fix them (Design note, 2026-10-26: […]). Each platform is
// one mark and a door to its account level — the level's first account on
// it, or, with none, the platform where its first account is added.
//
//   ●  its accounts here are in use and clear
//   ◐  one of them is in use and failing the house check
//   ○  its accounts here are not in use
//   +  no account on it at this level
//   ▲  the house's keys file can't be opened: nothing about it can be read
//
// Pure.

import { MARKETING_PLATFORMS, PLATFORM_LABELS } from '../../windowing/retired-windows.js';
import { inScope, accountMark } from '../marketing-overview/overview-fold.js';
import { MARK } from '../marketing-overview/overview-words.js';

/** Each platform as the row names it (its mark beside it says the rest). */
export const PLATFORM_NAMES = Object.freeze(Object.fromEntries(Object.entries(PLATFORM_LABELS).map(([id, name]) => [id, name.toUpperCase()])));

export const ROW_MARK = Object.freeze({
  ...MARK,
  none: Object.freeze({ glyph: '+', words: 'no account here yet — open it to add one' }),
  locked: Object.freeze({ glyph: '▲', words: 'the house\'s keys file can\'t be opened — its accounts can\'t be read' }),
});

/**
 * pure — the row at one level.
 * @param {{accounts: object[], check: ?object, scope: ?Set<string>, locked: ?{why: string}}} input
 *   scope — the level's companies (null = the house, every account)
 * @returns {ReadonlyArray<{channelId: string, name: string, count: number, state: string, accountId: ?string, title: string}>}
 */
export const platformRow = ({ accounts, check, scope, locked }) => Object.freeze(MARKETING_PLATFORMS.map((channelId) => {
  const on = (accounts || []).filter((a) => a.channelId === channelId && inScope(scope, a.companyId));
  const marks = on.map((a) => accountMark(a.id, check));
  const state = locked ? 'locked'
    : !on.length ? 'none'
      : marks.includes('failing') ? 'failing'
        : marks.includes('clear') ? 'clear' : 'idle';
  const name = PLATFORM_NAMES[channelId] || channelId.toUpperCase();
  const count = on.length ? ` · ${on.length} account${on.length === 1 ? '' : 's'} here` : '';
  return Object.freeze({
    channelId, name, count: on.length, state, accountId: on[0]?.id ?? null,
    title: `${name} — ${ROW_MARK[state].words}${count} · open it`,
  });
}));
