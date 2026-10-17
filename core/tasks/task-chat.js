/**
 * Task chat scope — which conversation a piece of work belongs to.
 *
 * A being can hold several chats at once, and each is often its own parallel
 * workflow (Design note, 2026-08-01: […]). A task therefore
 * records the chat it was taken on in, and the prompt shows the being only the
 * work belonging to the chat in front of it.
 *
 * A task with NO chat is LANE-WIDE: standing work that belongs to the being
 * rather than to any one conversation, and rides every chat. That is also what
 * every task written before this existed reads as — absence is the honest
 * default, so nothing already recorded is lost or misfiled.
 *
 * The law lives here once because both lists obey it: the being's own ledger
 * (core/tasks/task-ledger.js) and the operator-assigned plan
 * (core/tasks/assigned-plan.js). Pure module.
 */

/** A chat id is a session id (`session-<ms>`) — the same token the workspace
 *  names session files with, so the bound is the filename's bound. */
export const CHAT_ID_MAX_CHARS = 64;

/** The character class NeumaWorkspace already enforces on session ids. A chat
 *  id reaches the store as part of a task record, never as a path segment —
 *  but it is validated to the same shape so a malformed id can never be
 *  written and then fail to match anything for the rest of its life. */
const CHAT_ID_RE = /^[A-Za-z0-9_-]+$/;

// Validation corrections are thrown tagged, so the impure layer can tell […] (400, safe to surface) from a real failure.
const _correction = (msg) => Object.assign(new Error(msg), { correction: true });

/**
 * Is this a well-formed chat id? The single source of truth for the shape,
 * so the throwing and non-throwing readers can never drift apart. Pure.
 * @param {*} value
 * @returns {boolean}
 */
export const isChatId = (value) => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length > 0 && text.length <= CHAT_ID_MAX_CHARS && CHAT_ID_RE.test(text);
};

/**
 * Normalize an AUTHORED chat id — one a caller chose and sent us, so a
 * malformed value is their mistake and they should hear about it. Absent,
 * null, and empty all mean LANE-WIDE and normalize to `null`. Throws the
 * correction otherwise. Pure.
 * @param {*} chatId
 * @returns {string|null} the trimmed id, or null for lane-wide
 */
export const normalizeChatId = (chatId) => {
  if (chatId === undefined || chatId === null) return null;
  if (typeof chatId !== 'string') {
    throw _correction('a chat id must be the chat\'s session id, as text.');
  }
  const text = chatId.trim();
  if (!text) return null;
  if (text.length > CHAT_ID_MAX_CHARS) {
    throw _correction(`a chat id must stay under ${CHAT_ID_MAX_CHARS} characters.`);
  }
  if (!CHAT_ID_RE.test(text)) {
    throw _correction('a chat id may hold only letters, digits, dashes, and underscores.');
  }
  return text;
};

/**
 * Read a chat id the SYSTEM supplied — a live session binding, not something
 * anyone authored. Anything malformed reads as no chat at all rather than
 * throwing.
 *
 * This matters because `connection.sessionId` is set from a client-supplied
 * `portal:resume` frame without a shape check (backend/routes/portal-routes.js).
 * A being must never be told its own task tool is malformed, or be unable to
 * record work at all, because the session it was bound to arrived crooked. It
 * files the work lane-wide instead — visible in every chat, which loses
 * organization but never loses the work.
 *
 * Pure.
 * @param {*} value
 * @returns {string|null}
 */
export const safeChatId = (value) => (isChatId(value) ? value.trim() : null);

/**
 * The chat a task belongs to, read defensively: anything that is not a
 * non-empty string reads as lane-wide. Pure.
 * @param {{chatId?: *}} task
 * @returns {string|null}
 */
export const chatOf = (task) =>
  (typeof task?.chatId === 'string' && task.chatId ? task.chatId : null);

/**
 * Does this task belong to no single chat — so it stands in every one? The one
 * place that question is answered, because every reader of it must agree: a
 * surface that classified lane-wide work differently from another would show
 * the operator a different list than the being is given, from one store.
 * Pure.
 * @param {{chatId?: *}} task
 * @returns {boolean}
 */
export const isLaneWide = (task) => chatOf(task) === null;

/**
 * Split tasks by their standing relative to ONE chat.
 *
 * `here` — taken on in this chat. `laneWide` — belongs to no chat, so it
 * stands in every one. Work belonging to a DIFFERENT chat appears in neither:
 * that is the whole point, and it is why the caller must decide what to do
 * when there is no chat to be in (see the formatters, which fall back to
 * showing everything rather than hiding work).
 *
 * Pure; input order is preserved within each bucket.
 * @param {Array<object>|null} tasks
 * @param {string|null} chatId the chat being scoped to
 * @returns {{here: Array<object>, laneWide: Array<object>}}
 */
export const splitByChat = (tasks, chatId) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const chat = typeof chatId === 'string' && chatId.trim() ? chatId.trim() : null;
  const here = [];
  const laneWide = [];
  for (const task of list) {
    const owner = chatOf(task);
    if (owner === null) laneWide.push(task);
    else if (owner === chat) here.push(task);
  }
  return { here, laneWide };
};
