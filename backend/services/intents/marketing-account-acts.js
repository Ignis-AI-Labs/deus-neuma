/**
 * marketing/account-* — the seated CMO keeps the house's social accounts in
 * order (Design note, 2026-11-12, after the CMO reported […]: […]).
 *
 *   marketing/account-handle  {account, handle}  the @handle the account
 *     answers as. No card: a record the social check re-reads against the
 *     live account — a wrong handle shows there as a mismatch, never a send.
 *   marketing/account-holder  {account, holder}  the lane that speaks for the
 *     account. The operator's card: it decides who speaks.
 *   marketing/account-company {account, company} the company the account
 *     carries. The operator's card: it decides whose brand it speaks for.
 *
 * Offered to, and re-verified for, the house's seated CMO; the account, the
 * company and the holder must all be the house's own.
 */
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { listCompanies } from '../marketing/companies.js';
import { listAccounts, setAccountMeta } from '../social/account-store.js';
import { channelBindings } from '../social/channel-bindings.js';
import { houseOfLane } from '../social/house-positions.js';

const HANDLE = /^[A-Za-z0-9_.-]{1,50}$/;
const denied = { ok: false, status: 'denied', reason: 'the house\'s accounts are kept by its seated CMO — ask your operator who holds the office' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// impure — the seat, then the account named, both of the filer's own house.
const seatAndAccount = async (payload, connection) => {
  const wallet = connection?.walletAddress;
  const laneId = connection?.companion?.neumaId || null;
  if (!wallet || !laneId || !(await cmoDesignation.holds(wallet, laneId))) return { refusal: denied };
  let accounts;
  try {
    accounts = await listAccounts(wallet);
  } catch (err) {
    return { refusal: invalid(`the house's accounts cannot be read (${err.message}) — your operator unlocks them on ACCOUNTS`) };
  }
  const account = accounts.find((a) => a.id === text(payload?.account));
  if (!account) return { refusal: invalid(`"${text(payload?.account)}" is not an account of this house — they are ${accounts.map((a) => a.id).join(', ') || 'none yet'}`) };
  return { wallet, account };
};

const offered = async ({ laneId, connection }) => (laneId && await cmoDesignation.holds(connection?.walletAddress, laneId) ? {} : null);

const marketingAccountHandleIntent = Object.freeze({
  name: 'marketing/account-handle',
  policyTool: 'marketing.account-handle',
  fieldsForPrompt: '{account, handle}',
  descriptionForPrompt: 'Record the @handle a house account answers as (account: its id, e.g. x-1). The social check reads the live account against it, so record what the platform shows — read_x {what:\'me\'} for X.',
  availableFor: offered,
  validate: async (payload, { connection } = {}) => {
    const { refusal, wallet, account } = await seatAndAccount(payload, connection);
    if (refusal) return refusal;
    const handle = text(payload?.handle).replace(/^@/, '');
    if (!HANDLE.test(handle)) return invalid('handle must be the account\'s @name — letters, numbers, _ . - only');
    return { ok: true, value: { wallet, accountId: account.id, handle } };
  },
  summarize: (payload) => `record @${text(payload?.handle).replace(/^@/, '').slice(0, 50)} on ${text(payload?.account).slice(0, 20)}`,
  execute: async ({ wallet, accountId, handle }) => {
    const set = await setAccountMeta(wallet, accountId, { expectedHandle: handle }, (await listCompanies(wallet)).map((c) => c.id));
    return set.ok ? { ok: true, detail: `${accountId} now reads as @${handle}. The social check re-reads it against the live account.` } : { ok: false, reason: set.error };
  },
});

const marketingAccountHolderIntent = Object.freeze({
  name: 'marketing/account-holder',
  policyTool: 'marketing.account-holder',
  fieldsForPrompt: '{account, holder}',
  descriptionForPrompt: 'Seat the lane that speaks for a house account (holder: its lane id — yourself, or another being of this house). Your operator approves it on a card: it decides who speaks for the account.',
  availableFor: offered,
  validate: async (payload, { connection } = {}) => {
    const { refusal, wallet, account } = await seatAndAccount(payload, connection);
    if (refusal) return refusal;
    const holder = text(payload?.holder);
    const house = holder ? await houseOfLane(holder).catch(() => null) : null;
    if (!house || house.toLowerCase() !== wallet.toLowerCase()) return invalid(`"${holder}" is not a lane of this house`);
    return { ok: true, value: { wallet, accountId: account.id, holder } };
  },
  summarize: (payload) => `seat ${text(payload?.holder).slice(0, 40)} as the voice of ${text(payload?.account).slice(0, 20)}`,
  execute: async ({ wallet, accountId, holder }) => {
    await channelBindings.bind(wallet, accountId, { neumaId: holder });
    return { ok: true, detail: `${holder} now holds ${accountId} — it speaks for that account.` };
  },
});

const marketingAccountCompanyIntent = Object.freeze({
  name: 'marketing/account-company',
  policyTool: 'marketing.account-company',
  fieldsForPrompt: '{account, company}',
  descriptionForPrompt: 'Move a house account to the company it speaks for (company: its id). Your operator approves it on a card: it decides whose brand the account carries.',
  availableFor: offered,
  validate: async (payload, { connection } = {}) => {
    const { refusal, wallet, account } = await seatAndAccount(payload, connection);
    if (refusal) return refusal;
    const companies = await listCompanies(wallet);
    const company = companies.find((c) => c.id === text(payload?.company));
    if (!company) return invalid(`"${text(payload?.company)}" is not a company of this house — they are ${companies.map((c) => c.id).join(', ')}`);
    return { ok: true, value: { wallet, accountId: account.id, companyId: company.id, companyIds: companies.map((c) => c.id) } };
  },
  summarize: (payload) => `move ${text(payload?.account).slice(0, 20)} to ${text(payload?.company).slice(0, 40)}`,
  execute: async ({ wallet, accountId, companyId, companyIds }) => {
    const set = await setAccountMeta(wallet, accountId, { companyId }, companyIds);
    return set.ok ? { ok: true, detail: `${accountId} now speaks for ${companyId}.` } : { ok: false, reason: set.error };
  },
});

export const marketingAccountIntents = Object.freeze([marketingAccountHandleIntent, marketingAccountHolderIntent, marketingAccountCompanyIntent]);
