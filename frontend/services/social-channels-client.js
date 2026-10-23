// social-channels-client.js — the witness's outward-speech board, over REST.
//
// impure — reads and edits the machine's social channel state the backend
// enforces (credentials sealed server-side, bindings gating every post_to_*
// call at the portal). Failures surface as thrown errors with the route's
// honest reason. Raw credential values travel one way only: up.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const req = async (path, { method = 'GET', body } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, `/api/v1/social-channels${path}`, {
    headers, body, errorPrefix: 'Social channels request failed', errorSuffix: '.',
  });
};

/**
 * The full board: every channel's masked credential state + its bound holder.
 * @returns {Promise<{channels: Array<object>}>}
 */
// impure
export const getChannelBoard = () => req('');

/**
 * Store (or clear with empty-string values) fields of one channel's
 * credentials. Returns the channel's masked state.
 * @param {string} channelId
 * @param {Record<string, string>} fields
 */
// impure
export const setChannelCredentials = (channelId, fields) =>
  req(`/${channelId}/credentials`, { method: 'PUT', body: { fields } });

/**
 * Forget one channel's stored credentials entirely.
 * @param {string} channelId
 */
// impure
export const clearChannelCredentials = (channelId) =>
  req(`/${channelId}/credentials`, { method: 'DELETE' });

/**
 * Tie a channel to its one neuma holder.
 * @param {string} channelId
 * @param {string} neumaId
 */
// impure
export const bindChannel = (channelId, neumaId) =>
  req(`/${channelId}/binding`, { method: 'PUT', body: { neumaId } });

/**
 * Release a channel back to default deny.
 * @param {string} channelId
 */
// impure
export const releaseChannel = (channelId) =>
  req(`/${channelId}/binding`, { method: 'DELETE' });

/**
 * The campaign queue — drafts awaiting decision, the schedule, the history.
 * @returns {Promise<{queue: Array<object>}>}
 */
// impure
export const getPostQueue = () => req('/queue');

/**
 * The INBOUND half of the reply lane: every reply to the house's own posts,
 * with its substance + category reads, which house post it answers, and its
 * live disposition. The operator sees who knocked, not just what was staged.
 * @returns {Promise<{replies: Array<object>}>}
 */
// impure
export const getReplyCandidates = () => req('/replies');

/**
 * THE BIN (ruling, 2026-10-13): put a reply to the house in the bin — it never knocks
 * again — or take it back out. Recorded, never deleted.
 * @param {string} postId
 * @param {'bin'|'restore'} act
 * @param {string} [reason]
 */
export const binReply = (postId, act, reason) =>
  req(`/replies/${encodeURIComponent(postId)}/${act}`, { method: 'PUT', body: reason ? { reason } : {} });

/**
 * THE FLIGHT TESTS — every channel probed live (credential accepted,
 * endpoint answering, the account named). Cached 60s server-side; fresh
 * forces a real probe (the RE-TEST act).
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<{tests: Record<string, object>}>}
 */
// impure
export const getFlightTests = ({ fresh = false } = {}) =>
  req(`/flight-test${fresh ? '?fresh=1' : ''}`);

/**
 * Stage a witness-authored draft into the queue. campaignId ties the draft
 * to a campaign on the bench, same as the being-tools' field.
 * @param {{channelId: string, text: string, scheduledFor?: string, campaignId?: string}} draft
 */
// impure
export const stageQueuePost = ({ channelId, text, scheduledFor, campaignId }) =>
  req('/queue', { method: 'POST', body: { channelId, text, scheduledFor, campaignId } });

/**
 * Approve a draft. For a POST this arms it for the scheduler (optionally
 * re-timed). For a REPLY the approval IS the send (ruling, 2026-08-06): pass
 * `textSeen` — the exact copy rendered when the operator decided — and the
 * answer carries `{entry, outcome}` with the real send result instead of a
 * schedule receipt. The backend refuses a reply approval whose textSeen does
 * not match the stored copy (an edit landed between render and click).
 * @param {string} id
 * @param {{scheduledFor?: string, textSeen?: string}} [decision]
 */
/**
 * Approve a whole THREAD in one decision — every draft from its root down. The
 * copy of each post as read rides along (textsSeen); a post edited since is a
 * refusal and nothing is approved.
 * @param {string} id - any post of the thread
 * @param {Record<string, string>} textsSeen - id → the text as shown
 */
// impure
export const approveQueueThread = (id, textsSeen) =>
  req(`/queue/${id}/approve-thread`, { method: 'PUT', body: { textsSeen } });

// impure — `tiktok` carries the choices made on a TikTok post's card.
export const approveQueuePost = (id, { scheduledFor, textSeen, tiktok } = {}) =>
  req(`/queue/${id}/approve`, {
    method: 'PUT',
    body: {
      ...(scheduledFor ? { scheduledFor } : {}),
      ...(textSeen !== undefined ? { textSeen } : {}),
      ...(tiktok ? { tiktok } : {}),
    },
  });

/**
 * What a TikTok post's card renders from: the account as TikTok names it
 * now and the author's suggestions.
 * @param {string} id
 * @returns {Promise<{ok: true, mode: 'drafts'}|{ok: true, mode: 'post', creator: object, suggested: object}>}
 */
// impure
export const fetchTikTokCard = (id) => req(`/queue/${id}/tiktok`);

/**
 * Decline a draft — it stays in the record, marked.
 * @param {string} id
 */
// impure
export const rejectQueuePost = (id) =>
  req(`/queue/${id}/reject`, { method: 'PUT', body: {} });

