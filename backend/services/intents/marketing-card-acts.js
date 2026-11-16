/**
 * marketing/card — the marketing seat's own hand on a company's cards (Design note, 2026-11-16: […]).
 *
 * The BRAND panel's CARDS section already lets the operator do this by hand; this is the same
 * store through one act, for the member who holds the marketing seat:
 *   list     every card type the company has, which are its own, which are shared, which are retired
 *   open     the design the company draws now, written into the member's own ground to be edited
 *   keep     the edited files become the company's own design (or a NEW card type of that name)
 *   drop     the company's own design is let go: the shared card stands again, or its own type is gone
 *   retire   the company stops using a shared card type · restore   it uses it again
 *
 * A design travels as FILES, never inside the filing: an SVG in a JSON string is quoting a model
 * gets wrong. `open` writes <ground>/card-designs/<company>/<card>.svg and .json; the member
 * edits them with its file tools; `keep` reads those two files. The paths are fixed, so nothing
 * outside the member's own ground is ever read.
 *
 * It stands at once (tier allowed): a design is held to card-safety.js, must draw against the
 * company's saved kit, is written only into the operator's own ground, reaches nobody, and is
 * undone with one act. Publishing a card is still the queue's gate.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { ensureBeingGround } from '../house-workspace.js';
import { loadTemplate, listTemplates, brandsDir } from '../branding/brand-tokens.js';
import { listBrandNames } from '../branding/kit-locate.js';
import { designNameRefusal, listDesigns } from '../branding/card-designs.js';
import { saveDesign, removeDesign } from '../branding/card-design-save.js';
import { cardGallery } from '../branding/card-gallery.js';
import { setRetired } from '../branding/card-set.js';

export const CARD_DOS = Object.freeze(['list', 'open', 'keep', 'drop', 'retire', 'restore']);
const laneOf = (connection) => connection?.companion?.neumaId || null;
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const pct = (score) => `${Math.round(score * 100)}%`;

/** pure — what a design may be made of, in the words a member needs before it draws one. */
export const DESIGN_RULES = [
  'A design is one <svg> (1600x900 unless its .json says another size) made of shapes, text, gradients, patterns, filters, clips, masks and images. No script, no on*= handlers, no outside links, no @import, no <foreignObject>, no doctype.',
  'Paint and type come from the company\'s kit, never a literal: {{token.<colour>}} and {{font.<role>}}, as the opened design uses them. The company\'s marks are {{mark.wordmark}} and {{mark.mask}} in an <image href>.',
  'Copy comes from fields: {{data.<field>}} in the .svg, and each field declared in the .json as {"fields": {"headline": {"required": true, "max": 40, "label": "…"}}}. Add, rename or remove fields freely; max is the most characters that fit the frame you drew.',
  'Make it this company\'s: move, resize and replace shapes. A design 70% or more like another company\'s card of the same name is named in the answer.',
].join('\n');

/** pure — one card's line in the list. */
export const cardLine = (card) => {
  const fields = Object.entries(card.fields || {}).map(([f, rule]) => `${f}${rule.required ? '*' : ''}${rule.max ? `≤${rule.max}` : ''}`).join(', ');
  const standing = card.error ? `CANNOT BE DRAWN: ${card.error}`
    : card.retired ? 'RETIRED (not used by this company)'
      : card.source === 'shared' ? 'SHARED LAYOUT (the same drawing other companies use)'
        : card.ownType ? 'ITS OWN CARD TYPE' : 'ITS OWN DESIGN';
  const alike = !card.retired && card.source === 'company' && card.likeness?.length ? ` — ${pct(card.likeness[0].score)} like ${card.likeness[0].brand}'s: redesign it further` : '';
  return `- ${card.name} — ${standing}${alike}${fields ? ` — fields: ${fields}` : ''}`;
};

