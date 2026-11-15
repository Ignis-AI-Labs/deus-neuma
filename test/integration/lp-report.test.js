/**
 * What the operator hears about a house member's LP wallet
 * (backend/services/umbrae-lp/lp-report.js), over REAL parts (RULE 0): a real
 * claimed workspace, the real notification bus writing the operator's real
 * notification log, a real chain node (anvil as chain 8453) and a real HTTP
 * listener in Umbrae's place.
 */
import process from 'node:process';
import fs from 'node:fs/promises';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { resetChainProviders } from '../../backend/services/chain/chain-registry.js';
import { _resetConfig } from '../../backend/config.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { writeLpBudget } from '../../backend/services/umbrae-lp/lp-budget.js';
import { runLpAction } from '../../backend/services/umbrae-lp/lp-run.js';
import { reportLpDay, REPORT_HOUR } from '../../backend/services/umbrae-lp/lp-report.js';

const ACTIVE = 'lpreportactive';
const IDLE = 'lpreportidle';
const OWNER = ethers.Wallet.createRandom().address;
let root, realm, originalRoot, priorRealm, anvil, provider, umbrae, connections;
const priorRpc = process.env.BASE_MAINNET_RPC_URL;
const at = (day, hour) => new Date(2026, 10, day, hour, 0).getTime();
const cards = async (kind) => (await readNotifications(OWNER, { limit: 50 })).records.filter((r) => r.kind === kind);

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  process.env.BASE_MAINNET_RPC_URL = anvil.url;
  _resetConfig();
  resetChainProviders();
  root = await createTempDir('lp-report');
  realm = await createTempDir('lp-report-realm');
  originalRoot = getWorkspacesRoot();
  priorRealm = getRealmRoot();
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  for (const id of [ACTIVE, IDLE]) {
    await workspace.create(id);
    await claimOwner(root, id, OWNER);
  }
  const { address } = await openLpWallet(ACTIVE);
  await openLpWallet(IDLE);
  await provider.send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther('1'))]);
  umbrae = await startUmbraeStandIn({ provider });
}, 30000);

afterAll(async () => {
  connections?.restore();
  await umbrae?.close();
  if (priorRpc === undefined) delete process.env.BASE_MAINNET_RPC_URL; else process.env.BASE_MAINNET_RPC_URL = priorRpc;
  _resetConfig();
  resetChainProviders();
  provider?.destroy();
  await anvil?.stop();
  setWorkspacesRoot(originalRoot);
  setRealmRoot(priorRealm);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(realm, { recursive: true, force: true });
});

beforeEach(() => {
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity']);
});

describe('the operator hears about the LP wallet', () => {
  test('a deposit past the budget sends one card at once, naming the amount', async () => {
    await writeLpBudget(ACTIVE, 0);
    const out = await runLpAction(ACTIVE, { type: 'open', pool: POOL, amountY: '30' }, { provider, pollMs: 50 });
    expect(out.pending).toBe(true);
    const [card] = await cards('lp_waiting');
    expect(card.title).toBe(`${ACTIVE} asks to put $30.0 into a liquidity position`);
    expect(card.detail).toBe('This deposit of $30.0 would take the total past the $0 budget. APPROVE or DECLINE in WALLET › LIQUIDITY within a day.');
    expect(card.actor).toEqual({ id: ACTIVE, name: ACTIVE });
    expect(card.standing).toBe('neuma');
    expect(card.ref.neumaId).toBe(ACTIVE);
  }, 60000);

  test('before the report hour nothing is written; after it, one card for the active house member and none for the idle one', async () => {
    await writeLpBudget(ACTIVE, 100);
    await runLpAction(ACTIVE, { type: 'claim', pool: POOL, tokenId: '42' }, { provider, pollMs: 50 });
    umbrae.state.positions = [{ lbPairAddress: POOL, positions: { userPositions: [{ publicKey: '42', positionData: { lowerBinId: 1, upperBinId: 9, totalXAmount: '0', totalYAmount: '20', feeX: '0', feeY: '0.4' } }], activeBin: { binId: 12 } }, poolInfo: { name: 'WETH-USDC', tokenXPriceUsd: 3200, tokenYPriceUsd: 1 } }];

    expect(await reportLpDay(at(20, REPORT_HOUR - 1))).toEqual([]);
    expect(await reportLpDay(at(20, REPORT_HOUR))).toEqual([ACTIVE]);
    const [card] = await cards('lp_report');
    expect(card.title).toBe(`${ACTIVE}: 1 liquidity position(s), 1 out of range, $0.40 in fees waiting`);
    expect(card.detail).toMatch(/^1 action\(s\) since the last report · 1 deposit\(s\) for \$30\.00 wait for you · cap \$100 · gas 0\.9\d{3} ETH$/);
    expect(card.title.length).toBeLessThanOrEqual(140);
    expect(card.detail.length).toBeLessThanOrEqual(140);
  }, 60000);

  test('the same day is reported once; the next day reports only what is new', async () => {
    expect(await reportLpDay(at(20, 18))).toEqual([]);
    expect(await cards('lp_report')).toHaveLength(1);
    expect(await reportLpDay(at(21, REPORT_HOUR))).toEqual([ACTIVE]);
    const [latest] = await cards('lp_report');
    expect(latest.detail).toMatch(/^0 action\(s\) since the last report/);
  }, 60000);
});
