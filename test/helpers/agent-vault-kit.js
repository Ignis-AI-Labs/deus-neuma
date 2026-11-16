import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { ethers } from 'ethers';
import {
  BASE_AGENT_VAULT, SAFE_ABI, SAFE_FACTORY_ABI, ROLES_ABI, VAULT_ERC20_ABI,
} from '../../backend/services/agent-vault/contracts.js';

// impure — an ephemeral Base fork, never a public broadcaster.
export const startVaultFork = async () => {
  const upstream = process.env.NEUMA_BASE_FORK_RPC_URL || 'https://mainnet.base.org';
  const child = spawn('anvil', ['--fork-url', upstream, '--chain-id', '8453', '--port', '0', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('vault fork did not start')), 60000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`vault fork exited ${code}`)); });
    child.stdout.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-32768);
      const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.stderr.resume();
  });
  child.stdout.resume();
  return {
    url,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
  };
};

// impure — a Safe proxy initialized by the real canonical factory.
export const deploySafe = async ({ provider, owner }) => {
  const safe = new ethers.Interface(SAFE_ABI);
  const initializer = safe.encodeFunctionData('setup', [[owner.address], 1n, ethers.ZeroAddress, '0x', ethers.ZeroAddress, ethers.ZeroAddress, 0n, ethers.ZeroAddress]);
  const factory = new ethers.Contract(BASE_AGENT_VAULT.safeProxyFactory, SAFE_FACTORY_ABI, owner.connect(provider));
  const receipt = await (await factory.createProxy(BASE_AGENT_VAULT.safeSingleton, initializer, { gasLimit: 8_000_000n })).wait();
  if (receipt.status !== 1) throw new Error('Safe deployment failed');
  for (const log of receipt.logs) {
    try {
      const event = factory.interface.parseLog(log);
      if (event?.name === 'ProxyCreation') return new ethers.Contract(event.args.proxy, SAFE_ABI, provider);
    } catch { /* another factory log */ }
  }
  throw new Error('Safe proxy address was not emitted');
};

// impure — a minimal proxy of the canonical Roles master copy, initialized for this Safe.
export const deployRoles = async ({ provider, owner, safe }) => {
  const implementation = BASE_AGENT_VAULT.rolesMastercopy.slice(2).toLowerCase();
  const creation = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation}5af43d82803e903d91602b57fd5bf3`;
  const deployed = await (await owner.connect(provider).sendTransaction({ data: creation, gasLimit: 2_000_000n })).wait();
  if (deployed.status !== 1 || !deployed.contractAddress) throw new Error('Roles proxy deployment failed');
  const roles = new ethers.Contract(deployed.contractAddress, ROLES_ABI, provider);
  const avatar = await safe.getAddress();
  const initialized = await (await roles.connect(owner.connect(provider)).setUp(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address'], [owner.address, avatar, avatar]), { gasLimit: 3_000_000n })).wait();
  if (initialized.status !== 1) throw new Error('Roles initialization failed');
  return roles;
};

const ownerSignature = async (owner, hash) => {
  const signature = ethers.Signature.from(await owner.signMessage(ethers.getBytes(hash)));
  return ethers.concat([signature.r, signature.s, ethers.toBeHex(signature.v + 4, 1)]);
};

const minedReceipt = async (sent) => {
  try {
    return await sent.wait();
  } catch (error) {
    if (error.receipt) return error.receipt;
    throw error;
  }
};

// impure — execute an owner-approved Safe call with Safe's real EIP-712/eth-sign verification.
export const execSafeTransaction = async ({ safe, owner, relayer = owner, to, data, value = 0n, operation = 0 }) => {
  const nonce = await safe.nonce();
  const hash = await safe.getTransactionHash(to, value, data, operation, 0n, 0n, 0n, ethers.ZeroAddress, ethers.ZeroAddress, nonce);
  const signatures = await ownerSignature(owner, hash);
  const senderNonce = await relayer.provider.send('eth_getTransactionCount', [relayer.address, 'pending']);
  const sent = await safe.connect(relayer).execTransaction(to, value, data, operation, 0n, 0n, 0n, ethers.ZeroAddress, ethers.ZeroAddress, signatures, { nonce: senderNonce, gasLimit: 8_000_000n });
  return minedReceipt(sent);
};

// impure — always send to the fork so hostile calls produce real mined reverts.
export const executeAgentTransaction = async ({ agent, to, data }) => {
  const nonce = await agent.provider.send('eth_getTransactionCount', [agent.address, 'pending']);
  const sent = await agent.sendTransaction({ to, data, nonce, gasLimit: 5_000_000n });
  return minedReceipt(sent);
};

// impure — test-only USDC inventory in the fork's actual USDC storage.
export const dealVaultUsdc = async ({ provider, holder, amount }) => {
  const token = new ethers.Contract(BASE_AGENT_VAULT.usdc, VAULT_ERC20_ABI, provider);
  for (let slot = 0; slot < 20; slot += 1) {
    const at = ethers.solidityPackedKeccak256(['uint256', 'uint256'], [holder, slot]);
    const prior = await provider.send('eth_getStorageAt', [BASE_AGENT_VAULT.usdc, at, 'latest']);
    await provider.send('anvil_setStorageAt', [BASE_AGENT_VAULT.usdc, at, ethers.toBeHex(amount, 32)]);
    if (await token.balanceOf(holder) === amount) return slot;
    await provider.send('anvil_setStorageAt', [BASE_AGENT_VAULT.usdc, at, prior]);
  }
  throw new Error('USDC balance slot was not found');
};
