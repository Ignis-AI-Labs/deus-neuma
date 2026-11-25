// WHICH COMPANY A DEAL IS FOR — any company of the house.
//
// A house has companies in two places: the ones it sells for (its brand kits — marketing/companies.js; the lead
// engine's audiences and campaigns name these), and the ones being FOUNDED on the company line
// (company-line/company-store.js). A deal used to accept only the second kind, so a house that sells for the
// companies it already has — the ordinary case — could open no deal at all, and so issue no invoice (found
// 2026-11-21: the operator's own house had audiences, leads and booked calls for two companies and no way to open a
// deal for either). A deal, and the invoice that bills it, is now for any company of the house, whichever list holds it.
// impure — reads both lists.
import { readCompany, listCompanies as lineCompanies } from '../company-line/company-store.js';
import { listCompanies as houseCompanies } from '../marketing/companies.js';

/** Every company a deal may be opened for: {id, name}, the ones the house sells for first. */
export const companiesOfHouse = async (wallet) => {
  const [sells, founding] = await Promise.all([
    houseCompanies(wallet).catch(() => []),
    lineCompanies(wallet).then((l) => l.companies).catch(() => []),
  ]);
  const all = [...sells, ...founding].map((c) => ({ id: c.id, name: c.name || c.id }));
  return all.filter((c, i) => all.findIndex((o) => o.id === c.id) === i);
};

/** One company of the house by its id, or null: {id, name}. */
export const companyOfHouse = async (wallet, id) => {
  const key = String(id ?? '').trim();
  if (!key) return null;
  const line = await readCompany(wallet, key).catch(() => null);
  if (line) return { id: line.id, name: line.name || line.id };
  return (await companiesOfHouse(wallet)).find((c) => c.id === key) ?? null;
};
