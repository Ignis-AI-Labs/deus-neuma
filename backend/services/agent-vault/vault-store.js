import path from 'node:path';
import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { lpSigner, lpWalletAddress } from '../umbrae-lp/lp-wallet.js';
import { AGENT_ROLE_KEY, BASE_AGENT_VAULT, SAFE_ABI, ROLES_ABI } from './contracts.js';

const MAX_ROLE_HISTORY_BLOCKS = 200_000;
const fileFor = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'agent-vault.json');
const validAddress = (value) => typeof value === 'string' && ethers.isAddress(value) && ethers.getAddress(value) !== ethers.ZeroAddress;
const validBlock = (value) => Number.isSafeInteger(value) && value > 0;

// impure — the lane's encrypted Safe/Roles binding, or null when not configured.
export const readAgentVault = async (neumaId) => {
  try {
    const record = await neumaWorkspace._readTrustedJSON(fileFor(neumaId));
    if (record?.version !== 1 || ![record.safe, record.roles, record.treasury, record.agent].every(validAddress)
        || !validBlock(record.rolesDeployedBlock) || !validBlock(record.rolesInitializedBlock)) {
      throw new Error('Agent vault record is invalid');
    }
    return Object.freeze(record);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

// impure — replay the dedicated proxy's assignments and reject every active role except ours.
const verifyRoleHistory = async ({ modifier, safe, rolesDeployedBlock, rolesInitializedBlock, agent }) => {
  const latest = Number(BigInt(await modifier.runner.provider.send('eth_blockNumber', [])));
  if (!validBlock(rolesDeployedBlock) || !validBlock(rolesInitializedBlock)
      || rolesInitializedBlock < rolesDeployedBlock || rolesInitializedBlock > latest
      || latest - rolesDeployedBlock > MAX_ROLE_HISTORY_BLOCKS) {
    throw new Error('Roles deployment blocks are invalid or too old; deploy a dedicated vault');
  }
  const previousCode = await modifier.runner.provider.getCode(await modifier.getAddress(), rolesDeployedBlock - 1);
  if (previousCode !== '0x') throw new Error('Roles contract already existed before its claimed deployment block');
  const deployments = await modifier.queryFilter('RolesModSetup', rolesInitializedBlock, rolesInitializedBlock);
  if (deployments.length !== 1
      || ethers.getAddress(deployments[0].args.avatar) !== ethers.getAddress(safe)
      || ethers.getAddress(deployments[0].args.target) !== ethers.getAddress(safe)) {
    throw new Error('Roles deployment event was not found at the claimed block for this Safe');
  }
  const logs = await modifier.runner.provider.getLogs({
    address: await modifier.getAddress(), fromBlock: rolesDeployedBlock, toBlock: latest,
  });
  const events = logs.map((log) => {
    try {
      return modifier.interface.parseLog(log);
    } catch {
      return null;
    }
  }).filter((event) => event?.name === 'AssignRoles');
  const active = new Set();
  const wanted = agent.toLowerCase();
  for (const event of events) {
    const { module, roleKeys, memberOf } = event.args;
    if (module.toLowerCase() !== wanted) continue;
    for (let index = 0; index < roleKeys.length; index += 1) {
      if (memberOf[index]) active.add(roleKeys[index].toLowerCase());
      else active.delete(roleKeys[index].toLowerCase());
    }
  }
  if (active.size !== 1 || !active.has(AGENT_ROLE_KEY.toLowerCase())) {
    throw new Error(`unexpectedAgentRole: ${[...active].join(',')}`);
  }
};

// impure — reads the actual Safe and Roles state before a binding can be stored.
export const verifyAgentVault = async ({ provider, safe, roles, treasury, agent, rolesDeployedBlock, rolesInitializedBlock }) => {
  if (!provider || ![safe, roles, treasury, agent].every(validAddress)) throw new Error('Agent vault addresses are invalid');
  const account = new ethers.Contract(safe, SAFE_ABI, provider);
  const modifier = new ethers.Contract(roles, ROLES_ABI, provider);
  const [safeCode, rolesCode, owners, threshold, enabled, owner, avatar, storage, modules, roleModules] = await Promise.all([
    provider.getCode(safe), provider.getCode(roles), account.getOwners(), account.getThreshold(),
    account.isModuleEnabled(roles), modifier.owner(), modifier.avatar(), provider.getStorage(safe, 0),
    account.getModulesPaginated('0x0000000000000000000000000000000000000001', 50),
    modifier.getModulesPaginated('0x0000000000000000000000000000000000000001', 50),
  ]);
  const target = await modifier.getFunction('target()')();
  const singleton = ethers.getAddress(`0x${storage.slice(-40)}`);
  const moduleList = modules[0];
  const roleModuleList = roleModules[0];
  const checks = {
    safeCode: safeCode !== '0x', rolesCode: rolesCode !== '0x',
    safeImplementation: [BASE_AGENT_VAULT.safeSingleton, BASE_AGENT_VAULT.safeL2Singleton].map(ethers.getAddress).includes(singleton),
    rolesImplementation: rolesCode.toLowerCase().includes(BASE_AGENT_VAULT.rolesMastercopy.slice(2).toLowerCase()),
    treasuryOwner: owners.some((address) => ethers.getAddress(address) === ethers.getAddress(treasury)),
    threshold: threshold > 0n, moduleEnabled: enabled,
    onlyRolesModule: moduleList.length === 1 && ethers.getAddress(moduleList[0]) === ethers.getAddress(roles),
    onlyAgentRoleModule: roleModuleList.length === 1 && ethers.getAddress(roleModuleList[0]) === ethers.getAddress(agent),
    rolesOwner: [treasury, safe].map(ethers.getAddress).includes(ethers.getAddress(owner)),
    avatar: ethers.getAddress(avatar) === ethers.getAddress(safe),
    target: ethers.getAddress(target) === ethers.getAddress(safe),
    agentNotOwner: !owners.some((address) => ethers.getAddress(address) === ethers.getAddress(agent)),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw new Error(`Agent vault verification failed: ${failed.join(', ')}`);
  await verifyRoleHistory({ modifier, safe, rolesDeployedBlock, rolesInitializedBlock, agent });
  return { ...checks, roleHistory: true };
};

// impure — owner-route registration; the session key must be this lane's LP key.
export const registerAgentVault = async (neumaId, { safe, roles, treasury, rolesDeployedBlock, rolesInitializedBlock }, provider) => {
  const signer = await lpSigner(neumaId);
  if (!signer) throw new Error('Open the LP wallet before registering its vault.');
  await verifyAgentVault({ provider, safe, roles, treasury, agent: signer.address, rolesDeployedBlock, rolesInitializedBlock });
  const record = Object.freeze({
    version: 1, chainId: 8453, rolesDeployedBlock, rolesInitializedBlock,
    safe: ethers.getAddress(safe), roles: ethers.getAddress(roles),
    treasury: ethers.getAddress(treasury), agent: ethers.getAddress(signer.address),
    registeredAt: new Date().toISOString(),
  });
  await neumaWorkspace._writeJSON(fileFor(neumaId), record);
  await neumaWorkspace.audit(neumaId, 'AGENT_VAULT_REGISTERED', { safe: record.safe, roles: record.roles, treasury: record.treasury });
  return record;
};

// impure — the address whose balances and positions the LP wallet actually uses.
export const lpFundsAddress = async (neumaId) => (await readAgentVault(neumaId))?.safe ?? lpWalletAddress(neumaId);
