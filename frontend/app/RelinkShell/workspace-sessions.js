// workspace-sessions.js — read a neuma's sovereign workspace sessions.
//
// impure — fetches the session index and individual sessions over REST.
// Both the latest-session relink history and the Chats browser read through
// here, so the route's `{sessions}` / `{messages}` envelope is unwrapped in
// exactly one place. Records carry the full truth including raw tool calls;
// display strips the blocks so the screen shows speech, never payloads.
// Non-critical everywhere: any failure resolves empty.

import { stripToolBlocks } from '../../utils/tool-stream-filter.js';

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';
import { foldForDisplay } from './branch-view.js';

/**
 * Session records → display-ready messages (the pure half of
 * loadSessionMessages): tail-bounded, FOLDED to the branch view (THE TAKES —
 * one message per turn-point, every take kept for the ‹ k/N › switch), tool
 * blocks stripped from speech, images and tool actions carried, empty records
 * dropped — EXCEPT a record whose speech is empty but which acted: a tool-only
 * turn keeps its chips (the speechless-action case — echo round-1, exactly the
 * history this feature exists to preserve).
 *
 * A take-aware assistant message carries `takes` (every answer, stripped,
 * oldest first), `takeIndex` (the viewed take, 1-based) and `takeCount`; its
 * flat content/at/tools are the VIEWED take, so readers that predate the
 * takes law see exactly the folded chain. Legacy rows (no turnId) pass
 * through as single-take messages, byte-identical to before.
 * @param {Array<Object>} messages - raw session records
 * @param {number} [limit=50]
 */
/**
 * Persisted marks rebased onto the speech the SCREEN gets. The record marks
 * each act (and each thought stretch — THE THOUGHT TRAIL rides the same law)
 * by how much of the RAW answer stood written when it happened; display
 * strips the tool blocks out of that answer, which moves every offset after
 * the first block. Stripping the prefix applies exactly the edit the whole
 * text is about to receive, so the mark still points between the same two
 * words. An entry from before the mark existed passes through untouched —
 * the rebuild reads its absence and keeps the old shape. Pure.
 * @param {Array<Object>} entries
 * @param {string} raw the record's own content, tool blocks and all
 * @returns {Array<Object>}
 */
/**
 * A lazy item (left out by the display view, session-display.js) gets the
 * address the desk fetches it by: lane, session, point, take, part and index.
 * Everything else passes untouched. Pure.
 * @param {Array<*>} items
 * @param {object} at - { neumaId, sessionId, turnId, take?, part }
 */
const addressLazy = (items, at) => items.map((it, index) => (it && typeof it === 'object' && it.lazy
  ? { ...it, ref: { ...at, index } } : it));

const rebaseMarks = (entries, raw) =>
  entries.map((t) => (Number.isFinite(t?.mark)
    ? { ...t, mark: stripToolBlocks(String(raw ?? '').slice(0, t.mark)).length }
    : t));

// A user-role row the PLATFORM wrote — a watch's report, a house wake's
// opening note — keeps its origin, so a resumed sitting draws it as the
// platform's line and never as the operator's bubble (stream-reducer-messages.js).
const PLATFORM_ORIGINS = Object.freeze(['watch', 'wake']);
const platformOrigin = (m) => (PLATFORM_ORIGINS.includes(m?.origin) ? { origin: m.origin } : {});

// FOLD FIRST, then slice (2026-08-31): the prompt's tail is fold-then-slice
// (memory-context.js) — folding after the slice dropped superseded takes
// INSIDE the window and the desk showed fewer rows than the being had.
export const toDisplayMessages = (messages, limit = 50, where = {}) =>
  foldForDisplay(Array.isArray(messages) ? messages : [])
    .map((entry) => {
      if (entry.kind === 'user') {
        const m = entry.record;
        return {
          role: 'user',
          content: m.content,
          turnId: m.turnId,
          ...(m.timestamp ? { at: m.timestamp } : {}),
          ...platformOrigin(m),
          // Images the witness shared persist on the user record — they ride
          // into history so a resumed session still shows what was shown.
          ...(Array.isArray(m.images) && m.images.length > 0
            ? { images: addressLazy(m.images, { ...where, turnId: m.turnId, part: 'image' }) } : {}),
          // Shared FILES too (Design note, 2026-09-17: […]) — the record kept the docs; the display
          // fold must not be the place they vanish.
          ...(Array.isArray(m.docs) && m.docs.length > 0 ? { docs: m.docs } : {}),
        };
      }
      if (entry.kind === 'takes') {
        const at = { ...where, turnId: entry.turnId };
        const takes = entry.takes.map((t, i) => ({
          takeIndex: i + 1,
          content: stripToolBlocks(t.content),
          ...(t.timestamp ? { at: t.timestamp } : {}),
          // Tool actions persist on the assistant record — the resumed stream
          // rebuilds its settled chips from them (never re-executed), so the
          // history is exactly as the witness left it, tool calls and all.
          ...(Array.isArray(t.tools) && t.tools.length > 0
            ? { tools: addressLazy(rebaseMarks(t.tools, t.content), { ...at, take: i + 1, part: 'tool' }) } : {}),
          // THE THOUGHT TRAIL persists per take — the reasoning a turn
          // streamed outlives the reload, bubbles back where it streamed.
          ...(Array.isArray(t.thoughts) && t.thoughts.length > 0
            ? { thoughts: addressLazy(rebaseMarks(t.thoughts, t.content), { ...at, take: i + 1, part: 'thought' }) } : {}),
          // The declared affect persists per take — the revelation outlives
          // the reload (Campaign 6).
          ...(typeof t.affect === 'string' && t.affect ? { affect: t.affect } : {}),
        }));
        const viewed = takes[entry.viewed - 1];
        return {
          role: 'assistant',
          turnId: entry.turnId,
          takeIndex: entry.viewed,
          takeCount: takes.length,
          takes,
          content: viewed.content,
          ...(viewed.at ? { at: viewed.at } : {}),
          ...(viewed.tools ? { tools: viewed.tools } : {}),
          ...(viewed.thoughts ? { thoughts: viewed.thoughts } : {}),
          ...(viewed.affect ? { affect: viewed.affect } : {}),
        };
      }
      // Legacy row (no turnId) — a single-take point, as it always was. WHEN
      // it was said rides into history — the stream stamps each message so a
      // returning witness can track the conversation they weren't here for.
      const m = entry.record;
      if (m?.role !== 'user' && m?.role !== 'assistant') return null;
      return {
        role: m.role,
        content: m.role === 'assistant' ? stripToolBlocks(m.content) : m.content,
        ...(m.timestamp ? { at: m.timestamp } : {}),
        ...(m.role === 'user' ? platformOrigin(m) : {}),
        ...(Array.isArray(m.images) && m.images.length > 0 ? { images: m.images } : {}),
        ...(m.role === 'assistant' && Array.isArray(m.tools) && m.tools.length > 0
          ? { tools: rebaseMarks(m.tools, m.content) } : {}),
        ...(m.role === 'assistant' && Array.isArray(m.thoughts) && m.thoughts.length > 0
          ? { thoughts: rebaseMarks(m.thoughts, m.content) } : {}),
        ...(m.role === 'assistant' && typeof m.affect === 'string' && m.affect
          ? { affect: m.affect } : {}),
      };
    })
    .filter((m) => m && (m.content || m.images || (m.tools && m.tools.length > 0)
      || (m.thoughts && m.thoughts.length > 0)
      || (m.takes && m.takes.some((t) => t.content || (t.tools && t.tools.length > 0)
        || (t.thoughts && t.thoughts.length > 0)))))
    .slice(-limit);