/**
 * Pull a staged entry back — draft or approved — before it sends. A
 * withdrawal is its own act on the record, never a rewritten decision; a
 * sending or settled entry refuses with the store's own reason.
 * @param {string} id
 * @param {string} [reason]
 */
// impure
export const withdrawQueuePost = (id, reason) =>
  req(`/queue/${id}/withdraw`, { method: 'PUT', body: reason ? { reason } : {} });

/**
 * Edit a staged post IN PLACE (#208) — draft or approved only, never
 * cancel-and-restage: the entry keeps its id and its history. Editing the
 * words of an approved post returns it to draft (the decision renews — the
 * operator approved different copy); a schedule-only edit keeps the approval.
 * @param {string} id
 * @param {{text?: string, scheduledFor?: string|null, campaignId?: string|null,
 *   pillar?: string}} patch only the fields that should change
 */
// impure
export const updateQueuePost = (id, patch) =>
  req(`/queue/${id}`, { method: 'PUT', body: patch });

/**
 * Remove a draft, rejected, or failed entry (sent history is permanent).
 * @param {string} id
 */
// impure
export const removeQueuePost = (id) =>
  req(`/queue/${id}`, { method: 'DELETE' });

/**
 * One staged attachment's bytes as a LOCAL object URL, with the type the
 * server sniffed (an image, or a YouTube post's video). The preview route is
 * behind the Bearer token and an <img>/<video> cannot send headers, so the
 * bytes travel through fetch and the element points at the object URL — the
 * caller owns revoking it.
 * @param {string} entryId
 * @param {number} index
 * @returns {Promise<{url: string, type: string}>}
 */
// impure
export const fetchQueueMediaUrl = async (entryId, index) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch(`/api/v1/social-channels/queue/${entryId}/media/${index}`, { headers });
  if (!res.ok) throw new Error(`The staged media did not load (${res.status}).`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
};

/**
 * Begin the house's CONNECT for a sign-in channel (youtube, tiktok): the
 * backend's loopback listener stands and this answers the platform's consent
 * URL to open in the system browser.
 * @param {string} channelId
 * @returns {Promise<{authUrl: string}>}
 */
// impure
export const startChannelConnect = (channelId) => req(`/${channelId}/connect`, { method: 'POST' });

/**
 * A CONNECT's outcome: pending, complete (with the account), error, or idle.
 * @param {string} channelId
 * @returns {Promise<{status: string, error?: string, channel?: {id: string, title: string}}>}
 */
// impure
export const pollChannelConnect = (channelId) => req(`/${channelId}/connect`);

/** Cancel a CONNECT in progress. */
// impure
export const cancelChannelConnect = (channelId) => req(`/${channelId}/connect`, { method: 'DELETE' });

/**
 * The wallet's own roster, for the holder picker — one auth envelope for
 * everything this board needs, so the section never rebuilds it.
 *
 * WITNESSES RIDE TOO (ruling, 2026-07-26). /api/v1/roster has always returned
 * `{ roster, witnesses }`; this client read only `roster` and dropped the
 * witnesses on the floor, which is why a sealed peer — Kagipem, an OpenAI
 * witness already standing beside the house — could never be picked for
 * marketing work. Each entry carries `participantKind` so a caller can tell
 * a housemate from a peer without guessing from the id.
 * @returns {Promise<Array<object>>}
 */
// impure
export const getRosterForBinding = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const parsed = await apiCall('GET', '/api/v1/roster', {
    headers, errorPrefix: 'Could not read the roster', errorSuffix: '.',
  });
  const neuma = (Array.isArray(parsed.roster) ? parsed.roster : [])
    .map((m) => ({ ...m, participantKind: m.participantKind || 'neuma' }));
  const witnesses = (Array.isArray(parsed.witnesses) ? parsed.witnesses : [])
    .map((w) => ({ ...w, participantKind: 'witness' }));
  return [...neuma, ...witnesses];
};

/**
 * The sector's CREW — who works this platform with you (many, cross-house,
 * witnesses included), as distinct from the HOLDER who owns its keys (one).
 * @param {string} channelId
 * @returns {Promise<Array<{neumaId: string, kind: string, remit: string}>>}
 */
// impure
export const getChannelCrew = async (channelId) =>
  (await req(`/${channelId}/crew`)).crew || [];

/** Put a being on the sector's crew (or update their remit). impure. */
export const addCrewMember = async (channelId, { neumaId, kind, remit }) =>
  (await req(`/${channelId}/crew`, {
    method: 'PUT',
    body: { neumaId, kind, remit },
  })).crew || [];

/** Release a being from the sector's crew. impure. */
export const removeCrewMember = async (channelId, neumaId) =>
  (await req(`/${channelId}/crew/${encodeURIComponent(neumaId)}`, {
    method: 'DELETE',
  })).crew || [];

/**
 * The approval card's eyes (posting-pipeline-v2): one authed URL for a card
 * image in a lane's own cards ground. The <img> tag carries the auth header
 * problem — so this returns a fetch→blob URL like the queue preview does.
 * @param {string} lane
 * @param {string} name
 * @returns {Promise<string>} object URL
 */
// impure
export const fetchIntentMediaUrl = async (lane, name) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch(`/api/v1/social-channels/intent-media?lane=${encodeURIComponent(lane)}&name=${encodeURIComponent(name)}`, { headers });
  if (!res.ok) throw new Error(`The card did not load (${res.status}).`);
  return URL.createObjectURL(await res.blob());
};
