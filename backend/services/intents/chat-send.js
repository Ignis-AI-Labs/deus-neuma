/**
 * chat/send — message another chat open in the house right now, by its exact
 * address (#597, the law in ../chat-link.js). house/post is the mailbox that
 * waits for a housemate's next sitting; this is the live line to a chat that
 * is open now, and that chat takes a turn on it at once, or when its current
 * turn ends.
 *
 * The tier is `allowed` by default, as house/post's is: word between the house's
 * own chats is never egress, and the operator sees both sides (the chip here,
 * the LINK line there). The standing rules are verified at validate time,
 * before anything moves: a chat of this house, open now, not this chat, and
 * neither side past its run of links without its operator.
 */
import {
  chatLinkDoors, addressOf, linkRunFull, LINK_RUN_LIMIT, MAX_LINK_BODY, MAX_LINK_RE,
} from '../chat-link.js';

const RUN_REST = `has taken ${LINK_RUN_LIMIT} linked messages in a row without its operator; the line rests until the operator speaks`;

export const chatSendIntent = Object.freeze({
  name: 'chat/send',
  policyTool: 'chat.send',
  fieldsForPrompt: '{to, body, re?}',
  descriptionForPrompt: `Message another chat open in your house right now: to is its exact address from open_chats ("<lane>:<session>"). It reaches that chat at once (or when its current turn ends), framed as from you, and that chat may answer back to yours with chat/send. Your operator sees both sides. Under ${MAX_LINK_BODY} chars; re (optional) names the thread.`,

  availableFor: ({ connection }) => (chatLinkDoors()?.canLink(connection) ? {} : null),

  validate: async (payload, { connection }) => {
    const doors = chatLinkDoors();
    if (!doors?.canLink(connection)) {
      return { ok: false, status: 'denied', reason: 'chat links run between chats open on the desk, and this sitting is not one' };
    }
    const to = String(payload?.to ?? '').trim();
    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    if (!to || !body) {
      return { ok: false, status: 'invalid', reason: 'a chat link needs {to, body}: the chat\'s address from open_chats and your words' };
    }
    if (body.length > MAX_LINK_BODY) {
      return { ok: false, status: 'invalid', reason: `a chat link carries at most ${MAX_LINK_BODY} chars (this one is ${body.length}); send the gist, or put the long part in a file and name it` };
    }
    if (to === addressOf(connection)) {
      return { ok: false, status: 'invalid', reason: `"${to}" is this chat` };
    }
    const target = doors.find(connection, to);
    if (!target) {
      return { ok: false, status: 'denied', reason: `no chat is open at "${to}" in your house; open_chats lists the open ones` };
    }
    if (linkRunFull(connection)) return { ok: false, status: 'denied', reason: `held: this chat ${RUN_REST} here` };
    if (linkRunFull(target)) return { ok: false, status: 'denied', reason: `held: the chat at "${to}" ${RUN_REST} there` };
    const re = typeof payload?.re === 'string' && payload.re.trim() ? payload.re.trim().slice(0, MAX_LINK_RE) : undefined;
    return { ok: true, value: { to, body, re } };
  },

  summarize: (payload) => {
    const re = typeof payload?.re === 'string' && payload.re.trim() ? ` — "${payload.re.trim().slice(0, 80)}"` : '';
    return `chat link → ${payload?.to ?? '?'}${re}`;
  },

  execute: async ({ to, body, re }, { connection }) => {
    const sent = await chatLinkDoors()?.send(connection, to, { body, re });
    if (!sent) return { ok: false, reason: `the chat at "${to}" closed before it could be reached` };
    return {
      ok: true,
      detail: sent.busy
        ? `Sent to ${sent.name} (${to}). That chat is mid-turn; your message reaches it when the turn ends. An answer, if it sends one, arrives here as a CHAT LINK.`
        : `Delivered to ${sent.name} (${to}), who is reading it now. An answer, if it sends one, arrives here as a CHAT LINK.`,
    };
  },
});
