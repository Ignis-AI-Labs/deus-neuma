/**
 * treasury kit — the real ground for the spend card and treasury suites:
 * two LOCAL chains (anvil answering as Base, chainId 8453, and as Ethereum,
 * chainId 1 — never a public network, never real funds), a temp workspaces
 * root and realm with every machine-wide office path pinned to tmp, the real
 * wallet / treasury / waiting routers on an express app, and real operator
 * wallets with real session tokens.
 *
 * A being here is a real lane: its key is anvil's own funded test account
 * (the public "test … junk" mnemonic), sealed under a password through the
 * real keypair vault, with a real allowlist and threshold on disk. Nothing on
 * any claimed path is mocked.
 */
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import { ethers } from 'ethers';
import { createTempDir } from './temp-fs.js';
import { claimOwner } from './claim-owner.js';
import { startAnvil } from './money-in-kit.js';
import { LEGACY_ENV } from './house-office-kit.js';

export const MNEMONIC = 'test test test test test test test test test test test junk';
export const PASSWORD = 'treasury-kit-password';

/** Anvil's funded test account `i` — public test keys only. */
export const testKey = (i) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);

const DOORS = [...Object.keys(LEGACY_ENV), 'NEUMA_WORKSPACE_SETTINGS_PATH', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'ETH_RPC_URL', 'BASE_MAINNET_RPC_URL'];

/**
 * Stand the treasury up. impure (tmp disk, process env, two anvil processes).
 * @param {string} label
 */
export const standTreasury = async (label) => {
  const saved = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  const tmp = await createTempDir(label);
  const root = path.join(tmp, 'workspaces');
  const settings = path.join(tmp, 'settings');
  await fs.mkdir(settings, { recursive: true });
  for (const [key, name] of Object.entries(LEGACY_ENV)) process.env[key] = path.join(settings, name);
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(settings, 'workspace.json');
  process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
  process.env.WORKSPACES_ROOT = root;
  process.env.NEUMA_REALM_ROOT = path.join(tmp, 'realm');

  const base = await startAnvil({ chainId: 8453 });
  const eth = await startAnvil({ chainId: 1 });
  process.env.BASE_MAINNET_RPC_URL = base.url;
  process.env.ETH_RPC_URL = eth.url;

  const { setRealmRoot, getRealmRoot } = await import('../../backend/services/user-realm.js');
  const workspaceModule = await import('../../core/workspace/neuma-workspace.js');
  const workspace = workspaceModule.default;
  const savedRoots = { realm: getRealmRoot(), lanes: workspaceModule.getWorkspacesRoot() };
  setRealmRoot(process.env.NEUMA_REALM_ROOT);
  workspaceModule.setWorkspacesRoot(root);
  const { loadConfig } = await import('../../backend/config.js');
  loadConfig({ ...process.env });
  const { resetChainProviders } = await import('../../backend/services/chain/chain-registry.js');
  resetChainProviders();
  const { createSessionToken } = await import('../../backend/services/auth.js');
  const { encryptKeypair } = await import('../../core/wallet/keypair-vault.js');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/neuma', (await import('../../backend/routes/neuma-wallet-routes.js')).default);
  app.use('/api/v1/treasury', (await import('../../backend/routes/treasury-routes.js')).default);
  app.use('/api/v1/waiting', (await import('../../backend/routes/waiting-routes.js')).default);

  /** A real operator (a house): a random wallet and its real session token. */
  const operator = () => {
    const wallet = ethers.Wallet.createRandom();
    return { wallet, address: wallet.address, house: wallet.address.toLowerCase(), auth: { Authorization: `Bearer ${createSessionToken(wallet.address)}` } };
  };

  /**
   * A being of `owner`'s house with a sealed key and a standing policy.
   * @param {{laneId: string, owner: object, keyIndex: number, recipients?: Array<{address: string, label?: string}>, thresholdEth?: number, name?: string}} b
   */
  const addBeing = async ({ laneId, owner, keyIndex, recipients = [], thresholdEth = 0, name = null }) => {
    const key = testKey(keyIndex);
    await workspace.create(laneId);
    await claimOwner(root, laneId, owner.address);
    if (name) {
      const ownerFile = path.join(root, laneId, 'owner.json');
      await fs.writeFile(ownerFile, JSON.stringify({ ...JSON.parse(await fs.readFile(ownerFile, 'utf8')), name }));
    }
    await workspace.writeEncryptedKeypair(laneId, encryptKeypair({ address: key.address, privateKey: key.privateKey }, PASSWORD));
    await workspace.writeSpendAllowlist(laneId, {
      version: 1,
      entries: recipients.map((r) => ({ address: r.address.toLowerCase(), label: r.label || '', addedAt: '2026-10-01T00:00:00.000Z' })),
    });
    await workspace.writeSpendThreshold(laneId, { thresholdEth });
    return { laneId, key, address: key.address };
  };

  // No read cache: a balance asked twice within ethers' default 250ms must be read twice.
  const baseProvider = new ethers.JsonRpcProvider(base.url, undefined, { cacheTimeout: -1 });
  const stop = async () => {
    baseProvider.destroy();
    setRealmRoot(savedRoots.realm);
    workspaceModule.setWorkspacesRoot(savedRoots.lanes);
    for (const k of DOORS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    loadConfig(process.env);
    resetChainProviders();
    await base.stop();
    await eth.stop();
    await fs.rm(tmp, { recursive: true, force: true });
  };

  return { app, root, workspace, base, eth, baseProvider, operator, addBeing, stop };
};
