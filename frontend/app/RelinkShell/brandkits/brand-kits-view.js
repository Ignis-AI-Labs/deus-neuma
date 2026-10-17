// brand-kits-view — pure shaping for the BRAND KITS window.
//
// Kept out of the components so the rules that decide what an operator SEES can
// be read (and tested) without mounting React.
//
// Moved here from ../brand-kits-view.js on 2026-08-31 with the panel rebuild.
// Three exports did not come with it, and each is worth naming:
//
//   FONT_SLOTS — eleven flat type rows. Superseded by type-roles.js, which
//     groups the same eleven fields under the four roles they serve. The flat
//     list was the literal shape of Founder's complaint: […]
//   missingBySection — a separate […] block listing gaps by path,
//     sections away from any box that could answer them. Superseded by the rail
//     and by marking gaps on the fields themselves.
//   EDITED_STRUCTURALLY — a frozen `['IDENTITY']` naming the one section that
//     had real controls. It was never imported anywhere; it was the code
//     admitting that twenty of thirty-nine fields lived in a JSON textarea.
//     Deleted because it is no longer true.

/** The colour roles the LOADER demands of every kit. The templates ask for
 *  more; template-tokens.js on the server knows which, and the palette editor
 *  badges both — a role the cards need is worth seeing even when a save would
 *  succeed without it. */
export const REQUIRED_COLORS = Object.freeze(['bg', 'ink', 'accent', 'rise', 'halo']);

/**
 * Every colour role to draw a field for: the ones this kit already carries,
 * then any required role it is missing. Pure.
 *
 * Data-driven on purpose. A fixed list here would drift from the backend the
 * first time a role was added, and the drift would show up as a colour the
 * operator cannot edit from the surface built for editing colours.
 */
export const colorRolesOf = (kit, alsoRequired = []) => {
  const present = Object.keys(kit?.colors || {});
  const wanted = [...REQUIRED_COLORS, ...alsoRequired];
  return [...present, ...wanted.filter((r) => !present.includes(r))];
};

/** Is this string something the renderer will accept? Pure — mirrors the
 *  backend's COLOR, so a bad value is caught before a round trip. */
export const isRenderableColor = (value) =>
  /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\([\d\s.,%]+\))$/.test(String(value || ''));

/** A kit's one-line standing, for the switcher. Pure. */
export const kitStanding = (kit) => {
  if (kit.error) return { tone: 'broken', text: 'UNREADABLE' };
  if (kit.ready) return { tone: 'ready', text: 'READY' };
  return { tone: 'draft', text: `${kit.done}/${kit.total} SECTIONS` };
};

/**
 * The OWNER dropdown's options: the house's neuma, keyed by neumaId. Pure.
 *
 * The value is ALWAYS the neumaId and never the display name — a being's name
 * can be changed, and a brand bound to a name would silently unbind the day it
 * was. The label reads as the name because that is who the operator is picking.
 *
 * ⚠️ A stored owner who is not in the roster is KEPT as an option rather than
 * dropped. The roster arrives asynchronously and a being can leave the house;
 * in either case rendering a dropdown that does not contain the current value
 * makes the field read as empty, and the next save would quietly erase a real
 * answer. It is marked so the operator can see what happened instead.
 *
 * @param {Array<{member: object}>} rows houseMembers() output
 * @param {string} [owner] the neumaId the kit currently carries
 * @returns {Array<{value: string, label: string}>}
 */
export const ownerOptions = (rows, owner) => {
  const members = (Array.isArray(rows) ? rows : [])
    .map((r) => r?.member)
    .filter((m) => m && typeof m.neumaId === 'string' && m.neumaId);
  const seen = new Set();
  const options = [];
  for (const m of members) {
    if (seen.has(m.neumaId)) continue;
    seen.add(m.neumaId);
    options.push({ value: m.neumaId, label: (m.name || m.neumaId).toUpperCase() });
  }
  const held = typeof owner === 'string' ? owner.trim() : '';
  if (held && !seen.has(held)) options.push({ value: held, label: `${held.toUpperCase()} · NOT IN THE HOUSE` });
  return options;
};

/**
 * The kit switcher's options. Pure.
 *
 * ⚠️ Carries the SAME guard `ownerOptions` does, for the same reason and a
 * different cause. Starting a new kit selects a brand before anything is on
 * disk, so the open brand is legitimately absent from the list the server sent.
 * A Select whose value is not among its options renders as empty — which would
 * make a brand-new kit look like no kit at all, one keystroke into naming it.
 *
 * @param {Array<{brand: string, name?: string, ready?: boolean, error?: string}>} kits
 * @param {string} [open] the brand currently being edited
 * @param {string} [draftName] what the operator has typed as its name
 */
export const kitSwitcherOptions = (kits, open, draftName) => {
  const rows = Array.isArray(kits) ? kits : [];
  const options = rows.map((kit) => ({
    value: kit.brand,
    label: `${kit.name || kit.brand}${kit.error ? ' · UNREADABLE' : kit.ready ? ' · READY' : ''}`,
  }));
  const held = typeof open === 'string' ? open.trim() : '';
  if (held && !rows.some((k) => k.brand === held)) {
    options.push({ value: held, label: `${draftName || held} · NOT SAVED YET` });
  }
  return options;
};

/**
 * Set a dotted path on a copy of the kit. Pure — never mutates the input.
 *
 * An empty STRING deletes the key rather than storing "". A brand whose tagline
 * is the empty string would satisfy nothing and read as decided, which is
 * exactly the confusion the readiness gate's declared-is-not-non-empty rule
 * exists to avoid.
 *
 * ⚠️ An empty ARRAY is NOT an empty string and is stored. For `disclosures`,
 * `imagery.avoid` and `competitors.neverName` an empty list is a REAL answer
 * meaning somebody decided there are none. Deleting it would silently undo the
 * one decision those fields exist to force.
 */
export const setPath = (kit, dotted, value) => {
  const parts = dotted.split('.');
  const last = parts.pop();
  const next = structuredClone(kit || {});
  let node = next;
  for (const part of parts) {
    if (!node[part] || typeof node[part] !== 'object') node[part] = {};
    node = node[part];
  }
  if (typeof value === 'string' && value.trim() === '') delete node[last];
  else node[last] = value;
  return next;
};

/**
 * Remove a dotted path from a copy of the kit. Pure.
 *
 * Its own function rather than a sentinel value passed to `setPath`, because
 * the three states a list field must express — absent, `[]`, and entries — are
 * genuinely three, and overloading one setter to mean "store this" and
 * "un-decide this" is how the second meaning gets lost.
 *
 * Empty parent objects are left standing. `colors: {}` is a kit mid-edit, not a
 * kit that decided it has no colours, and pruning it would delete a key the
 * next edit is about to write back.
 */
export const unsetPath = (kit, dotted) => {
  const parts = dotted.split('.');
  const last = parts.pop();
  const next = structuredClone(kit || {});
  let node = next;
  for (const part of parts) {
    if (!node[part] || typeof node[part] !== 'object') return next;
    node = node[part];
  }
  delete node[last];
  return next;
};

/** Read a dotted path. Pure. */
export const atPath = (kit, dotted) =>
  dotted.split('.').reduce((node, part) => (node == null ? undefined : node[part]), kit);
