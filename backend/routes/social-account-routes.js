/**
 * THE HOUSE'S APPS AND ACCOUNTS — /api/v1/social-channels/{accounts,apps}
 * (campaign plan §2.4–2.6, slice 4). A platform's developer APP is stored once
 * per house; its ACCOUNTS are many, each under one of the house's companies.
 *
 *   GET    /accounts                         apps, accounts (each with its
 *                                             holder), and the house's companies
 *   POST   /accounts                         open an account {channelId, companyId?, label?, expectedHandle?}
 *   PATCH  /accounts/:accountId              its facts {companyId?, label?, expectedHandle?}
 *   PUT    /accounts/:accountId/credentials  pasted keys {fields}
 *   DELETE /accounts/:accountId              remove it (and release its holder)
 *   PUT    /accounts/:accountId/binding      its one holder {neumaId}
 *   DELETE /accounts/:accountId/binding      release it — default deny
 *   GET|PUT /accounts/:accountId/crew         who WORKS it {neumaId, kind?, remit?}
 *   DELETE /accounts/:accountId/crew/:neumaId release a crew member
 *   GET    /accounts/flight-test[?fresh=1]   every account proven with its own keys
 *   GET    /accounts/house-check[?fresh=1]   the house social check (in-use accounts, roll-up, OPTIONAL)
 *   PUT    /apps/:channelId                  the app's fields {fields}
 *
 * Every answer is the caller's own house and masked: key NAMES and where each
 * is set, never a value. CONNECT for a sign-in platform is
 * social-connect-routes.js with `?account=`.
 */
import express from 'express';
import { requireAuth } from '../services/auth.js';
import { assertNeumaOwner } from '../middleware/require-neuma-owner.js';
import { getChannel } from '../services/social/channel-registry.js';
import { channelBindings } from '../services/social/channel-bindings.js';
import { sectorCrew } from '../services/sector-crew.js';
import { pastedKeyProblem } from '../services/social/channel-credentials.js';
import { channelOfAccountId } from '../services/social/account-shape.js';
import {
  loadAccountStore, listAccounts, listApps, addAccount, setAccountFields, setAccountMeta, setAppFields, removeAccount,
} from '../services/social/account-store.js';
import { runAccountFlightTests } from '../services/social/flight-test.js';
import { runHouseCheck } from '../services/social/house-check/house-check-facts.js';
import { listCompanies } from '../services/marketing/companies.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('SocialChannels.Accounts');
const router = express.Router();
router.use(['/accounts', '/apps'], requireAuth, (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const companyIdsOf = async (wallet) => (await listCompanies(wallet)).map((c) => c.id);

// pure — the pasted fields, trimmed, or the refusal in the person's words.
const pastedFields = (body, channel) => {
  const fields = body?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { error: 'Body must carry a fields object' };
  if (Object.values(fields).some((v) => typeof v !== 'string')) return { error: 'Each field value must be a string' };
  const pasted = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()]));
  const bad = Object.entries(pasted).map(([k, v]) => [k, pastedKeyProblem(v)]).find(([, why]) => why);
  if (bad) return { error: `${channel.fields.find((f) => f.key === bad[0])?.label || bad[0]}: ${bad[1]}` };
  return { fields: pasted };
};

