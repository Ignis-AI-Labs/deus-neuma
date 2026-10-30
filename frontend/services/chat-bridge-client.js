// chat-bridge-client.js — the operator's door onto who may talk with the house
// on Telegram and Discord (the CHATS tab, WAITING ON YOU's pairing rows).
// impure — the local backend with the session token; every failure throws the route's reason.

import { authedCall } from './authed-call.js';

const call = authedCall('/api/v1/chat-bridge');

/** Each chat account of the house: running, who is allowed, the codes waiting. impure. */
export const getChatBridge = () => call('GET', '/status', { errorPrefix: 'Could not read the chats' });

/** The operator's yes or no to a pairing code. impure. */
export const answerChatCode = (accountId, code, approve) => call('POST', `/${encodeURIComponent(accountId)}/codes/${encodeURIComponent(code)}`, { body: { approve }, errorPrefix: 'Could not answer the code' });

/** Take a person or a group off the list. impure. */
export const revokeChat = (accountId, kind, id) => call('DELETE', `/${encodeURIComponent(accountId)}/allowed/${kind}/${encodeURIComponent(id)}`, { errorPrefix: 'Could not take it back' });
