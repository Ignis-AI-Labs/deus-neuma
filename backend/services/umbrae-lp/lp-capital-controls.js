import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { independentTokenPrice } from './lp-budget-independent.js';

export const MAX_CAPITAL_CONTROL_USD = 1_000_000;
const DEFAULTS = Object.freeze({
  version: 1,
  maxActionUsd: 25_000,
  dailyNotionalUsd: 50_000,
  privateBroadcastRequired: false,
  paused: false,
});
const fileFor = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-capital.json');
const validUsd = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CAPITAL_CONTROL_USD;
const dollars = (micro) => (micro / 1e6).toFixed(2);

const validate = (record) => {
  if (!validUsd(record?.maxActionUsd) || !validUsd(record?.dailyNotionalUsd)
      || typeof record?.privateBroadcastRequired !== 'boolean' || typeof record?.paused !== 'boolean') {
    throw new Error('LP capital controls are invalid');
  }
  if ((record.maxActionUsd > DEFAULTS.maxActionUsd || record.dailyNotionalUsd > DEFAULTS.dailyNotionalUsd)
      && !record.privateBroadcastRequired) {
    throw new Error('Raising the default capital limits requires private broadcast.');
  }
  return Object.freeze({
    version: 1,
    maxActionUsd: record.maxActionUsd,
    dailyNotionalUsd: record.dailyNotionalUsd,
    privateBroadcastRequired: record.privateBroadcastRequired,
    paused: record.paused,
  });
};

// impure — encrypted operator policy; a corrupt or plaintext record fails closed.
export const readLpCapitalControls = async (neumaId) => {
  try {
    const record = await neumaWorkspace._readTrustedJSON(fileFor(neumaId));
    return validate({ ...DEFAULTS, ...record });
  } catch (error) {
    if (error.code === 'ENOENT') return DEFAULTS;
    throw error;
  }
};

// impure — called only by the owner-gated route; preserves fields not being changed.
export const writeLpCapitalControls = async (neumaId, patch = {}) => {
  const current = await readLpCapitalControls(neumaId);
  const next = validate({
    ...current,
    ...Object.fromEntries(['maxActionUsd', 'dailyNotionalUsd', 'privateBroadcastRequired', 'paused']
      .filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]])),
  });
  await neumaWorkspace._writeJSON(fileFor(neumaId), next);
  await neumaWorkspace.audit(neumaId, 'LP_CAPITAL_CONTROLS_SET', next);
  return next;
};

// impure — pause new capital actions without blocking claims, withdrawals, or closes.
export const assertLpNotPaused = async (neumaId) => {
  const controls = await readLpCapitalControls(neumaId);
  return controls.paused ? { ok: false, reason: 'New LP capital actions are paused by the operator. Claims, withdrawals, and closes remain available.' } : { ok: true };
};

const assetMicro = async ({ token, amount, decimals }) => {
  const price = await independentTokenPrice(token);
  if (price === null) throw new Error('Independent token prices are unavailable or disagree, so the capital limit cannot be measured.');
  const priceMicro = BigInt(Math.ceil(price * 1e6));
  const raw = BigInt(amount);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || raw <= 0n) throw new Error('LP capital amount is invalid');
  const micro = (raw * priceMicro) / (10n ** BigInt(decimals));
  if (!Number.isSafeInteger(Number(micro)) || micro <= 0n) throw new Error('LP capital amount is invalid');
  return Number(micro);
};

// impure — independently price and durably reserve all assets in one capital action.
export const reserveCapitalAssets = async (neumaId, assets, { maxActionUsd = null } = {}) => {
  const allowed = await assertLpNotPaused(neumaId);
  if (!allowed.ok) return allowed;
  try {
    if (!Array.isArray(assets) || assets.length === 0) return { ok: false, reason: 'No capital amount was given.' };
    const parts = await Promise.all(assets.map(assetMicro));
    const micro = parts.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(micro)) return { ok: false, reason: 'The capital amount is invalid.' };
    const controls = await readLpCapitalControls(neumaId);
    const actionCap = maxActionUsd === null ? controls.maxActionUsd : Math.min(controls.maxActionUsd, maxActionUsd);
    if (micro > Math.round(actionCap * 1e6)) {
      return { ok: false, reason: `This action moves about $${dollars(micro)}, over the $${actionCap.toFixed(2)} per-action capital limit.` };
    }
    const day = new Date().toISOString().slice(0, 10);
    const reserved = await neumaWorkspace.consumeLpNotional(neumaId, {
      day, amountMicro: micro, capMicro: Math.round(controls.dailyNotionalUsd * 1e6),
    });
    if (reserved === null) {
      return { ok: false, reason: `This action would pass the $${controls.dailyNotionalUsd.toFixed(2)} daily capital-movement limit.` };
    }
    return { ok: true, notionalUsd: dollars(micro), day, reservation: reserved };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};
