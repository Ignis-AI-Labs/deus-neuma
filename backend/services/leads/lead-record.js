// A PERSON'S RECORD, THE OPERATOR'S OWN WAY — tags, the house's own fields, a note that stays on top, and two leads
// that are one person merged into one (docs/work/crm-match-blob.md slice 2, 2026-11-23; Blob: "labels and tagging",
// […], […]). Every change is one touch on the lead's history (lead-ledger.js), so who set what, and when, is kept.
// The fields themselves are the house's (crm-fields.js); a value is judged by its field. PURE.

export const TAG_MAX = 20;
export const TAG_CHARS = 40;
export const ABOUT_MAX = 2000;
export const FIELD_TYPES = Object.freeze(['text', 'number', 'date', 'choice']);
export const FIELDS_MAX = 50;
const VALUE_MAX = 500;
const FIELD_ID = /^[a-z][a-z0-9-]{0,39}$/;

/** Tags as kept: trimmed, one line, no commas, the first spelling of each kept, at most TAG_MAX. */
export const cleanTags = (list) => {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list ?? '').split(',')) {
    const tag = String(raw ?? '').replace(/[\s,]+/g, ' ').trim().slice(0, TAG_CHARS);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, TAG_MAX);
};

/** What is wrong with the house's field list, named; [] when it stands. */
export const fieldsRefusals = (defs) => {
  if (!Array.isArray(defs)) return ['the fields are a list'];
  if (defs.length > FIELDS_MAX) return [`at most ${FIELDS_MAX} fields`];
  const out = [];
  const ids = new Set();
  for (const [i, d] of defs.entries()) {
    const at = `field ${i + 1}`;
    if (!FIELD_ID.test(String(d?.id ?? ''))) out.push(`${at}: its id is lowercase letters, digits and dashes, starting with a letter`);
    else if (ids.has(d.id)) out.push(`${at}: "${d.id}" is named twice`);
    else ids.add(d.id);
    if (typeof d?.label !== 'string' || !d.label.trim() || d.label.length > 60) out.push(`${at}: a label of at most 60 characters`);
    if (!FIELD_TYPES.includes(d?.type)) out.push(`${at}: its type is one of ${FIELD_TYPES.join(', ')}`);
    if (d?.type === 'choice' && (!Array.isArray(d.choices) || !d.choices.length || d.choices.length > 30 || d.choices.some((c) => typeof c !== 'string' || !c.trim() || c.length > 60))) out.push(`${at}: a choice field lists 1 to 30 choices`);
  }
  return out;
};

/** The house's fields as kept. Call after fieldsRefusals found nothing. */
export const cleanFields = (defs) => defs.map((d) => ({ id: d.id, label: d.label.trim(), type: d.type, ...(d.type === 'choice' ? { choices: d.choices.map((c) => c.trim()) } : {}) }));

/**
 * One value for one field: {ok, value} (null clears it) or {ok: false, why}.
 * @param {{id: string, label: string, type: string, choices?: string[]}} def
 */
export const fieldValue = (def, value) => {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (def.type === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, why: `${def.label} is a number` };
  }
  if (def.type === 'date') {
    const d = String(value).trim();
    // A real day: 2027-02-30 reads back as March, so it is refused.
    const real = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    return real ? { ok: true, value: d } : { ok: false, why: `${def.label} is a date, YYYY-MM-DD` };
  }
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, VALUE_MAX);
  if (def.type === 'choice') return def.choices.includes(text) ? { ok: true, value: text } : { ok: false, why: `${def.label} is one of: ${def.choices.join(', ')}` };
  return { ok: true, value: text || null };
};

/**
 * What a record change sets on a lead, and the touch that says so — or why it cannot. Only what is named changes:
 * tags replace the tags; fields set or clear the fields named (a field the house does not have is refused); about
 * replaces the note.
 * @param {object} lead
 * @param {{tags?: unknown, fields?: Record<string, unknown>, about?: unknown}} change
 * @param {Array<object>} defs - the house's fields
 * @returns {{ok: true, set: object, touch: object} | {ok: false, why: string}}
 */
export const recordChange = (lead, change, defs) => {
  const set = {};
  const touch = {};
  if (change.tags !== undefined) {
    const tags = cleanTags(change.tags);
    const before = lead.tags ?? [];
    if (tags.join('\n') !== before.join('\n')) { set.tags = tags; touch.tags = tags; }
  }
  if (change.fields !== undefined) {
    if (!change.fields || typeof change.fields !== 'object' || Array.isArray(change.fields)) return { ok: false, why: 'fields are {fieldId: value}' };
    const next = { ...(lead.fields ?? {}) };
    const moved = {};
    for (const [id, raw] of Object.entries(change.fields)) {
      const def = defs.find((d) => d.id === id);
      if (!def) return { ok: false, why: `"${id}" is not one of the house's fields` };
      const judged = fieldValue(def, raw);
      if (!judged.ok) return { ok: false, why: judged.why };
      if ((next[id] ?? null) === judged.value) continue;
      if (judged.value === null) delete next[id]; else next[id] = judged.value;
      moved[id] = judged.value;
    }
    if (Object.keys(moved).length) { set.fields = next; touch.fields = moved; }
  }
  if (change.about !== undefined) {
    const about = String(change.about ?? '').trim().slice(0, ABOUT_MAX);
    if (about !== (lead.about ?? '')) { set.about = about; touch.about = about; }
  }
  return { ok: true, set, touch };
};

/**
 * Two leads that are one person, as one: the one kept keeps its id, status, kind and owner; the other's history
 * joins its own in time order (each touch marked where it came from); tags are joined; a field the kept one lacks
 * is filled from the other; their notes are joined; a different address the other had is kept as a former contact.
 * @param {object} keep @param {object} drop
 * @param {{by: string, at: string}} who
 */
export const mergeLeads = (keep, drop, { by, at }) => {
  const fields = { ...(drop.fields ?? {}), ...(keep.fields ?? {}) };
  const about = [keep.about, drop.about].filter((a) => a && a.trim()).join('\n\n').slice(0, ABOUT_MAX);
  const touches = [...(keep.touches ?? []), ...(drop.touches ?? []).map((t) => ({ ...t, mergedFrom: drop.id }))]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const otherAddress = drop.contact && drop.contact.toLowerCase() !== String(keep.contact ?? '').toLowerCase() ? drop.contact : null;
  return {
    ...keep,
    tags: cleanTags([...(keep.tags ?? []), ...(drop.tags ?? [])]),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(about ? { about } : {}),
    name: keep.name || drop.name,
    updatedAt: at,
    touches: [...touches, { at, by, mergedFrom: drop.id, note: `merged with lead ${drop.id}${drop.name ? ` (${drop.name})` : ''}: one person`, ...(otherAddress ? { contactFrom: otherAddress } : {}) }],
  };
};

/** The words a member reads for a lead's record, one line, or ''. */
export const recordWords = (lead, defs = []) => [
  lead.tags?.length ? `tags: ${lead.tags.join(', ')}` : null,
  ...Object.entries(lead.fields ?? {}).map(([id, v]) => `${defs.find((d) => d.id === id)?.label ?? id}: ${v}`),
  lead.about ? `note: ${lead.about.slice(0, 160)}` : null,
].filter(Boolean).join(' · ');
