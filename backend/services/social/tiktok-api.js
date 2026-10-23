// tiktok-api.js — the TikTok Open API calls the channel needs: who the
// connection speaks as (user info), what the account allows right now
// (creator info), opening a publish (Direct Post or the inbox upload), and a
// publish's status. Uploading the bytes is tiktok-upload.js.
//
// Every call answers {ok:true, data} | {ok:false, status?, code?, detail,
// reconnect?} and never throws. TikTok wraps answers as {data, error:{code}}
// with code `ok` on success, and some refusals arrive with HTTP 200, so the
// code — not only the status — decides. The root rides the env door in
// tiktok-oauth.js (NEUMA_TIKTOK_API_ROOT); tests aim it at a local stand-in.

import { tiktokApiRoot } from './tiktok-oauth.js';
import { mapTikTokError } from './tiktok-errors.js';

const INIT_PATHS = Object.freeze({
  post: '/v2/post/publish/video/init/',
  drafts: '/v2/post/publish/inbox/video/init/',
});

/**
 * TikTok's public post ids are int64 (19 digits), past what a JS number
 * holds exactly: quote them in the raw answer before it is parsed. Pure.
 * @param {string} raw
 * @returns {string}
 */
export const quoteBigIds = (raw) => String(raw).replace(
  /("publicaly_available_post_id"\s*:\s*\[)([^\]]*)(\])/g,
  (_, open, list, close) => `${open}${list.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => (/^\d+$/.test(s) ? `"${s}"` : s)).join(',')}${close}`,
);

// impure — one authorised call; never throws.
const call = async (method, pathAndQuery, accessToken, { body, signal } = {}) => {
  try {
    const res = await fetch(`${tiktokApiRoot()}${pathAndQuery}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      signal,
    });
    const json = await res.text().then((raw) => JSON.parse(quoteBigIds(raw))).catch(() => ({}));
    const code = json?.error?.code;
    if (res.ok && (code === undefined || code === 'ok')) return { ok: true, data: json?.data ?? {} };
    return { ok: false, status: res.status, ...mapTikTokError(res.status, json) };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, detail: 'interrupted before TikTok answered; nothing was published' };
    return { ok: false, detail: `TikTok did not answer (${err.message})` };
  }
};

/**
 * The account a connection speaks as (scope user.info.basic). impure — network.
 * @returns {Promise<{ok: true, user: {id: string, displayName: string}}|{ok: false, detail: string}>}
 */
export const readTikTokUser = async (accessToken, opts) => {
  const out = await call('GET', '/v2/user/info/?fields=open_id,display_name', accessToken, opts);
  if (!out.ok) return out;
  const user = out.data?.user;
  if (!user?.open_id) return { ok: false, detail: 'TikTok named no account for this sign-in' };
  return { ok: true, user: Object.freeze({ id: String(user.open_id), displayName: String(user.display_name || '') }) };
};

/**
 * What the account allows right now: privacy options, interaction switches,
 * the longest video. Asked before every post (TikTok's posting guidelines).
 * impure — network.
 * @returns {Promise<{ok: true, data: object}|{ok: false, detail: string}>}
 */
export const queryCreatorInfo = (accessToken, opts) => call('POST', '/v2/post/publish/creator_info/query/', accessToken, opts);

/**
 * Open a publish: Direct Post (`post_info` + `source_info`) or the inbox
 * upload (`source_info` only). Publishes nothing on its own: a FILE_UPLOAD
 * whose bytes never arrive expires with its upload URL (one hour).
 * impure — network.
 * @param {string} accessToken
 * @param {{mode: 'post'|'drafts', postInfo?: object, sourceInfo: object, signal?: AbortSignal}} args
 * @returns {Promise<{ok: true, publishId: string, uploadUrl: string}|{ok: false, status?: number, detail: string}>}
 */
export const initTikTokVideo = async (accessToken, { mode, postInfo, sourceInfo, signal }) => {
  const body = mode === 'post' ? { post_info: postInfo, source_info: sourceInfo } : { source_info: sourceInfo };
  const out = await call('POST', INIT_PATHS[mode], accessToken, { body, signal });
  if (!out.ok) return out;
  if (!out.data?.publish_id || !out.data?.upload_url) return { ok: false, detail: 'TikTok opened no upload (no publish id or upload URL); nothing was published' };
  return { ok: true, publishId: String(out.data.publish_id), uploadUrl: String(out.data.upload_url) };
};

/**
 * One publish's status. impure — network.
 * @returns {Promise<{ok: true, data: {status: string, fail_reason?: string,
 *   publicaly_available_post_id?: Array<number|string>}}|{ok: false, detail: string}>}
 */
export const fetchPublishStatus = (accessToken, publishId, opts = {}) =>
  call('POST', '/v2/post/publish/status/fetch/', accessToken, { ...opts, body: { publish_id: publishId } });
