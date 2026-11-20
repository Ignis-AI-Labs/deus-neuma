// The secret screen every download leaves by (PR600 audit P6-04, NEW-H3 reopened).
// web_fetch and web_search were screened at their door (web-being-tools.js); a file
// download and an image save are the same egress and carried any address unread, so
// a turned being could spell a key into the path of an attacker's URL. This is the one
// judgment both the intents (before any card) and their fetch loops (every hop) ask.

import { checkOutboundSecrets } from './security/outbound-secrets.js';

/**
 * May a download request this address? The address the being named is read for
 * every secret shape and this machine's live values. A redirect is the server's
 * choice and carries the server's own signed tokens, so it is read for this
 * machine's live values only. impure (the door reads the backend's environment).
 * @param {string} act what is being fetched, in words ('the download address')
 * @param {string} url the address about to be requested
 * @param {{redirect?: boolean}} [hop] true when a server sent us to this address
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export const screenWebEgress = (act, url, { redirect = false } = {}) =>
  checkOutboundSecrets(act, [url], 'nothing was fetched', redirect ? { liveOnly: true } : {});
