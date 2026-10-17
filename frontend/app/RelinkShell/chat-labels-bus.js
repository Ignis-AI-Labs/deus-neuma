// chat-labels-bus — one window event for […].
//
// Renames and autotitles land in ChatsApp (and return the fresh label map);
// the stream's title line and CHATS rail must follow without a refetch or a
// reload. The event carries the whole updated map, so listeners never hold a
// name the store has already replaced.

export const CHAT_LABELS_EVENT = 'neuma:chat-labels';

/** impure — announce the updated label map to every listening surface. */
export const announceChatLabels = (labels) => {
  if (!labels || typeof labels !== 'object') return;
  window.dispatchEvent(new CustomEvent(CHAT_LABELS_EVENT, { detail: { labels } }));
};
