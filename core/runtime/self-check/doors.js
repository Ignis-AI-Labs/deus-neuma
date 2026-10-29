/**
 * THE SELF-CHECK — components the being has NO DOOR to.
 *
 * Design note, 2026-10-19: […] A part
 * of the being that exists on disk but that no tool in its catalog can read is
 * not a low score — it is a missing door, and the sheet names it as one.
 *
 * `tools` lists every tool name that WOULD open the component; the gap closes
 * by itself the day one of them lands in the being's catalog.
 *
 * Pure.
 */

// The doors opened 2026-10-19 (self-records-tools.js); a being whose catalog lacks
// them — an older build, a seat they are not offered on — still reads the gap.
// Keys match the self-check components they gate (items.js).
export const DOORLESS_CANDIDATES = Object.freeze([
  { key: 'journal', label: 'Journal', meaning: 'Its own journal of acts and moments.', tools: ['journal_read'] },
  { key: 'chats', label: 'Past chats', meaning: 'The list of its own past conversations.', tools: ['chats_list', 'chat_read'] },
  { key: 'charter', label: 'House charter', meaning: 'The charter its house runs under.', tools: ['charter_read'] },
].map(Object.freeze));

/**
 * The components no tool in this turn's catalog reaches. Pure.
 * @param {string[]} catalogNames - bare tool names the being was offered
 * @returns {Array<{key: string, label: string, meaning: string, tools: string[]}>}
 */
export const doorlessComponents = (catalogNames) => {
  const offered = new Set(catalogNames);
  return Object.freeze(DOORLESS_CANDIDATES.filter((c) => !c.tools.some((tool) => offered.has(tool))));
};
