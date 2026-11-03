// THE INSTALL OWNER — whose computer this is (ruling, 2026-10-19).
//
// One install can hold several houses: each wallet that signs in runs its own
// house, but the MACHINE — the LLM server, the realm and workspaces roots, the
// whole-disk file explorer, the provider keys, the mind gates, the raw
// telemetry, the remote roads — is one thing, and it belongs to the wallet
// that set the install up. That owner may name co-owners; every other wallet
// is a guest. Every machine-wide change also has to come from this computer's
// own desk, never a paired phone.
//
// The record lives in the install's settings (not the realm: the realm root
// is itself an owner setting, and a relocation must not reset who owns it).
// It is written once, at first read, from the earliest durable fact of who
// set the install up — the first genesis seal under the install's own
// workspaces root — and on a fresh install by the first wallet that signs in
// at the local desk AND presents the install's owner claim (owner-claim.js:
// a secret only the OS user running the app can read), so another account on
// a shared computer cannot take a fresh install by opening the app first.

import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from './data-root.js';
import { writeJsonAtomic } from './user-realm.js';
import { upgradeAccess } from './remote/access-guard.js';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';
import { OWNER_CLAIM_HEADER, clearOwnerClaim, ensureOwnerClaim, ownerClaimMatches } from './owner-claim.js';

const log = createLogger('InstallOwner');

const SCHEMA = 'install-owner/1';
const WALLET = /^0x[a-f0-9]{40}$/;
export const GUEST_REFUSAL = "This computer's settings belong to its owner. Your house is yours to run; "
  + 'the machine is theirs — ask them, or ask to be made a co-owner.';
export const UNCLAIMED_REFUSAL = 'No one owns this computer yet. Sign in with the Deus Neuma app on this computer, '
  + 'as the account that installed it, to become its owner.';
export const DESK_REFUSAL = "This computer's settings change only at its own desk, never from a paired phone.";

const recordPath = () => path.join(getSettingsDir(), 'install-owner.json');
const lower = (wallet) => String(wallet || '').trim().toLowerCase();

// pure — a well-formed record, or null
const normalizeRecord = (raw) => {
  const owner = lower(raw?.owner);
  if (!WALLET.test(owner)) return null;
  const coOwners = [...new Set((Array.isArray(raw.coOwners) ? raw.coOwners : []).map(lower))]
    .filter((w) => WALLET.test(w) && w !== owner);
  return Object.freeze({ schema: SCHEMA, owner, coOwners: Object.freeze(coOwners), recordedAt: raw.recordedAt ?? null, source: raw.source ?? null });
};

/**
 * Which standing a wallet holds on this machine. Pure.
 * @param {{owner: string, coOwners: string[]}|null} record
 * @param {string} wallet
 * @returns {'owner'|'co-owner'|'guest'|'unowned'}
 */
export const standingIn = (record, wallet) => {
  if (!record) return 'unowned';
  const who = lower(wallet);
  if (who && who === record.owner) return 'owner';
  return record.coOwners.includes(who) ? 'co-owner' : 'guest';
};

// impure — the install's OWN workspaces root: the persisted desk choice in
// this install's settings, never a launch's override, so a house backend or a
// sitting pinned to another ground derives the same owner as the desk does.
const installWorkspacesRoot = async () => {
  try {
    const { root } = JSON.parse(await fs.readFile(path.join(getSettingsDir(), 'workspace.json'), 'utf8'));
    if (typeof root === 'string' && path.isAbsolute(root)) return root;
  } catch (error) {
    if (error.code !== 'ENOENT') log.warn('workspace settings unreadable — deriving from the live root', { error: error.message });
  }
  return getWorkspacesRoot();
};

// impure — the operator wallet of the first being sealed under the root
const firstSealedWallet = async (root) => {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  let first = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const seal = await fs.readFile(path.join(root, entry.name, 'identity', 'genesis-seal.json'), 'utf8')
      .then(JSON.parse).catch(() => null);
    const wallet = lower(seal?.record?.witnessWallet);
    const at = Number(seal?.record?.birthMoment?.epochMs);
    if (!WALLET.test(wallet) || !Number.isFinite(at)) continue;
    if (!first || at < first.at || (at === first.at && wallet < first.wallet)) first = { wallet, at, lane: entry.name };
  }
  return first;
};

/**
 * What the record would say if it were written now, from the install's own
 * ground. Read-only. impure (fs reads).
 * @returns {Promise<{wallet: string, at: number, lane: string, root: string}|null>}
 */