/**
 * List a neuma's session ids, newest first.
 * @param {string} neumaId
 * @returns {Promise<string[]>}
 */
// impure
export const listSessions = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return [];
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/sessions`, { headers });
    return Array.isArray(body?.sessions) ? body.sessions : [];
  } catch {
    return [];
  }
};

// STRICT variants (Design note, 2026-08-31 — […]): the relink path
// must know a FAILED load from an EMPTY one — a 500 or a dropped connection is
// damage, not a chatless being. The browser views keep the resilient []
// posture above; these throw, and only the relink consumes them.
// impure
export const listSessionsStrict = async (neumaId) => {
  const headers = authHeaders();
  if (!neumaId || !headers) return [];
  try {
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/sessions`, { headers });
    return Array.isArray(body?.sessions) ? body.sessions : [];
  } catch (err) {
    if (!err?.http) throw err;
    throw new Error(`sessions list failed: HTTP ${err.http}`, { cause: err });
  }
};

// impure
export const loadSessionMessagesStrict = async (neumaId, sessionId, limit = 50) => {
  const headers = authHeaders();
  if (!neumaId || !sessionId || !headers) return [];
  try {
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/sessions/${sessionId}?view=display`, { headers });
    if (!Array.isArray(body?.messages)) return [];
    return toDisplayMessages(body.messages, limit, { neumaId, sessionId });
  } catch (err) {
    if (!err?.http) throw err;
    throw new Error(`session load failed: HTTP ${err.http}`, { cause: err });
  }
};

/**
 * Load one session's messages, display-stripped for the stream.
 * @param {string} neumaId
 * @param {string} sessionId
 * @param {number} [limit=50] keep only the tail this long
 * @returns {Promise<Array<{role: 'user'|'assistant', content: string}>>}
 */
// impure
export const loadSessionMessages = async (neumaId, sessionId, limit = 50) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !sessionId || !headers) return [];
    const body = await apiCall('GET', `/api/v1/workspace/${neumaId}/sessions/${sessionId}?view=display`, { headers });
    if (!Array.isArray(body?.messages)) return [];
    return toDisplayMessages(body.messages, limit, { neumaId, sessionId });
  } catch {
    return [];
  }
};

/**
 * Ask the conduit to name chats from what was said — one chat (sessionIds)
 * or the whole one-on-one shelf; `force` retitles even already-named chats.
 * Returns the per-chat results plus the updated label map (null labels when
 * the call itself failed, so the caller keeps its current names).
 * @param {string} neumaId
 * @param {Object} [opts]
 * @param {string[]} [opts.sessionIds] - explicit chats to name
 * @param {boolean} [opts.force=false] - retitle even already-named chats
 * @returns {Promise<{results: Array<{sessionId: string, status: string, label?: string}>, labels: Object|null}>}
 */
// impure
export const autotitleChats = async (neumaId, { sessionIds, force = false } = {}) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return { results: [], labels: null };
    const body = await apiCall('POST', `/api/v1/workspace/${neumaId}/sessions/autotitle`, {
      headers,
      body: { ...(sessionIds ? { sessionIds } : {}), force },
    });
    return {
      results: Array.isArray(body?.results) ? body.results : [],
      labels: body?.labels && typeof body.labels === 'object' ? body.labels : null,
    };
  } catch {
    return { results: [], labels: null };
  }
};
