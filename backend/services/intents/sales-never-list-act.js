/**
 * sales/never-list — the sales seat reads the house's never-list, and changes it on its operator's word.
 *
 * Design note, 2026-11-24 (his sales member had searched its tools and found none that sets the list): […]
 *
 * The list is one record, kept in the legal office and read by every screen, run and first email (legal/never-list.js).
 * READING it is free. CHANGING it (add places, take places off) raises a card to the operator, and stands the moment
 * they approve it: the operator's yes is the authority, as it is when they set it on the lead run screen. The legal
 * seat's own act (legal/never-list) still proposes a list worked out from the law; this one is the plain edit.
 * THE OFFICE LAW holds: the seated sales member alone.
 */
import { officeContext } from './revenue-acts.js';
import { makeNeverList, readNeverList, setNeverList, neverListWords } from '../legal/never-list.js';
import { placeName } from '../sales/never-countries.js';

const refusal = { ok: false, status: 'denied', reason: 'the never-list is changed from the sales office by its seated member only (the legal member proposes one with legal/never-list; the operator sets it on the lead run screen)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const codes = (v) => (Array.isArray(v) ? v : []).map((c) => String(typeof c === 'string' ? c : c?.code ?? '').trim().toUpperCase()).filter(Boolean);
const changes = (payload) => payload?.add !== undefined || payload?.remove !== undefined;

export const salesNeverListIntent = Object.freeze({
  name: 'sales/never-list',
  policyTool: 'sales.never-list',
  // Reading asks nobody; a change is the operator's yes.
  policyToolFor: (fields) => (changes(fields) ? 'sales.never-list' : 'sales.never-list-read'),
  fieldsForPrompt: '{} to read it | {add?: [{code, why}], remove?: [code]}',
  descriptionForPrompt: 'THE LEAD ENGINE. THE HOUSE\'S NEVER-LIST: the countries and regions this house never does business with, for EVERY campaign and audience (no lead filed, no email written) — above any audience\'s own country list. With no fields it reads the list that stands. To change it: add names each place by its two-letter ISO code (XO is the occupied regions of Ukraine) with why in a few words (the operator\'s rule, or the law); remove names the codes to take off. A change raises a card to your operator and stands the moment they approve it. Change it only when your operator tells you to, with exactly the places they named.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return refusal;
    if (!changes(payload)) return { ok: true, value: { context, read: true } };
    const stands = await readNeverList(context.wallet);
    const off = new Set(codes(payload.remove));
    const adds = (Array.isArray(payload.add) ? payload.add : []).map((c) => (typeof c === 'string' ? { code: c, why: '' } : c));
    const unknown = [...off].filter((c) => !stands.codes.includes(c));
    if (unknown.length) return invalid(`remove: ${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not on the list (it holds ${stands.codes.join(', ')})`);
    const kept = stands.countries.filter((c) => !off.has(c.code)).map((c) => ({ code: c.code, why: c.why, ...(c.source ? { source: c.source } : {}) }));
    const fresh = adds.filter((a) => !kept.some((k) => k.code === String(a?.code ?? '').trim().toUpperCase())).map((a) => ({ code: a?.code, why: String(a?.why ?? '').trim() || 'The operator\'s own rule' }));
    if (!fresh.length && !off.size) return invalid(`nothing changes: every place you named is already on the list (${stands.codes.join(', ')})`);
    let list;
    try { list = makeNeverList({ home: stands.home ?? undefined, countries: [...kept, ...fresh] }); } catch (err) { return invalid(err.message.replace(/countries\[\d+\]\./g, '')); }
    return { ok: true, value: { context, list, added: fresh.map((f) => String(f.code).trim().toUpperCase()), removed: [...off] } };
  },
  summarize: (payload) => (!changes(payload) ? 'read the house\'s never-list' : `change the house's never-list: ${[codes(payload.add).length ? `add ${codes(payload.add).map((c) => `${placeName(c)} [${c}]`).join(', ')}` : '', codes(payload.remove).length ? `TAKE OFF ${codes(payload.remove).map((c) => `${placeName(c)} [${c}]`).join(', ')}` : ''].filter(Boolean).join('; ')}`),
  execute: async ({ context, read, list, added, removed }) => {
    if (read) return { ok: true, detail: neverListWords(await readNeverList(context.wallet)) };
    await setNeverList(context.wallet, list, context.laneId);
    return { ok: true, detail: `The never-list now stands as: ${list.countries.map((c) => `${c.name} [${c.code}]`).join(', ')}.${added.length ? ` Added: ${added.join(', ')}.` : ''}${removed.length ? ` Taken off: ${removed.join(', ')}.` : ''} Every screen, lead run and first email reads it from now on, for every campaign.` };
  },
});