// An account of THIS house, or a 404 — before any handler runs.
router.param('accountId', async (req, res, next, accountId) => {
  try {
    const channel = getChannel(channelOfAccountId(accountId));
    if (!channel) return res.status(404).json({ error: `${accountId} is not an account id` });
    const accounts = await listAccounts(req.walletAddress);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return res.status(404).json({ error: `there is no account ${accountId} in this house` });
    req.channel = channel;
    req.account = account;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.get('/accounts', async (req, res) => {
  const wallet = req.walletAddress;
  try {
    const store = await loadAccountStore(wallet);
    const [apps, accounts, bindings, companies] = await Promise.all([
      listApps(wallet, store), listAccounts(wallet, store), channelBindings.load(wallet), listCompanies(wallet),
    ]);
    res.json({
      apps,
      accounts: accounts.map((a) => ({ ...a, binding: bindings[a.id] || null })),
      companies,
    });
  } catch (error) {
    log.error('accounts read failed', { error: error.message });
    res.status(500).json({ error: 'Failed to read the house\'s accounts' });
  }
});

router.get('/accounts/flight-test', async (req, res) => {
  try {
    const accountIds = (await listAccounts(req.walletAddress)).map((a) => a.id);
    res.json({ tests: await runAccountFlightTests({ wallet: req.walletAddress, accountIds, fresh: req.query.fresh === '1' }) });
  } catch (error) {
    log.error('account flight tests failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the flight tests' });
  }
});

// THE HOUSE SOCIAL CHECK (campaign plan §6.1): every account in use checked
// and rolled up per company → tree → house; the rest OPTIONAL, never counted.
router.get('/accounts/house-check', async (req, res) => {
  try {
    res.json({ check: await runHouseCheck(req.walletAddress, { fresh: req.query.fresh === '1' }) });
  } catch (error) {
    log.error('house social check failed', { error: error.message });
    res.status(500).json({ error: 'Failed to run the house\'s social check' });
  }
});

router.post('/accounts', async (req, res) => {
  const { channelId, companyId, label, expectedHandle } = req.body || {};
  try {
    const meta = Object.fromEntries(Object.entries({ companyId, label, expectedHandle }).filter(([, v]) => v !== undefined));
    const added = await addAccount(req.walletAddress, channelId, meta, await companyIdsOf(req.walletAddress));
    if (!added.ok) return res.status(400).json({ error: added.error });
    log.info('account opened', { accountId: added.accountId, companyId: companyId ?? null, wallet: req.walletAddress });
    return res.status(201).json({ accountId: added.accountId });
  } catch (error) {
    log.error('account open failed', { error: error.message });
    return res.status(500).json({ error: 'Failed to open the account' });
  }
});

router.patch('/accounts/:accountId', async (req, res) => {
  try {
    const set = await setAccountMeta(req.walletAddress, req.account.id, req.body || {}, await companyIdsOf(req.walletAddress));
    if (!set.ok) return res.status(400).json({ error: set.error });
    log.info('account changed', { accountId: req.account.id, keys: Object.keys(req.body || {}), wallet: req.walletAddress });
    return res.json({ account: (await listAccounts(req.walletAddress)).find((a) => a.id === req.account.id) });
  } catch (error) {
    log.error('account change failed', { accountId: req.account.id, error: error.message });
    return res.status(500).json({ error: 'Failed to change the account' });
  }
});

router.put('/accounts/:accountId/credentials', async (req, res) => {
  const pasted = pastedFields(req.body, req.channel);
  if (pasted.error) return res.status(400).json({ error: pasted.error });
  try {
    await setAccountFields(req.walletAddress, req.account.id, pasted.fields);
    log.info('account keys updated', { accountId: req.account.id, fields: Object.keys(pasted.fields), wallet: req.walletAddress });
    return res.json({ account: (await listAccounts(req.walletAddress)).find((a) => a.id === req.account.id) });
  } catch (error) {
    log.error('account key write failed', { accountId: req.account.id, error: error.message });
    return res.status(500).json({ error: 'Failed to store the keys' });
  }
});

router.delete('/accounts/:accountId', async (req, res) => {
  try {
    await channelBindings.unbind(req.walletAddress, req.account.id);
    const removed = await removeAccount(req.walletAddress, req.account.id);
    log.info('account removed', { accountId: req.account.id, removed, wallet: req.walletAddress });
    return res.json({ removed });
  } catch (error) {
    log.error('account removal failed', { accountId: req.account.id, error: error.message });
    return res.status(500).json({ error: 'Failed to remove the account' });
  }
});

router.put('/accounts/:accountId/binding', async (req, res) => {
  const neumaId = req.body?.neumaId;
  if (!(await assertNeumaOwner(req, res, neumaId))) return undefined;
  try {
    const binding = await channelBindings.bind(req.walletAddress, req.account.id, { neumaId });
    log.info('account bound', { accountId: req.account.id, neumaId, wallet: req.walletAddress });
    return res.json({ binding });
  } catch (error) {
    if (error.message === 'Invalid neumaId') return res.status(400).json({ error: error.message });
    log.error('account bind failed', { accountId: req.account.id, error: error.message });
    return res.status(500).json({ error: 'Failed to bind the account' });
  }
});

router.delete('/accounts/:accountId/binding', async (req, res) => {
  try {
    res.json({ released: await channelBindings.unbind(req.walletAddress, req.account.id) });
  } catch (error) {
    log.error('account release failed', { accountId: req.account.id, error: error.message });
    res.status(500).json({ error: 'Failed to release the account' });
  }
});

// THE CREW of one account — who works it, as distinct from its one holder.
router.get('/accounts/:accountId/crew', async (req, res) => {
  try {
    res.json({ crew: await sectorCrew.crewFor(req.walletAddress, req.account.id) });
  } catch (error) {
    log.error('account crew read failed', { accountId: req.account.id, error: error.message });
    res.status(500).json({ error: 'Failed to read the crew' });
  }
});

router.put('/accounts/:accountId/crew', async (req, res) => {
  const { neumaId, kind, remit } = req.body || {};
  if (!(await assertNeumaOwner(req, res, neumaId))) return undefined;
  try {
    return res.json({ crew: await sectorCrew.add(req.walletAddress, req.account.id, { neumaId, kind, remit }) });
  } catch (error) {
    if (/valid lane id|Unknown sector|crew holds/.test(error.message)) return res.status(400).json({ error: error.message });
    log.error('account crew add failed', { accountId: req.account.id, error: error.message });
    return res.status(500).json({ error: 'Failed to add the crew member' });
  }
});

router.delete('/accounts/:accountId/crew/:neumaId', async (req, res) => {
  try {
    res.json({ crew: await sectorCrew.remove(req.walletAddress, req.account.id, req.params.neumaId) });
  } catch (error) {
    log.error('account crew release failed', { accountId: req.account.id, error: error.message });
    res.status(500).json({ error: 'Failed to release the crew member' });
  }
});

router.put('/apps/:channelId', async (req, res) => {
  const channel = getChannel(req.params.channelId);
  if (!channel || !channel.fields.some((f) => f.app)) return res.status(404).json({ error: `${req.params.channelId} has no developer app` });
  const pasted = pastedFields(req.body, channel);
  if (pasted.error) return res.status(400).json({ error: pasted.error });
  const appKeys = new Set(channel.fields.filter((f) => f.app).map((f) => f.key));
  const stray = Object.keys(pasted.fields).find((k) => !appKeys.has(k));
  if (stray) return res.status(400).json({ error: `${stray} belongs to an account, not to the app` });
  try {
    await setAppFields(req.walletAddress, channel.id, pasted.fields);
    log.info('app keys updated', { channelId: channel.id, fields: Object.keys(pasted.fields), wallet: req.walletAddress });
    return res.json({ app: (await listApps(req.walletAddress)).find((a) => a.id === channel.id) });
  } catch (error) {
    log.error('app key write failed', { channelId: channel.id, error: error.message });
    return res.status(500).json({ error: 'Failed to store the app keys' });
  }
});

export default router;
