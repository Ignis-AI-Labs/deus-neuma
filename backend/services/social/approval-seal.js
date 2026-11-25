// approval-seal — what an approval is bound to (audit P6-124).
//
// A yes on a card is a yes to the WORDS and the IMAGE BYTES on that card, and
// to nothing else. Two laws live here:
//
//   · THE SEEN LAW: an approval names the copy it read (`textSeen`) and the
//     seals of the media it showed (`mediaSeen`); the store approves only when
//     both still match the entry, inside its own atom. A being that rewrote
//     its draft while the card sat open is refused, never published unseen.
//   · THE MEDIA SEAL: every attached file's SHA-256 is recorded on the entry
//     the first time the store saves it, the operator's preview shows only
//     bytes that still match, and the send refuses any file whose bytes moved.
//     reverifyMediaFile alone proved the PATH was unchanged; overwriting the
//     file in place walked straight through it.
//
// A file that could not be read when it was staged stays unsealed, and an
// unsealed file is never sent.

import crypto from 'crypto';
import { createReadStream } from 'fs';
import { reverifyMediaFile } from './media-source.js';
import { queuedSecretRefusal } from './queue-rules.js';
import { tiktokApproveRefusal } from './tiktok-metadata.js';

// The standings whose media may still be shown or sent.
const LIVE = Object.freeze(['draft', 'approved', 'sending']);

/**
 * The SHA-256 of one file, streamed (a video is never read whole). impure.
 * @param {string} file
 * @returns {Promise<string>} hex
 */
export const fileSha256 = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  createReadStream(file)
    .on('error', reject)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolve(hash.digest('hex')));
});

/**
 * Seal, in place, every live entry's media that carries no seal yet. A file
 * that cannot be read stays unsealed (the send refuses it). impure.
 * @param {Array<object>} entries - the queue about to be saved
 */
export const sealQueueMedia = async (entries) => {
  for (const entry of entries) {
    if (!LIVE.includes(entry?.status) || !Array.isArray(entry.media)) continue;
    for (const item of entry.media) {
      if (item?.sha256 || typeof item?.path !== 'string') continue;
      const sha256 = await fileSha256(item.path).catch(() => null);
      if (sha256) item.sha256 = sha256;
    }
  }
};

/** The seals a card shows, in order — what its approval sends back. Pure. */
export const mediaSealsOf = (entry) => (Array.isArray(entry?.media) ? entry.media.map((m) => m?.sha256 || null) : []);

/**
 * Re-check one staged file: the same real path, and the same bytes.
 * `requireSeal` (the send) refuses a file that was never sealed; the preview
 * of an entry staged before seals existed passes on its path alone. impure.
 * @param {{path: string, sha256?: string}} item
 * @param {{requireSeal?: boolean}} [opts]
 * @returns {Promise<{ok: true, path: string}|{ok: false, detail: string}>}
 */
export const verifySealedMedia = async (item, { requireSeal = true } = {}) => {
  const verified = await reverifyMediaFile(item?.path);
  if (!verified.ok) return verified;
  if (!item.sha256) {
    return requireSeal ? { ok: false, detail: `${item.path} was never sealed — attach it to the post again` } : verified;
  }
  const now = await fileSha256(verified.path).catch(() => null);
  return now === item.sha256 ? verified
    : { ok: false, detail: `${item.path} changed after it was staged — it is not the file that was shown. Attach it to the post again for a fresh decision` };
};

/**
 * Does the approval still describe this entry? Checked only when the
 * approval names what it read (`textSeen`); the operator's door always does.
 * Pure.
 * @param {object} entry
 * @param {{textSeen?: string, mediaSeen?: Array<?string>}} seen
 * @returns {?string} the refusal, or null
 */
export const seenRefusal = (entry, { textSeen, mediaSeen } = {}) => {
  if (textSeen === undefined) return null;
  if (textSeen !== entry.text) return 'the copy moved since it was read — read the post again and decide again';
  const seals = mediaSealsOf(entry);
  if (!seals.length) return null;
  return Array.isArray(mediaSeen) && JSON.stringify(mediaSeen) === JSON.stringify(seals)
    ? null : 'the media moved since it was seen — look at the post again and decide again';
};

/**
 * Why a draft cannot be approved onto the schedule, or null. Pure.
 * @param {object} entry
 * @param {{tiktokConsent?: ?object, textSeen?: string, mediaSeen?: Array<?string>}} decision
 * @returns {?string}
 */
export const approveRefusal = (entry, { tiktokConsent, textSeen, mediaSeen } = {}) => {
  const secret = queuedSecretRefusal(entry, 'nothing was approved');
  if (secret) return secret;
  // A reply is sent BY approval, never armed by it (ruling, 2026-08-06).
  // Arming one here would strand it: the scheduler refuses the kind, so
  // an approved reply is a promise the system can no longer keep.
  if (entry.kind === 'reply') {
    return 'a reply goes out the moment it is approved — decide it through the reply approval (approve-and-send), not the schedule lane';
  }
  return tiktokApproveRefusal(entry, { consent: tiktokConsent, textSeen }) || seenRefusal(entry, { textSeen, mediaSeen });
};
