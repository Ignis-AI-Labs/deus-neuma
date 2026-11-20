import { describe, expect, test } from 'vitest';
import { actionHash } from '../../backend/services/umbrae-lp/lp-executions.js';
import { failedOutcome } from '../../backend/services/intents/lp-acts.js';

const tx = { to: '0x0000000000000000000000000000000000000001' };
const asked = {
  kind: 'deposit', action: 'open', tokenId: null,
  tokenX: '0x0000000000000000000000000000000000000002',
  tokenY: '0x0000000000000000000000000000000000000003',
  amountX: '10', amountY: '20', activeIdDesired: 100, minTotalLiquidity: '50',
};

describe('LP request identity and ambiguous outcomes', () => {
  test('fresh quote fields do not change the requested action hash', () => {
    const first = actionHash(tx, asked);
    expect(actionHash(tx, { ...asked, activeIdDesired: 200, minTotalLiquidity: '75' })).toBe(first);
    expect(actionHash(tx, { ...asked, amountY: '21' })).not.toBe(first);
  });

  test('swap floors change but requested amounts do, and withdrawal bps stay bound', () => {
    const swap = { kind: 'swap', tokenIn: asked.tokenX, tokenOut: asked.tokenY, amountIn: '10', amountOutMin: '4' };
    expect(actionHash(tx, { ...swap, amountOutMin: '5' })).toBe(actionHash(tx, swap));
    expect(actionHash(tx, { ...swap, amountIn: '11' })).not.toBe(actionHash(tx, swap));
    const exit = { kind: 'exit', tokenId: '7', bps: 2500, amountXMin: '1', amountYMin: '2' };
    expect(actionHash(tx, { ...exit, amountXMin: '3', amountYMin: '4' })).toBe(actionHash(tx, exit));
    expect(actionHash(tx, { ...exit, bps: 5000 })).not.toBe(actionHash(tx, exit));
  });

  test('intent failure shaping preserves uncertain state and transaction hash', () => {
    expect(failedOutcome({ uncertain: true, txHash: '0xabc' }, 'reconcile first')).toEqual({
      ok: false, uncertain: true, txHash: '0xabc', reason: 'reconcile first',
    });
    expect(failedOutcome({ uncertain: false }, 'ordinary failure')).toEqual({ ok: false, reason: 'ordinary failure' });
  });
});
