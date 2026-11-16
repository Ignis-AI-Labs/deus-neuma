import process from 'node:process';
import fs from 'node:fs/promises';
import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { UMBRAE_ROUTER } from '../../core/wallet/trade-policy.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openLpWallet, lpSigner } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { signLpTransaction } from '../../backend/services/umbrae-lp/lp-signer.js';
import { registerAgentVault, readAgentVault } from '../../backend/services/agent-vault/vault-store.js';
import { callUmbrae } from '../../backend/services/umbrae-lp/umbrae-lp-client.js';
import {
  AGENT_ROLE_KEY, BASE_AGENT_VAULT, SAFE_ABI, ROLES_ABI, VAULT_ERC20_ABI,
} from '../../backend/services/agent-vault/contracts.js';
import {
  buildAgentVaultConfiguration, encodeAgentExecution, encodeAgentTokenTransfer,
  encodeAgentTokenApproval, encodeAgentRevocation,
} from '../../backend/services/agent-vault/roles-policy.js';
import {
  startVaultFork, deploySafe, deployRoles, execSafeTransaction,
  executeAgentTransaction, dealVaultUsdc,
} from '../helpers/agent-vault-kit.js';

const ASKED = process.env.NEUMA_AGENT_VAULT_FORK_PROOF === '1';
const LANE = 'vaulted-agent';
const WETH = '0x4200000000000000000000000000000000000006';
const TRANSFER_LIMIT = 100_000_000n;
const INITIAL_USDC = 1_000_000_000n;
let fork; let provider; let treasury; let agent; let attacker; let safe; let roles; let safeAddress; let rolesAddress; let usdc; let vault; let swapPool;
let root; let originalRoot; let connections; let rolesDeployedBlock; let rolesInitializedBlock;

const applyOwnerTransaction = async (transaction) => {
  const nonce = await provider.send('eth_getTransactionCount', [treasury.address, 'pending']);
  const receipt = await (await treasury.sendTransaction({ ...transaction, nonce, gasLimit: 5_000_000n })).wait();
  expect(receipt.status).toBe(1);
};
const agentCall = ({ to, data, value = 0n, operation = 0 }) => executeAgentTransaction({
  agent,
  ...encodeAgentExecution({ rolesAddress, to, data, value, operation }),
});
const safeCall = ({ to, data, owner = treasury }) => execSafeTransaction({
  safe, owner, relayer: owner, to, data,
});
const findSwapPool = async () => {
  const listed = await callUmbrae('pools');
  if (!listed.ok) throw new Error(listed.error);
  const candidates = (listed.payload?.groups ?? []).flatMap((group) => (group.pairs ?? []).map((pair) => ({
    address: pair.address,
    binStep: pair.bin_step,
    liquidity: Number(pair.liquidity) || 0,
    tokens: [pair.mint_x ?? group.mint_x, pair.mint_y ?? group.mint_y].map((address) => ethers.getAddress(address)),
  }))).filter((pair) => pair.tokens.includes(ethers.getAddress(BASE_AGENT_VAULT.usdc)) && pair.tokens.includes(WETH));
  const selected = candidates.sort((a, b) => b.liquidity - a.liquidity)[0];
  if (!selected) throw new Error('No live USDC/WETH route was found');
  return selected;
};

