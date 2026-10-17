// permissions-revoke — taking a standing grant back.
//
// Design note, 2026-08-30, looking at the PERMISSIONS panel: […]
//
// WHY THIS IS ITS OWN FILE. `permissions-ledger.js` reads grants back out; this
// one takes them away. The read route says in its own header that […] — keeping the
// two transformations in separate modules is that sentence held in the file
// layout, not just in a comment.
//
// PURE. A descriptor and the current stores go in; new stores come out. Nothing
// here touches disk, so the route owns the read-modify-write and this owns the
// decision — which is the half worth testing exhaustively.
//
// REVOKE NAMES EXACTLY ONE ROW. Every remover underneath matches literally, and
// that is the whole safety argument: the operator can only take back a row the
// panel showed them, and the rows are the literal strings on disk. Anything
// cleverer — revoking a parent folder and sweeping its children, or expanding a
// sensitive-grant pattern — would withdraw grants they never named, in a
// surface whose entire purpose is knowing exactly what is granted.

import {
  removeAllowedTool, removeGrantedReadRoot, removeGrantedWriteRoot,
} from './tool-policy.js';
import { removeSensitiveGrant } from './sensitive-grants.js';
import { GRANT_KINDS } from './permissions-ledger.js';

/** Folder and file grants each carry an access tier, and only these. */
const FOLDER_ACCESS = Object.freeze(['read', 'write']);
const FILE_ACCESS = Object.freeze(['read', 'edit']);

/**
 * Is this descriptor a grant we could actually take back? Pure.
 *
 * Refusals name the field, because this is reached from a UI click and a
 * refusal that just says "invalid" leaves nobody anywhere to look.
 *
 * @param {Object} d
 * @returns {string|null} the refusal, or null when the descriptor is sound
 */
export const revokeRefusal = (d) => {
  const kind = d?.kind;
  if (!GRANT_KINDS.includes(kind)) {
    return `"${kind}" is not a kind of grant — it is one of: ${GRANT_KINDS.join(', ')}`;
  }
  if (kind === 'act') {
    if (!d.server || typeof d.server !== 'string') return 'an act revoke needs the server it belongs to';
    if (!d.tool || typeof d.tool !== 'string') return 'an act revoke needs the tool name';
    return null;
  }
  if (kind === 'folder' || kind === 'file') {
    const allowed = kind === 'folder' ? FOLDER_ACCESS : FILE_ACCESS;
    if (!allowed.includes(d.access)) {
      return `a ${kind} revoke needs access to be one of: ${allowed.join(', ')}`;
    }
    if (typeof d.path !== 'string' || !d.path.trim()) return `a ${kind} revoke needs the path`;
    return null;
  }
  // spend
  if (typeof d.address !== 'string' || !d.address.trim()) return 'a spend revoke needs the recipient address';
  return null;
};

/**
 * Remove one recipient from a spend allowlist. Pure.
 *
 * Addresses are compared CASE-INSENSITIVELY: the same account is written
 * checksummed in one place and lowercase in another, and an operator who
 * pressed revoke on a row must not be told it worked while the entry stands
 * under different capitalisation.
 */
const removeSpendRecipient = (allowlist, address) => {
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : [];
  const wanted = address.trim().toLowerCase();
  const kept = entries.filter((e) => String(e?.address || e?.to || '').toLowerCase() !== wanted);
  return { ...(allowlist || {}), entries: kept };
};

/** Did this descriptor name something that was actually there? Pure. */
const wasHeld = (d, { policy, allowlist }) => {
  if (d.kind === 'act' && d.server === 'coding' && d.tool === 'shell_network') return policy?.shellNetwork === true;
  if (d.kind === 'act') return Boolean(policy?.[d.server]?.allowed?.includes(d.tool));
  if (d.kind === 'folder') return Boolean(policy?.pathGrants?.[d.access]?.includes(d.path));
  if (d.kind === 'file') return Boolean(policy?.sensitiveGrants?.[d.access]?.includes(d.path));
  const wanted = String(d.address || '').trim().toLowerCase();
  return (allowlist?.entries || []).some((e) => String(e?.address || e?.to || '').toLowerCase() === wanted);
};

/**
 * Take one standing grant back. Pure.
 *
 * `held` reports whether the grant was actually there. A revoke of something
 * already gone is NOT an error — the operator's intent ([…]) holds either way, and two operators pressing the same row should
 * not produce a failure. But the caller still gets to know, because writing an
 * unchanged file back to a lane is noise, and the reply can say "already gone"
 * instead of claiming an act that did not happen.
 *
 * @param {Object} descriptor - one row from the permissions panel
 * @param {{policy: Object|null, allowlist: Object|null}} stores
 * @returns {{ok: boolean, error?: string, held?: boolean,
 *            policy?: Object|null, allowlist?: Object|null, store?: string}}
 */
export const revokeGrant = (descriptor, { policy = null, allowlist = null } = {}) => {
  const refusal = revokeRefusal(descriptor);
  if (refusal) return { ok: false, error: refusal };

  const d = descriptor;
  const held = wasHeld(d, { policy, allowlist });
  if (!held) return { ok: true, held: false, policy, allowlist, store: null };

  if (d.kind === 'spend') {
    return {
      ok: true, held: true, store: 'allowlist', policy,
      allowlist: removeSpendRecipient(allowlist, d.address),
    };
  }
  let next;
  if (d.kind === 'act' && d.server === 'coding' && d.tool === 'shell_network') next = { ...policy, shellNetwork: false };
  else if (d.kind === 'act') next = removeAllowedTool(policy, d.server, d.tool);
  else if (d.kind === 'folder') {
    next = d.access === 'write'
      ? removeGrantedWriteRoot(policy, d.path)
      : removeGrantedReadRoot(policy, d.path);
  } else next = removeSensitiveGrant(policy, d.access, d.path);
  return { ok: true, held: true, store: 'policy', policy: next, allowlist };
};