export const deriveInstallOwner = async () => {
  const root = await installWorkspacesRoot();
  const first = await firstSealedWallet(root);
  return first ? { ...first, root } : null;
};

const readRecordFile = async () => {
  try {
    const record = normalizeRecord(JSON.parse(await fs.readFile(recordPath(), 'utf8')));
    // A record that parses but names no owner is as torn as one that does not parse: read as
    // absent it would be re-derived, its co-owners dropped (re-audit 2026-10-29, NEW-L8).
    if (!record) throw new Error('the record names no valid owner');
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // A torn record must never read as "nobody owns this" — that would hand
    // the machine to the next wallet. It reads as owned by no one we can name.
    log.error('install owner record unreadable — every machine change refused until it is repaired', { error: error.message });
    throw Object.assign(new Error('The install owner record is unreadable'), { code: 'INSTALL_OWNER_UNREADABLE' });
  }
};

const writeRecord = async (record) => {
  const next = normalizeRecord(record);
  await writeJsonAtomic(recordPath(), next);
  // An owner stands: the claim that could seat one is spent.
  await clearOwnerClaim().catch((error) => log.warn('owner claim not removed', { error: error.message }));
  return next;
};

/**
 * The install's owner record, written at first read from the derivation when
 * absent. Null only on an install where no being was ever sealed and no
 * wallet has signed in at the desk. impure (fs).
 * @returns {Promise<Readonly<{owner: string, coOwners: string[]}>|null>}
 */
export const readInstallOwner = async () => {
  const existing = await readRecordFile();
  if (existing) return existing;
  const derived = await deriveInstallOwner();
  if (!derived) return null;
  log.info('install owner recorded from the first genesis seal', { owner: derived.wallet, lane: derived.lane });
  return writeRecord({ owner: derived.wallet, recordedAt: new Date().toISOString(), source: `genesis-seal:${derived.lane}` });
};

/**
 * The install's own desk house: the owner's wallet, when this process serves
 * the install's own workspaces root. A house backend pinned to another ground
 * is not this install's desk, so it never takes the owner's house for its
 * own. Null on an install where no being was ever sealed and no wallet has
 * signed in at the desk — no house is invented for a wallet that never came.
 * impure (fs).
 * @returns {Promise<?string>}
 */
export const installDeskHouse = async () => {
  const record = await readInstallOwner();
  if (!record) return null;
  return path.resolve(await installWorkspacesRoot()) === path.resolve(getWorkspacesRoot()) ? record.owner : null;
};

/**
 * On an install no one owns yet, this wallet becomes its owner. A no-op once
 * an owner stands. Unconditional: every request reaches it only through
 * ownerOrClaim, which asks for the owner claim first. impure (fs).
 * @param {string} wallet
 * @returns {Promise<Readonly<object>|null>}
 */
export const recordFirstLocalOwner = async (wallet) => {
  const current = await readInstallOwner();
  if (current || !WALLET.test(lower(wallet))) return current;
  log.info('install owner recorded at the first local sign-in', { owner: lower(wallet) });
  return writeRecord({ owner: wallet, recordedAt: new Date().toISOString(), source: 'first-local-sign-in' });
};

// impure (fs) — the record; on an install no one owns yet, this wallet is
// seated only when it presents the owner claim, else the install stays unowned
const ownerOrClaim = async (wallet, claim) => {
  const current = await readInstallOwner();
  if (current) return current;
  if (!(await ownerClaimMatches(claim))) {
    log.info('a first owner was not seated — no owner claim presented', { wallet: lower(wallet) });
    return null;
  }
  return recordFirstLocalOwner(wallet);
};

const claimOf = (req) => req.headers?.[OWNER_CLAIM_HEADER];

/**
 * At boot: while no owner stands, the owner claim is there for the desk app to
 * read; once one does, it is gone. Never fails the boot. impure (fs).
 */
export const prepareOwnerClaim = async () => {
  try {
    if (await readInstallOwner()) await clearOwnerClaim();
    else await ensureOwnerClaim();
  } catch (error) {
    log.error('owner claim not prepared', { error: error.message });
  }
};

/**
 * A sign-in at this computer's own desk: on an install no one owns yet, this
 * wallet becomes its owner when it presents the owner claim. A sign-in never
 * fails on the owner record — a failure is logged, and the gate asks again at
 * the first machine change. impure (fs).
 * @param {string} wallet
 * @param {unknown} claim - the X-Neuma-Owner-Claim header, if any
 * @returns {Promise<'owner'|'co-owner'|'guest'|'unowned'|null>} null when unknown
 */