beforeAll(async () => {
  if (!ASKED) return;
  fork = await startVaultFork();
  provider = new ethers.JsonRpcProvider(fork.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 });
  root = await createTempDir('agent-vault-live');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  connections = connectionsOn(['umbrae-liquidity']);
  await workspace.create(LANE);
  await openLpWallet(LANE);
  agent = (await lpSigner(LANE)).connect(provider);
  treasury = ethers.Wallet.createRandom().connect(provider);
  attacker = ethers.Wallet.createRandom().connect(provider);
  for (const wallet of [treasury, agent]) {
    await provider.send('anvil_setBalance', [wallet.address, ethers.toQuantity(ethers.parseEther('1'))]);
  }
  safe = await deploySafe({ provider, owner: treasury });
  safeAddress = await safe.getAddress();
  roles = await deployRoles({ provider, owner: treasury, safe });
  rolesDeployedBlock = roles.deploymentBlock;
  rolesInitializedBlock = roles.initializedBlock;
  rolesAddress = await roles.getAddress();
  const enabled = await safeCall({
    to: safeAddress,
    data: new ethers.Interface(SAFE_ABI).encodeFunctionData('enableModule', [rolesAddress]),
  });
  expect(enabled.status).toBe(1);
  await provider.send('anvil_setBalance', [safeAddress, ethers.toQuantity(ethers.parseEther('1'))]);
  await dealVaultUsdc({ provider, holder: safeAddress, amount: INITIAL_USDC });
  usdc = new ethers.Contract(BASE_AGENT_VAULT.usdc, VAULT_ERC20_ABI, provider);
  swapPool = await findSwapPool();
  const configuration = buildAgentVaultConfiguration({
    rolesAddress, agent: agent.address, tokenAddress: BASE_AGENT_VAULT.usdc,
    treasury: treasury.address, router: UMBRAE_ROUTER,
    routes: [{ path: [BASE_AGENT_VAULT.usdc, WETH], binSteps: [swapPool.binStep], pools: [swapPool.address] }],
    transferLimit: TRANSFER_LIMIT, approvalLimit: 200_000_000n,
  });
  for (const transaction of configuration) await applyOwnerTransaction(transaction);
  vault = await registerAgentVault(LANE, { safe: safeAddress, roles: rolesAddress, treasury: treasury.address, rolesDeployedBlock, rolesInitializedBlock }, provider);
}, 180000);

