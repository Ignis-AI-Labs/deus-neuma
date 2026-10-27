// tiktok-profile.js — the house's TikTok account as its view draws it: the
// profile, the four counts and the most recent videos, read fresh on every
// call (the desk reads on open and on REFRESH; nothing polls). What the
// connection may not read yet is named, never guessed: a connection made
// before the account view keeps posting and is told to RECONNECT.
// The pure law (fields per permission, mapping, words) is tiktok-profile-view.js.

import { tiktokAccessFor } from './tiktok-token.js';
import { readTikTokUserFields, listTikTokVideos } from './tiktok-api.js';
import {
  accountView, missingProfileScopes, profileReconnectWords, readRefusalWords, userFieldsFor, videoView,
  VIDEO_FIELDS, VIDEO_PAGE,
} from './tiktok-profile-view.js';

/**
 * Read the house's TikTok account. impure — credential store + network.
 * @param {string} house
 * @param {{signal?: AbortSignal, accountId?: string}} [opts] - accountId: which TikTok account (the first when absent)
 * @returns {Promise<{ok: true, account: object, videos: object[]|null, hasMore: boolean,
 *   videosError: string|null, missing: string[], reconnect: string|null, readAt: string}
 *   |{ok: false, status?: number, detail: string, reconnect?: boolean}>}
 */
export const readTikTokProfile = async (house, { signal, accountId } = {}) => {
  const token = await tiktokAccessFor(house, { signal, accountId });
  if (!token.ok) return token;
  const missing = missingProfileScopes(token.credentials?.grantedScope);
  const [user, list] = await Promise.all([
    readTikTokUserFields(token.accessToken, userFieldsFor(missing), { signal }),
    missing.includes('video.list') ? null : listTikTokVideos(token.accessToken, { fields: VIDEO_FIELDS, maxCount: VIDEO_PAGE, signal }),
  ]);
  if (!user.ok) return { ok: false, status: user.status, detail: readRefusalWords(user), reconnect: Boolean(user.reconnect) };
  if (!user.data?.user?.open_id) return { ok: false, detail: 'TikTok named no account for this sign-in' };
  const videos = list?.ok ? (list.data?.videos || []).map(videoView) : null;
  return {
    ok: true,
    account: accountView(user.data.user),
    videos,
    hasMore: Boolean(list?.ok && list.data?.has_more),
    videosError: list && !list.ok ? readRefusalWords(list) : null,
    missing,
    reconnect: profileReconnectWords(missing),
    readAt: new Date().toISOString(),
  };
};