/** pure — the whole list as the member reads it. */
export const galleryText = (company, gallery) => [
  `${company}'s cards: ${gallery.own} its own, ${gallery.shared} still the shared layout, ${gallery.retired} retired${gallery.tooAlike ? `, ${gallery.tooAlike} too like another company's` : ''}.`,
  ...gallery.cards.map(cardLine),
  'Next: marketing/card {do: "open", company, card} to redesign one or start a new card type from it; "retire" a shared one this company should not have; render_card draws any card it uses.',
].join('\n');

// impure — where this member edits one company's card.
const draftPaths = async (wallet, lane, company, card) => {
  const { path: ground } = await ensureBeingGround(wallet, lane);
  if (!ground) return null;
  const dir = path.join(ground, 'card-designs', company);
  return { dir, svg: path.join(dir, `${card}.svg`), json: path.join(dir, `${card}.json`) };
};

const DOERS = {
  list: async ({ wallet, company }) => ({ ok: true, detail: galleryText(company, await cardGallery(company, wallet)) }),

  open: async ({ wallet, lane, company, card, from }) => {
    const source = await loadTemplate(from || card, { brand: company, wallet });
    if (!source.ok) return { ok: false, reason: from ? source.error : `${company} has no ${card} card to open. For a NEW card type, name an existing one to start from: {do: "open", company: "${company}", card: "${card}", from: "<an existing card>"}` };
    const at = await draftPaths(wallet, lane, company, card);
    if (!at) return { ok: false, reason: 'this house has no ground set, so there is nowhere of yours to edit a design — ask your operator to set the house folder' };
    await mkdir(at.dir, { recursive: true });
    await writeFile(at.svg, source.svg, 'utf8');
    await writeFile(at.json, `${JSON.stringify(from ? { ...source.spec, title: card } : source.spec, null, 2)}\n`, 'utf8');
    return { ok: true, detail: `${from ? `A new ${card} card for ${company}, started from ${from}` : `${company}'s ${card} card (${source.source === 'company' ? 'its own design' : 'the shared layout'})`} is in your ground to edit:\n${at.svg}\n${at.json}\nEdit both with your file tools, then file marketing/card {do: "keep", company: "${company}", card: "${card}"}. Nothing changes for the company until you keep it.\n${DESIGN_RULES}` };
  },

  keep: async ({ wallet, lane, company, card }) => {
    const at = await draftPaths(wallet, lane, company, card);
    if (!at) return { ok: false, reason: 'this house has no ground set, so there is no design of yours to keep' };
    let svg; let spec;
    try {
      svg = await readFile(at.svg, 'utf8');
    } catch {
      return { ok: false, reason: `there is no design at ${at.svg} — open it first: marketing/card {do: "open", company: "${company}", card: "${card}"}` };
    }
    try {
      spec = JSON.parse(await readFile(at.json, 'utf8'));
    } catch (err) {
      return { ok: false, reason: `${at.json} is not readable JSON (${err.message}) — fix it and keep again` };
    }
    const saved = await saveDesign({ brand: company, template: card, svg, spec, wallet });
    if (!saved.ok) return { ok: false, reason: `${saved.error}\nFix ${at.svg} or ${at.json} and keep again.` };
    await setRetired({ brand: company, template: card, retired: false, wallet });
    const mine = (await cardGallery(company, wallet)).cards.find((c) => c.name === card);
    const alike = mine?.likeness?.length ? ` Its layout is still ${pct(mine.likeness[0].score)} like ${mine.likeness[0].brand}'s ${card}: move, resize or replace shapes and keep again.` : ' No other company\'s card of this name looks like it.';
    return { ok: true, detail: `${company} now draws its own ${card} card.${alike} Draw it with render_card {brand: "${company}", template: "${card}", data} and look at it before it goes near a post. Your operator sees it in MARKETING, BRAND, CARDS.` };
  },

  drop: async ({ wallet, company, card }) => {
    const removed = await removeDesign({ brand: company, template: card, wallet });
    if (!removed.ok) return { ok: false, reason: removed.error };
    const shared = (await listTemplates()).includes(card);
    return { ok: true, detail: shared ? `${company}'s own ${card} design is let go; it draws the shared ${card} card again. To stop using that card for ${company} altogether: {do: "retire"}.` : `${company}'s ${card} card type is gone (no other company had it).` };
  },

  retire: async ({ wallet, company, card }) => {
    if (!(await listTemplates()).includes(card)) return { ok: false, reason: `${card} is not a shared card type — a card type of ${company}'s own is removed with {do: "drop"}` };
    if ((await listDesigns(company, wallet)).some((d) => d.name === card)) return { ok: false, reason: `${company} draws its own ${card} design — let that go first with {do: "drop"}, then retire the shared one` };
    const set = await setRetired({ brand: company, template: card, retired: true, wallet });
    return set.ok ? { ok: true, detail: `${company} no longer uses the ${card} card; every other company keeps it. {do: "restore"} brings it back.` } : { ok: false, reason: set.error };
  },

  restore: async ({ wallet, company, card }) => {
    const set = await setRetired({ brand: company, template: card, retired: false, wallet });
    return set.ok ? { ok: true, detail: `${company} uses the ${card} card again.` } : { ok: false, reason: set.error };
  },
};

export const marketingCardIntent = Object.freeze({
  name: 'marketing/card',
  policyTool: 'marketing.card',
  fieldsForPrompt: '{do: "list" | "open" | "keep" | "drop" | "retire" | "restore", company, card?, from?}',
  descriptionForPrompt: 'Shape a company\'s OWN cards: every company has its own set of card types and its own layouts, and they are yours to organize. list: every card type the company has, which are its own design, which are still the shared layout other companies draw too, which are retired. open {card}: the design the company draws now is written into your ground as an .svg and a .json to edit with your file tools; add from: <an existing card> to start a NEW card type of that name. keep {card}: your edited files become the company\'s own design (it must be safe to draw and draw against the company\'s kit; the reasons come back if not). drop {card}: let the company\'s own design go (the shared card stands again; a card type only it had is gone). retire {card}: the company stops using a shared card type; restore {card}: it uses it again. It stands at once and is undone by the opposite act; no two companies should wear the same layout, so redesign what list calls SHARED and answer every "too like" it names. Publishing a card is still the post queue.',
  // Offered to the house's seated CMO alone.
  availableFor: async ({ laneId, connection }) => (laneId && await cmoDesignation.holds(connection?.walletAddress, laneId) ? {} : null),
  validate: async (payload, { connection } = {}) => {
    const wallet = connection?.walletAddress;
    const lane = laneOf(connection);
    if (!wallet || !(await cmoDesignation.holds(wallet, lane))) return { ok: false, status: 'denied', reason: 'only the member who holds the marketing seat shapes a company\'s cards — ask your operator who holds the office' };
    const act = String(payload?.do ?? '');
    if (!CARD_DOS.includes(act)) return invalid(`do is one of: ${CARD_DOS.join(', ')}`);
    const company = String(payload?.company ?? '').trim().toLowerCase();
    const known = (await listBrandNames(wallet, brandsDir())).map((b) => b.brand);
    if (!known.includes(company)) return invalid(`"${company}" has no brand kit in this house — the kits are: ${known.join(', ') || 'none yet'}`);
    const card = String(payload?.card ?? '').trim().toLowerCase();
    if (act !== 'list') {
      const named = designNameRefusal(card);
      if (named) return invalid(`${named} (card: the card type's name, as list gives it)`);
    }
    const from = payload?.from === undefined ? null : String(payload.from).trim().toLowerCase();
    if (from !== null && (act !== 'open' || designNameRefusal(from))) return invalid('from names an existing card to start a new card type from, and belongs to do: "open" only');
    return { ok: true, value: { act, wallet, lane, company, card, from } };
  },
  summarize: (payload) => `${String(payload?.do ?? '?').slice(0, 10)} ${String(payload?.company ?? '?').slice(0, 30)}'s ${payload?.card ? `${String(payload.card).slice(0, 40)} card` : 'cards'}`,
  execute: async (value) => DOERS[value.act](value),
});
