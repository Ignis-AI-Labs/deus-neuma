/**
 * registry/lookup — does this company exist in law? (Design note, 2026-11-16: […])
 *
 * Any member may ask: a read of the house's own registry index on this machine
 * (registry/registry-index.js), nothing leaves, nothing is spent. By name (every word must be in
 * the registered name) or by the exact number, optionally in one country. The answer is what the
 * register says, with the register and the public record's address on every line, so it can be
 * cited. A company that is not found is NOT thereby proven not to exist: the index holds only the
 * registers the operator loaded, and it says which.
 */
import { searchRegistry, registryStats, entityLine, REGISTERS } from '../registry/registry-index.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const held = (stats) => Object.entries(stats.registers).map(([id, r]) => `${REGISTERS[id]?.name ?? id} (${r.entities.toLocaleString('en-US')} entities, loaded ${String(r.loadedAt ?? '').slice(0, 10) || 'on an unknown day'})`).join('; ');

export const registryLookupIntent = Object.freeze({
  name: 'registry/lookup',
  policyTool: 'registry.lookup',
  fieldsForPrompt: '{name?, number?, country?, limit?}',
  descriptionForPrompt: 'Look a company up in the official registers held on this machine (free, local, nothing leaves): name (every word must be in its registered name) or number (its exact company number or LEI), optionally country (a two-letter code or the country\'s name). Each answer says which register it stands in, its number, its standing (active, dissolved, …), its legal form, its registered address, the date it was formed, and the address of its public record, which you cite. Use it before you rely on a company being real, when you check who a counterparty is, and when a contract, an invoice or an email names a company. Not found means not in the registers loaded here, never that the company does not exist: say which registers you checked.',
  // Offered to every member once a register is loaded: a local read, nothing leaves, nothing is spent.
  availableFor: () => (registryStats().loaded ? {} : null),
  validate: async (payload) => {
    const name = String(payload?.name ?? '').trim();
    const number = String(payload?.number ?? '').trim();
    if (name.length < 2 && !number) return invalid('give a name (at least two characters) or a number');
    const stats = registryStats();
    if (!stats.loaded) return { ok: false, status: 'denied', reason: 'no official register is loaded on this machine yet — tell your operator: "node scripts/load-company-index.mjs --fetch uk-companies" and "--fetch lei" load the UK register and the global LEI register (free)' };
    return { ok: true, value: { name, number, country: String(payload?.country ?? '').trim(), limit: payload?.limit, stats } };
  },
  summarize: (payload) => `look up ${String(payload?.name || payload?.number || '?').slice(0, 60)} in the official registers`,
  execute: async ({ name, number, country, limit, stats }) => {
    const found = searchRegistry({ name, number, country, limit });
    const checked = `Registers checked: ${held(stats)}.`;
    if (!found.length) return { ok: true, detail: `No entity ${number ? `with the number ${number}` : `named "${name}"`}${country ? ` in ${country}` : ''} stands in the registers held here. That is not proof it does not exist. ${checked}` };
    return { ok: true, detail: [`${found.length} entit${found.length === 1 ? 'y' : 'ies'}:`, ...found.map((e) => `- ${entityLine(e)}`), checked].join('\n') };
  },
});
