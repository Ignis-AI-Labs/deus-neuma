/**
 * legal/never-list — the legal seat works out, for where its operator is, the places the house never does business
 * with, and proposes the list (legal/never-list.js). Design note, 2026-11-22: […]
 *
 * THE SEAT LAW holds (legal-seat.js): the seated CLO alone. A proposed list WAITS for the operator: nothing the house
 * writes to changes until they approve it. With no countries given, it reads the list that stands.
 */
import { seatRefusal, invalid, availableFor } from './legal-seat.js';
import { makeNeverList, readNeverList, proposeNeverList, neverListWords } from '../legal/never-list.js';

export const legalNeverListIntent = Object.freeze({
  name: 'legal/never-list',
  policyTool: 'legal.never-list',
  fieldsForPrompt: '{home, countries: [{code, why, source}]} | {} to read the list that stands',
  descriptionForPrompt: 'CLO ONLY. THE HOUSE\'S NEVER-LIST: the countries and regions the house never does business with — no lead, no email, no deal, for any company or campaign. It is YOURS to work out and keep current: for the country your operator is in (home, its ISO code) and every law that reaches them, name each place under comprehensive sanctions or an embargo, with why (the law or the programme, in a few words) and source (the https page of the authority that states it: OFAC, the EU sanctions map, the UK OFSI list, the operator\'s own country\'s). code is the two-letter ISO code, or XO for the occupied regions of Ukraine. Places under TARGETED sanctions only (named people and companies) do not belong here: the sanctions name screen catches those. Your operator may add a place by their own rule: keep theirs when you propose again. A proposed list waits for your operator to approve it; until a house has its own, a baseline stands (places under comprehensive United States sanctions) and is marked not reviewed. The sales office reads this one record every time it screens a company, files a lead or stages an email, so there is no second copy to keep in step. Review it whenever sanctions change, and at least every quarter. With nothing given, it reads the list that stands.',
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    if (payload?.countries === undefined) return { ok: true, value: { read: true } };
    try {
      const list = makeNeverList(payload);
      if (!list.countries.length) return invalid('countries: at least one place — a house with no place it never deals with is said by its operator, not proposed empty');
      if (!list.home) return invalid('home: the two-letter ISO code of the country your operator is in — the list is worked out for the law that reaches them');
      if (list.countries.some((c) => !c.source)) return invalid('each place you propose names its source: the https page of the authority that states it');
      return { ok: true, value: { list } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => (payload?.countries === undefined ? 'read the house\'s never-list' : `propose the house's never-list (${(payload.countries ?? []).length} places)`),
  execute: async ({ read, list }, { connection }) => {
    const wallet = connection.walletAddress;
    if (read) return { ok: true, detail: neverListWords(await readNeverList(wallet)) };
    await proposeNeverList(wallet, list, connection.companion?.neumaId || 'clo');
    return { ok: true, detail: `Proposed: ${list.countries.map((c) => `${c.name} [${c.code}]`).join(', ')} — worked out for an operator in ${list.home}. It WAITS for your operator to approve it (POSITIONS, CHIEF REVENUE OFFICER, THE NEVER-LIST); tell them. Until then the list that stands keeps standing.` };
  },
});