afterAll(async () => {
  if (!ASKED) return;
  provider?.destroy();
  await fork?.stop();
  connections?.restore();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe.skipIf(!ASKED)('a compromised agent key against canonical Safe and Roles contracts on Base', () => {
  test('treasury owns the Safe and the Roles module is bound only to that avatar', async () => {
    expect(await safe.getOwners()).toEqual([treasury.address]);
    expect(await safe.getThreshold()).toBe(1n);
    expect(await safe.isModuleEnabled(rolesAddress)).toBe(true);
    expect(await roles.owner()).toBe(treasury.address);
    expect(await roles.avatar()).toBe(safeAddress);
    expect(await roles.getFunction('target()')()).toBe(safeAddress);
    expect(await usdc.balanceOf(safeAddress)).toBe(INITIAL_USDC);
    expect(await readAgentVault(LANE)).toMatchObject({ safe: safeAddress, roles: rolesAddress, treasury: treasury.address, agent: agent.address });
  });

  test('registration refuses a treasury that is not a Safe owner', async () => {
    await expect(registerAgentVault(LANE, { safe: safeAddress, roles: rolesAddress, treasury: attacker.address, rolesDeployedBlock, rolesInitializedBlock }, provider)).rejects.toThrow(/treasuryOwner/);
    expect((await readAgentVault(LANE)).treasury).toBe(treasury.address);
  });

  test('registration rejects a block without the Safe’s Roles deployment event', async () => {
    await expect(registerAgentVault(LANE, {
      safe: safeAddress, roles: rolesAddress, treasury: treasury.address, rolesDeployedBlock, rolesInitializedBlock: rolesInitializedBlock - 1,
    }, provider)).rejects.toThrow(/deployment event/);
  });

  test('registration refuses a Safe with an additional module and recovers after it is removed', async () => {
    const safeInterface = new ethers.Interface(SAFE_ABI);
    const enabled = await safeCall({ to: safeAddress, data: safeInterface.encodeFunctionData('enableModule', [attacker.address]) });
    expect(enabled.status).toBe(1);
    await expect(registerAgentVault(LANE, { safe: safeAddress, roles: rolesAddress, treasury: treasury.address, rolesDeployedBlock, rolesInitializedBlock }, provider)).rejects.toThrow(/onlyRolesModule/);
    const disabled = await safeCall({ to: safeAddress, data: safeInterface.encodeFunctionData('disableModule', ['0x0000000000000000000000000000000000000001', attacker.address]) });
    expect(disabled.status).toBe(1);
    expect(await safe.isModuleEnabled(attacker.address)).toBe(false);
  });

  test('registration rejects an additional active agent role and accepts once that role is revoked', async () => {
    const extraRole = ethers.id('unexpected-agent-role');
    const rolesInterface = new ethers.Interface(ROLES_ABI);
    await applyOwnerTransaction({ to: rolesAddress, data: rolesInterface.encodeFunctionData('assignRoles', [agent.address, [extraRole], [true]]) });
    await expect(registerAgentVault(LANE, { safe: safeAddress, roles: rolesAddress, treasury: treasury.address, rolesDeployedBlock, rolesInitializedBlock }, provider)).rejects.toThrow(/unexpectedAgentRole/);
    await applyOwnerTransaction({ to: rolesAddress, data: rolesInterface.encodeFunctionData('assignRoles', [agent.address, [extraRole], [false]]) });
    await expect(registerAgentVault(LANE, { safe: safeAddress, roles: rolesAddress, treasury: treasury.address, rolesDeployedBlock, rolesInitializedBlock }, provider)).resolves.toMatchObject({ safe: safeAddress });
  });

  test('an attacker recipient, ETH send, or delegate call is rejected without moving value', async () => {
    const before = await usdc.balanceOf(safeAddress);
    const tokenAttack = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: attacker.address, amount: 25_000_000n }),
    });
    expect(tokenAttack.status).toBe(0);
    const ethAttack = await agentCall({ to: attacker.address, data: '0x', value: 1n });
    expect(ethAttack.status).toBe(0);
    const delegateAttack = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 1n }),
      operation: 1,
    });
    expect(delegateAttack.status).toBe(0);
    expect(await usdc.balanceOf(safeAddress)).toBe(before);
    expect(await usdc.balanceOf(attacker.address)).toBe(0n);
  });

  test('a forged Safe owner signature cannot bypass the Roles boundary', async () => {
    const forged = await safeCall({
      owner: agent,
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: attacker.address, amount: 25_000_000n }),
    });
    expect(forged.status).toBe(0);
    expect(await usdc.balanceOf(attacker.address)).toBe(0n);
  });

  test('only treasury transfers execute and the on-chain allowance cannot be exceeded', async () => {
    const first = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 60_000_000n }),
    });
    expect(first.status).toBe(1);
    expect(await usdc.balanceOf(safeAddress)).toBe(940_000_000n);
    const overLimit = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 50_000_000n }),
    });
    expect(overLimit.status).toBe(0);
    const remainder = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 40_000_000n }),
    });
    expect(remainder.status).toBe(1);
    const exhausted = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 1n }),
    });
    expect(exhausted.status).toBe(0);
    expect(await usdc.balanceOf(safeAddress)).toBe(900_000_000n);
  });

  test('only the named router receives a bounded approval', async () => {
    const allowed = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenApproval({ router: UMBRAE_ROUTER, amount: 50_000_000n }),
    });
    expect(allowed.status).toBe(1);
    expect(await usdc.allowance(safeAddress, UMBRAE_ROUTER)).toBe(50_000_000n);
    const wrongSpender = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenApproval({ router: attacker.address, amount: 50_000_000n }),
    });
    expect(wrongSpender.status).toBe(0);
    const unlimited = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenApproval({ router: UMBRAE_ROUTER, amount: ethers.MaxUint256 }),
    });
    expect(unlimited.status).toBe(0);
    expect(await usdc.allowance(safeAddress, attacker.address)).toBe(0n);
  });

  test('Neuma signs a Roles-wrapped real Umbrae swap; recipient and route substitution are refused', async () => {
    const router = new ethers.Interface([
      'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,uint16[] binSteps,address[] pools,address to,uint256 deadline)',
      'function getDetailedSwapQuote(uint256 amountIn,address[] path,uint16[] binSteps,address[] pools) view returns (uint256 amountOut,uint256 consumedAmountIn,uint256[] feesPerHop,uint256 priceImpact,uint256[] amountsPerHop,uint24[] activeBinsPerPair,bool liquidityExhausted)',
    ]);
    const quoteData = router.encodeFunctionData('getDetailedSwapQuote', [2_000_000n, [BASE_AGENT_VAULT.usdc, WETH], [swapPool.binStep], [swapPool.address]]);
    const quote = router.decodeFunctionResult('getDetailedSwapQuote', await provider.call({ to: UMBRAE_ROUTER, data: quoteData }));
    expect(quote.amountOut).toBeGreaterThan(0n);
    const deadline = BigInt((await provider.getBlock('latest')).timestamp + 600);
    const transactionFor = (recipient, poolAddress = swapPool.address) => ({
      to: UMBRAE_ROUTER, chainId: 8453,
      data: router.encodeFunctionData('swapExactTokensForTokens', [2_000_000n, 1n, [BASE_AGENT_VAULT.usdc, WETH], [swapPool.binStep], [poolAddress], recipient, deadline]),
    });
    const asked = { kind: 'swap', tokenIn: BASE_AGENT_VAULT.usdc, tokenOut: WETH, amountIn: '2000000', amountOutMin: '1' };
    const tokens = new Set([BASE_AGENT_VAULT.usdc, WETH]);
    const signed = await signLpTransaction({
      signer: agent, provider, tx: transactionFor(safeAddress), asked, tokens,
      recipients: new Set([safeAddress]), vault,
    });
    expect(signed.ok, JSON.stringify(signed)).toBe(true);
    expect(ethers.Transaction.from(signed.signedTransaction).to).toBe(rolesAddress);
    const hash = await provider.send('eth_sendRawTransaction', [signed.signedTransaction]);
    const receipt = await provider.waitForTransaction(hash);
    expect(receipt.status).toBe(1);
    expect(await usdc.balanceOf(safeAddress)).toBe(898_000_000n);
    const weth = new ethers.Contract(WETH, VAULT_ERC20_ABI, provider);
    expect(await weth.balanceOf(safeAddress)).toBeGreaterThan(0n);
    const malicious = await signLpTransaction({
      signer: agent, provider, tx: transactionFor(attacker.address), asked, tokens,
      recipients: new Set([safeAddress]), vault,
    });
    expect(malicious.ok).toBe(false);
    expect(malicious.reason).toMatch(/wallet|recipient/i);
    const unknownRoute = await signLpTransaction({
      signer: agent, provider, tx: transactionFor(safeAddress, attacker.address), asked, tokens,
      recipients: new Set([safeAddress]), vault,
    });
    expect(unknownRoute.ok).toBe(false);
  }, 120000);

  test('the agent cannot grant itself ownership or assign a role to an attacker', async () => {
    const escalation = await executeAgentTransaction({
      agent,
      to: rolesAddress,
      data: new ethers.Interface(ROLES_ABI).encodeFunctionData('assignRoles', [attacker.address, [AGENT_ROLE_KEY], [true]]),
    });
    expect(escalation.status).toBe(0);
    expect(await roles.owner()).toBe(treasury.address);
  });

  test('treasury revokes the agent and recovers all remaining funds', async () => {
    await applyOwnerTransaction(encodeAgentRevocation({ rolesAddress, agent: agent.address }));
    const afterRevocation = await agentCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: 1n }),
    });
    expect(afterRevocation.status).toBe(0);
    const remaining = await usdc.balanceOf(safeAddress);
    const recovered = await safeCall({
      to: BASE_AGENT_VAULT.usdc,
      data: encodeAgentTokenTransfer({ tokenAddress: BASE_AGENT_VAULT.usdc, treasury: treasury.address, amount: remaining }),
    });
    expect(recovered.status).toBe(1);
    expect(await usdc.balanceOf(safeAddress)).toBe(0n);
  }, 120000);
});
