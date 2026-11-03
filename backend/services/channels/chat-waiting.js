// The chat bridge's rows in WAITING ON YOU: each pairing code a stranger was
// given, waiting on the operator's yes or no (chat-access.js). The row lands
// in the platform's own window, on its CHATS tab, at the code.
// The rows are pure; the read is impure.

import { readChatAccess } from './chat-supervisor.js';
import { channelOfAccountId } from '../social/account-shape.js';
import { PAIR_TTL_MS } from './chat-access.js';

const NAME = Object.freeze({ telegram: 'Telegram', discord: 'Discord' });

/** One row per live code. pure. */
export const chatWaitingRows = (access, nowMs) => Object.entries(access).flatMap(([accountId, record]) => {
  const channel = channelOfAccountId(accountId);
  return (record?.pending ?? []).filter((p) => nowMs - Date.parse(p.at) < PAIR_TTL_MS).map((p) => Object.freeze({
    id: `chat-pairing:${accountId}:${p.code}`,
    kind: 'chat-pairing',
    title: `${p.kind === 'group' ? `The group "${p.name}"` : p.name} asks to talk with the house on ${NAME[channel] ?? channel} — code ${p.code}`.slice(0, 200),
    where: { app: channel, channelId: channel, section: 'chats', accountId, code: p.code },
    at: p.at,
  }));
});

/** The house's rows. impure. */
export const chatWaitingItems = async (wallet) => chatWaitingRows(await readChatAccess(wallet), Date.now());
