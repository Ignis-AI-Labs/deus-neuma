import { test, expect } from 'vitest';
import { ethers } from 'ethers';
import { AGENT_ROLE_KEY, ROLES_ABI } from '../../backend/services/agent-vault/contracts.js';
import { buildAgentVaultConfiguration, encodeAgentExecution } from '../../backend/services/agent-vault/roles-policy.js';

const addresses = {
  rolesAddress: '0x1000000000000000000000000000000000000001',
  agent: '0x1000000000000000000000000000000000000002',
  tokenAddress: '0x1000000000000000000000000000000000000003',
  treasury: '0x1000000000000000000000000000000000000004',
  router: '0x1000000000000000000000000000000000000005',
};
const weth = '0x1000000000000000000000000000000000000006';
const firstPool = '0x1000000000000000000000000000000000000007';
const secondPool = '0x1000000000000000000000000000000000000008';
const routes = [
  { path: [addresses.tokenAddress, weth], binSteps: [10], pools: [firstPool] },
  { path: [addresses.tokenAddress, weth], binSteps: [25], pools: [secondPool] },
];
const config = (extra = {}) => ({ ...addresses, routes, transferLimit: 100n, approvalLimit: 200n, ...extra });

test('multiple approved routes are encoded as an on-chain OR, never an unpinned wildcard', () => {
  const roles = new ethers.Interface(ROLES_ABI);
  const calls = buildAgentVaultConfiguration(config());
  const routerScope = calls.map((call) => {
    if (!call.data.startsWith(roles.getFunction('scopeFunction').selector)) return null;
    return roles.decodeFunctionData('scopeFunction', call.data);
  }).find((args) => args?.targetAddress === addresses.router);
  expect(routerScope.conditions[0].operator).toBe(2n);
  expect(routerScope.roleKey).toBe(AGENT_ROLE_KEY);
  expect(routerScope.conditions.length).toBeGreaterThan(10);
});

test('missing or malformed route pins refuse configuration', () => {
  expect(() => buildAgentVaultConfiguration(config({ routes: [] }))).toThrow(/invalid/);
  expect(() => buildAgentVaultConfiguration(config({ routes: [{ path: [addresses.tokenAddress, weth], binSteps: [], pools: [firstPool] }] }))).toThrow(/invalid/);
  expect(() => buildAgentVaultConfiguration(config({ routes: [{ path: [addresses.tokenAddress, weth], binSteps: [10], pools: [ethers.ZeroAddress] }] }))).toThrow(/invalid/);
});

test('agent execution preserves the inner call and binds the restricted role', () => {
  const roles = new ethers.Interface(ROLES_ABI);
  const encoded = encodeAgentExecution({ rolesAddress: addresses.rolesAddress, to: addresses.tokenAddress, data: '0x12345678' });
  const decoded = roles.decodeFunctionData('execTransactionWithRole', encoded.data);
  expect(encoded.to).toBe(addresses.rolesAddress);
  expect(decoded.to).toBe(addresses.tokenAddress);
  expect(decoded.data).toBe('0x12345678');
  expect(decoded.roleKey).toBe(AGENT_ROLE_KEY);
  expect(decoded.shouldRevert).toBe(true);
});
