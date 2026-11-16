import { ethers } from 'ethers';

export const AGENT_ROLE_KEY = ethers.id('neuma-agent-v1');
export const BASE_AGENT_VAULT = Object.freeze({
  chainId: 8453,
  safeSingleton: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  safeL2Singleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
  safeProxyFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  rolesMastercopy: '0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5',
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
});

export const SAFE_ABI = Object.freeze([
  'function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)',
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)',
  'function enableModule(address module)',
  'function disableModule(address prevModule,address module)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)',
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
]);
export const SAFE_FACTORY_ABI = Object.freeze([
  'function createProxy(address singleton,bytes initializer) returns (address proxy)',
  'event ProxyCreation(address proxy,address singleton)',
]);
export const ROLES_ABI = Object.freeze([
  'function setUp(bytes initParams)',
  'function assignRoles(address module,bytes32[] roleKeys,bool[] memberOf)',
  'function getModulesPaginated(address start,uint256 pageSize) view returns (address[] array,address next)',
  'function scopeTarget(bytes32 roleKey,address targetAddress)',
  'function scopeFunction(bytes32 roleKey,address targetAddress,bytes4 selector,(uint8 parent,uint8 paramType,uint8 operator,bytes compValue)[] conditions,uint8 options)',
  'function setAllowance(bytes32 key,uint128 balance,uint128 maxRefill,uint128 refill,uint64 period,uint64 timestamp)',
  'function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool)',
  'function owner() view returns (address)',
  'function avatar() view returns (address)',
  'function target() view returns (address)',
]);
export const VAULT_ERC20_ABI = Object.freeze([
  'function transfer(address to,uint256 amount) returns (bool)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);
