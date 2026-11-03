// The CHATS tab's words (ChatsSection.jsx). PURE.

/** Whether the bot hears at all, in one line. pure. */
export const chatLineWords = (on, accounts) => {
  if (!on) return 'THE BOT HEARS NOBODY — TURN ON "CHATS WITH THE HOUSE" IN SETTINGS → SECURITY → CONNECTIONS';
  const live = accounts.filter((a) => a.running);
  if (!accounts.length) return 'ON — NO BOT OF THIS HOUSE HERE HAS A HOLDER AND ITS KEYS YET';
  return live.length ? `ON — HEARING ${live.length === 1 ? 'THE BOT' : `${live.length} BOTS`}` : 'ON — THE BOT IS NOT HEARING YET';
};

/** A person or a group, said. pure. */
export const whoWords = (w) => (w.kind === 'group' ? `THE GROUP ${String(w.name).toUpperCase()}` : String(w.name).toUpperCase());

/** How long a code has waited. pure. */
export const codeAge = (at, nowMs) => {
  const min = Math.max(0, Math.round((nowMs - Date.parse(at)) / 60000));
  return min < 1 ? 'JUST NOW' : `${min} MIN AGO`;
};