export const noteLocalSignIn = async (wallet, claim) => {
  try {
    return standingIn(await ownerOrClaim(wallet, claim), wallet);
  } catch (error) {
    log.error('install owner not recorded at sign-in', { error: error.message });
    return null;
  }
};

/**
 * The owner adds or removes a co-owner. impure (fs).
 * @param {{wallet: string, add: boolean}} change
 * @returns {Promise<Readonly<object>>}
 */
export const changeCoOwner = async ({ wallet, add }) => {
  const record = await readInstallOwner();
  if (!record) throw Object.assign(new Error('No one owns this computer yet'), { code: 'NO_OWNER' });
  const who = lower(wallet);
  if (!WALLET.test(who)) throw Object.assign(new Error('A co-owner is named by a wallet address'), { code: 'BAD_WALLET' });
  if (who === record.owner) throw Object.assign(new Error('The owner is already the owner'), { code: 'BAD_WALLET' });
  const coOwners = add ? [...record.coOwners, who] : record.coOwners.filter((w) => w !== who);
  return writeRecord({ ...record, coOwners });
};

/**
 * Is this request from this computer's own desk — a loopback peer, no
 * forwarding, a loopback Host (remote/access-scope.js) — never a paired phone
 * or a tunnel? The app-level gate stamps the scope; a router mounted without
 * it is judged by the same decision. impure (reads the remote store's cache).
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export const isLocalDesk = (req) => (req.accessScope ?? upgradeAccess(req).scope) === 'local';

/**
 * The caller's standing on this machine. impure (fs).
 * @param {import('express').Request} req - after requireAuth
 * @returns {Promise<'owner'|'co-owner'|'guest'|'unowned'>}
 */
export const machineStanding = async (req) => standingIn(await readInstallOwner(), req.walletAddress);

// impure (fs) — the record as a request sees it: the first-owner seat is open
// only at this computer's own desk, and only with the owner claim
const recordFor = (req) => (isLocalDesk(req) ? ownerOrClaim(req.walletAddress, claimOf(req)) : readInstallOwner());

/**
 * The caller's standing, where a wallet at this computer's own desk on an
 * install no one owns yet becomes its owner with the owner claim — the
 * sign-in's first-local rule, for a desk whose session began before the rule.
 * impure (fs).
 * @param {import('express').Request} req - after requireAuth
 * @returns {Promise<'owner'|'co-owner'|'guest'|'unowned'>}
 */
export const deskStanding = async (req) => standingIn(await recordFor(req), req.walletAddress);

/**
 * Would the owner gate let this request change the machine? The same rule as
 * requireInstallOwnerOf, as a yes/no, for a house's own act that touches a
 * machine store only as a side effect (a project opening its folder in the
 * explorer): the house's act proceeds, the machine part only for the owner.
 * impure (fs).
 * @param {import('express').Request} req - after requireAuth
 * @returns {Promise<boolean>}
 */
export const passesInstallOwner = async (req) => isLocalDesk(req)
  && ['owner', 'co-owner'].includes(standingIn(await recordFor(req), req.walletAddress));

/**
 * The gate on every machine-wide change: the caller is the owner or a
 * co-owner AND is at this computer's own desk. On an install no one owns yet,
 * the first local wallet with the owner claim becomes its owner here too.
 * Guests get a 403 that says why — never a silent no-op. impure (fs).
 * @param {{ownerOnly?: boolean}} [opts] - co-owners refused too
 */
export const requireInstallOwnerOf = ({ ownerOnly = false } = {}) => async (req, res, next) => {
  try {
    if (!isLocalDesk(req)) return res.status(403).json({ error: DESK_REFUSAL, code: 'INSTALL_OWNER_DESK_ONLY' });
    const standing = standingIn(await recordFor(req), req.walletAddress);
    if (standing === 'owner' || (standing === 'co-owner' && !ownerOnly)) return next();
    if (standing === 'unowned') return res.status(403).json({ error: UNCLAIMED_REFUSAL, code: 'INSTALL_OWNER_UNCLAIMED', standing });
    log.info('machine change refused to a guest', { wallet: lower(req.walletAddress), method: req.method, path: req.originalUrl });
    return res.status(403).json({ error: GUEST_REFUSAL, code: 'INSTALL_OWNER_ONLY', standing });
  } catch (error) {
    log.error('install owner check failed', { error: error.message });
    return res.status(500).json({ error: 'Could not tell who owns this computer — nothing was changed' });
  }
};

export const requireInstallOwner = requireInstallOwnerOf();
