// stream-window-label.js — what a stream window is called in the taskbar's list.
//
// Design note, 2026-10-23: hovering the STREAM button shows the open streams, and he
// picks one by what it holds — […]. A stream window holds
// a strip of sittings (stream-strips.js); the one on screen is its focused tab,
// so that tab names the window: the being it seats, then the chat it is in —
// the operator's own name for it, its start when unnamed (the short form the
// CHATS rail uses), NEW CHAT before a session is minted.
// Ledger: docs/work/dock-stream-cycle.md.
//
// Pure — the strip and the label map come in, two strings go out.

import { chatTitleOf, shortWhen } from './stream-chats-view.js';

/**
 * @param {{name?: string, neumaId?: string, sessionId?: string}|null} tab the window's focused tab
 * @param {Object} labels {"<neumaId>:<sessionId>": "name"} — the operator's chat names
 * @param {string} newChat the words for a sitting with no chat yet
 * @returns {{being: string, chat: string}|null} null when the window has no strip yet
 */
export const streamWindowText = (tab, labels, newChat) => {
  if (!tab || !(tab.name || tab.neumaId)) return null;
  const being = String(tab.name || tab.neumaId).toUpperCase();
  const title = chatTitleOf(labels, tab.neumaId || null, tab.sessionId || null);
  if (!title) return { being, chat: newChat };
  return { being, chat: title.named ? title.title : shortWhen(tab.sessionId) };
};

/**
 * The focused tab of a published strip, or null. Pure.
 * @param {{focusedId?: string|null, tabs?: Array<{id: string}>}|null} strip
 */
export const focusedTabOf = (strip) => {
  const tabs = Array.isArray(strip?.tabs) ? strip.tabs : [];
  return tabs.find((t) => t?.id === strip?.focusedId) || tabs[0] || null;
};
