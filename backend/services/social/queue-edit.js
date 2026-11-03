// Queue edit (#208) — the pure decisions behind editing a staged post.
//
// Split out of post-queue.js on 2026-08-26 (size-law breakdown). The store's
// update() applies exactly what previewUpdate returns, under its own mutate
// gate; every symbol is re-exported from post-queue.js so existing readers'
// import paths still stand. Direction law: this module never imports
// post-queue.js.
//
// An edit is an EVENT on the governance record, never a rewrite of it: every
// update stamps its actor and time, and appends the PREVIOUS values of the
// fields it changed to a bounded revision trail — the record shows what the
// copy WAS, not just what it became. Cancel-and-restage would lose the id and
// pollute the record with a fresh entry; update keeps both honest.

import { markedMedia } from './disclosure-line.js';
import { validateDraft } from './queue-rules.js';

export const QUEUE_PATCH_FIELDS = Object.freeze(['text', 'scheduledFor', 'campaignId', 'pillar', 'media']);
export const REVISIONS_MAX = 20;

// The standings an edit may touch: what is still DECIDABLE. Sending is locked
// (the publisher owns it), settled is history — both refuse honestly.
export const EDITABLE_STANDINGS = Object.freeze(['draft', 'approved']);

/**
 * Whitelist and normalize an edit patch (pure). Only QUEUE_PATCH_FIELDS
 * survive — an unknown key is dropped, never persisted — and each value is
 * normalized to the shape add() would have stored, so the change comparison
 * never reports a difference that is only formatting. Values that break the
 * draft law are kept as-is so validateDraft can refuse them with its own
 * honest reason instead of a generic one.
 * @param {object} raw
 */
export const normalizePatch = (raw = {}) => {
  if (!raw || typeof raw !== 'object') return {};
  const patch = {};
  for (const field of QUEUE_PATCH_FIELDS) {
    if (raw[field] === undefined) continue;
    const v = raw[field];
    if (field === 'text') patch.text = typeof v === 'string' ? v.trim() : v;
    else if (field === 'scheduledFor') patch.scheduledFor = (typeof v === 'string' && v.trim()) ? v.trim() : null;
    else if (field === 'campaignId') patch.campaignId = typeof v === 'string' ? (v.trim() || null) : v;
    else if (field === 'pillar') patch.pillar = typeof v === 'string' ? v.trim() : v;
    else if (field === 'media') {
      // Whitelisted field-by-field — the same idiom as add(), so a patch
      // cannot smuggle extra keys onto a governance record either.
      patch.media = Array.isArray(v)
        ? v.map((m) => ({ path: m?.path, alt: String(m?.alt || '').slice(0, 1000) }))
        : v;
    }
  }
  return patch;
};

const mediaEqual = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

/**
 * The decision behind every edit (pure): what would change, what each field
 * WAS, and whether the change renews the operator's decision. The store
 * applies exactly what this returns and the being-tools preview the same
 * object on the operator's chip — one source for the approval law.
 *
 * THE LAW (decided in #208, deliberately not configurable): new words or new
 * images on an APPROVED post reset it to draft — the operator approved
 * different copy, so the decision renews. A schedule-only change preserves
 * the approval: the words didn't move, only the slot. campaignId/pillar are
 * bookkeeping, not the approved words, so they never reset.
 *
 * @param {object|null|undefined} entry the queued entry as stored
 * @param {object} rawPatch the requested changes
 * @returns {{ok: true, patch: object, changed: object, resetsApproval: boolean}
 *   | {ok: false, error: string}} `changed` maps field → its PREVIOUS value
 */
export const previewUpdate = (entry, rawPatch = {}) => {
  if (!entry) return { ok: false, error: 'no such queued post' };
  if (!EDITABLE_STANDINGS.includes(entry.status)) {
    return { ok: false, error: `cannot act on a ${entry.status} post` };
  }
  const patch = normalizePatch(rawPatch);
  if (!Object.keys(patch).length) {
    return { ok: false, error: `the patch carries no editable field (${QUEUE_PATCH_FIELDS.join(', ')})` };
  }
  // New words are kept exactly as written: the AI disclosure rides in the post's
  // metadata (disclosure-line.js) — new images take the AI marker in their alt text.
  if ('media' in patch) patch.media = markedMedia({ ...entry, ...patch });
  const changed = {};
  for (const [field, value] of Object.entries(patch)) {
    const previous = field === 'media' ? (entry.media || []) : (entry[field] ?? (field === 'pillar' ? '' : null));
    const differs = field === 'media' ? !mediaEqual(value, previous) : value !== previous;
    if (differs) changed[field] = previous;
  }
  if (!Object.keys(changed).length) return { ok: false, error: 'the patch changes nothing' };
  // The merged entry must pass the same law as a freshly staged one — a patch
  // is never a way around validateDraft.
  const invalid = validateDraft({ ...entry, ...patch });
  if (invalid) return { ok: false, error: invalid };
  const resetsApproval = entry.status === 'approved' && ('text' in changed || 'media' in changed);
  return { ok: true, patch, changed, resetsApproval };
};

/**
 * Append one revision to the trail, keeping the last REVISIONS_MAX (pure).
 * Bounded because the trail rides inside the entry — the record must stay
 * honest AND small.
 * @param {Array<object>|undefined} revisions
 * @param {{at: string, by: string, changed: object}} rev
 */
export const appendRevision = (revisions, rev) =>
  [...(Array.isArray(revisions) ? revisions : []), rev].slice(-REVISIONS_MAX);
