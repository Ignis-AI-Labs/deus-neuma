/**
 * open_chats — the house's open chats as an address book (#597, the law in
 * ../chat-link.js): each chat's exact address for chat/send, the being in it,
 * its title as the desk's tab names it, and whether it is mid-turn. Never
 * another house's chats, never a chat's contents.
 *
 * Advertised to every chat open on the desk (the same turn after turn, so the
 * tool list stays stable); it rides the house word family's dispatch line
 * beside post_check (crew-desk-tools.js): the mailbox and the live line are
 * the two ways housemates reach each other. Leaf module.
 */
import { gateAct } from '../act-gate.js';
import { chatLinkDoors } from '../chat-link.js';
import { sendToolEvent } from './tool-events.js';

const OPEN_CHATS_TOOL = Object.freeze({
  name: 'open_chats',
  server: 'house',
  description: 'List the chats open in your house right now, no args. Each line is one chat: its exact address (the to for chat/send), the being in it, its title, and whether it is mid-turn. This chat is not listed; your other open chats are.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

/** Does this parsed call target open_chats? (both dialects) */
export const isOpenChatsTool = (match) =>
  match.toolName === 'open_chats' || match.tool === 'house/open_chats';

/** The tool, for a chat open on the desk; nothing for any other sitting. */
export const openChatsToolsFor = (connection) => (chatLinkDoors()?.canLink(connection) ? [OPEN_CHATS_TOOL] : []);

// pure — one chat as the being reads it
const chatLine = (row) => `- ${row.chat}: ${row.name}${row.title ? `, "${row.title}"` : ''}, ${row.busy ? 'mid-turn' : 'idle'}`;

/** impure — the same gate every governed read passes, then the live address book. */
export const handleOpenChats = async (ws, connection, neumaPolicy, toolMode) => {
  const tool = 'house/open_chats';
  const { companion } = connection;
  const gate = await gateAct(connection, {
    server: 'house', tool: 'open_chats',
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const doors = chatLinkDoors();
  if (!doors?.canLink(connection)) {
    const error = 'open chats are listed only to a chat open on the desk';
    sendToolEvent(ws, companion, { tool, status: 'error', summary: 'open_chats: not an open chat', detail: error });
    return { tool, status: 'error', error };
  }
  const rows = await doors.openChats(connection);
  sendToolEvent(ws, companion, { tool, status: 'ok', summary: `open chats: ${rows.length}` });
  if (!rows.length) return { tool, status: 'ok', content: 'No other chat is open in your house right now.' };
  return {
    tool,
    status: 'ok',
    content: [`${rows.length} other chat(s) open in your house (address: being, title, state). Message one with chat/send.`, ...rows.map(chatLine)].join('\n'),
  };
};
