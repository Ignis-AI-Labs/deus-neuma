import { ethers } from 'ethers';
import { c, normalizeCondition, flattenCondition, encodeKey } from 'zodiac-roles-sdk';
import { AGENT_ROLE_KEY, ROLES_ABI, VAULT_ERC20_ABI } from './contracts.js';

const roles = new ethers.Interface(ROLES_ABI);
const token = new ethers.Interface(VAULT_ERC20_ABI);
const validLimit = (value) => typeof value === 'bigint' && value > 0n;
const validAddress = (value) => ethers.isAddress(value) && ethers.getAddress(value) !== ethers.ZeroAddress;

const scopedFunction = ({ rolesAddress, targetAddress, signature, abiTypes, scopings, condition: customCondition }) => {
  const condition = customCondition ? customCondition() : c.calldataMatches(scopings, abiTypes)();
  const conditions = flattenCondition(normalizeCondition(condition)).map((entry) => ({
    parent: entry.parent,
    paramType: entry.paramType,
    operator: entry.operator,
    compValue: entry.compValue ?? '0x',
  }));
  return {
    to: rolesAddress,
    data: roles.encodeFunctionData('scopeFunction', [
      AGENT_ROLE_KEY, targetAddress, ethers.id(signature).slice(0, 10), conditions, 0,
    ]),
  };
};

/** Owner transactions that install one treasury-bounded agent role. Pure. */
export const buildAgentVaultConfiguration = ({
  rolesAddress, agent, tokenAddress, treasury, router, routes, transferLimit, approvalLimit, period = 86400,
}) => {
  const validRoute = (route) => Array.isArray(route?.path) && route.path.length > 1
    && route.path.every(validAddress) && Array.isArray(route.pools) && route.pools.every(validAddress)
    && Array.isArray(route.binSteps) && route.binSteps.every((step) => Number.isInteger(step) && step >= 0)
    && route.pools.length === route.path.length - 1 && route.binSteps.length === route.pools.length;
  if (![rolesAddress, agent, tokenAddress, treasury, router].every(validAddress)
      || !Array.isArray(routes) || routes.length === 0 || routes.length > 16 || !routes.every(validRoute)
      || !validLimit(transferLimit) || !validLimit(approvalLimit)
      || !Number.isSafeInteger(period) || period <= 0) {
    throw new Error('Agent vault configuration is invalid');
  }
  const transferAllowance = 'neuma-agent-treasury-transfer';
  const approvalAllowance = 'neuma-agent-router-approval';
  const swapTypes = ['uint256', 'uint256', 'address[]', 'uint16[]', 'address[]', 'address', 'uint256'];
  const routeConditions = routes.map((route) => c.calldataMatches([
    undefined, undefined, route.path, route.binSteps, route.pools, c.avatar, undefined,
  ], swapTypes));
  return [
    { to: rolesAddress, data: roles.encodeFunctionData('scopeTarget', [AGENT_ROLE_KEY, tokenAddress]) },
    scopedFunction({
      rolesAddress, targetAddress: tokenAddress,
      signature: 'transfer(address,uint256)', abiTypes: ['address', 'uint256'],
      scopings: [treasury, c.withinAllowance(transferAllowance)],
    }),
    scopedFunction({
      rolesAddress, targetAddress: tokenAddress,
      signature: 'approve(address,uint256)', abiTypes: ['address', 'uint256'],
      scopings: [router, c.withinAllowance(approvalAllowance)],
    }),
    { to: rolesAddress, data: roles.encodeFunctionData('scopeTarget', [AGENT_ROLE_KEY, router]) },
    scopedFunction({
      rolesAddress, targetAddress: router,
      signature: 'swapExactTokensForTokens(uint256,uint256,address[],uint16[],address[],address,uint256)',
      abiTypes: swapTypes,
      condition: routeConditions.length === 1 ? routeConditions[0] : c.or(...routeConditions),
    }),
    { to: rolesAddress, data: roles.encodeFunctionData('setAllowance', [encodeKey(transferAllowance), transferLimit, transferLimit, transferLimit, period, 0]) },
    { to: rolesAddress, data: roles.encodeFunctionData('setAllowance', [encodeKey(approvalAllowance), approvalLimit, approvalLimit, approvalLimit, period, 0]) },
    { to: rolesAddress, data: roles.encodeFunctionData('assignRoles', [agent, [AGENT_ROLE_KEY], [true]]) },
  ];
};

/** Encode the only path through which the agent may make the Safe act. Pure. */
export const encodeAgentExecution = ({ rolesAddress, to, data, value = 0n, operation = 0 }) => ({
  to: rolesAddress,
  data: roles.encodeFunctionData('execTransactionWithRole', [to, value, data, operation, AGENT_ROLE_KEY, true]),
});

export const encodeAgentTokenTransfer = ({ tokenAddress, treasury, amount }) => token.encodeFunctionData('transfer', [treasury, amount]);
export const encodeAgentTokenApproval = ({ router, amount }) => token.encodeFunctionData('approve', [router, amount]);
export const encodeAgentRevocation = ({ rolesAddress, agent }) => ({
  to: rolesAddress,
  data: roles.encodeFunctionData('assignRoles', [agent, [AGENT_ROLE_KEY], [false]]),
});
