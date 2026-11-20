/**
 * A real HTTP listener in KyberSwap's aggregator's place (RULE 0: no mocked
 * fetch): the two calls lp-aggregator.js makes, answered in KyberSwap's own
 * shape (read live 2026-11-13: {code: 0, data: {routeSummary}} and
 * {code: 0, data: {routerAddress, data, transactionValue, amountOut}}), the
 * swap call built with the router's own ABI. Modes play a KyberSwap that
 * misbehaves, so the signing rule's refusals are proven against an answer it
 * did not write: payment/fee/router/floor changes, wrong executor/source/flag,
 * approval-target and simple-mode variants, plus 'down'.
 */
import process from 'node:process';
import http from 'node:http';
import { URL } from 'node:url';
import { Interface } from 'ethers';
import { KYBER_ROUTER, KYBER_ABI } from '../../core/wallet/aggregator-policy.js';

export const THIEF = '0x2222222222222222222222222222222222222222';
const EXECUTOR = '0x8F10B468b06c6FD214B65F87778827F7D113f996';
const KYBER = new Interface(KYBER_ABI);

/**
 * @param {{amountOut?: bigint}} [opts] - what every route pays out (raw)
 * @returns {Promise<{seen: Array<{url: string, body: object}>, state: {mode: string, amountOut: bigint}, reset: () => void, close: () => Promise<void>}>}
 */
export const startKyberStandIn = async ({ amountOut = 1000n } = {}) => {
  const seen = [];
  const state = { mode: 'honest', amountOut };
  const answer = (url, body) => {
    if (state.mode === 'down') return { status: 500, body: { code: 4000, message: 'route not found' } };
    if (url.startsWith('/base/api/v1/routes?')) {
      const q = new URL(url, 'http://x').searchParams;
      return { status: 200, body: { code: 0, message: 'successfully', data: { routerAddress: KYBER_ROUTER, routeSummary: {
        tokenIn: q.get('tokenIn'), tokenOut: q.get('tokenOut'), amountIn: q.get('amountIn'), amountOut: state.amountOut.toString(),
        gasUsd: '0.015', route: [[{ exchange: 'uniswap-v3' }, { exchange: 'aerodrome' }]],
      } } } };
    }
    if (url === '/base/api/v1/route/build') {
      const s = body.routeSummary;
      const bps = BigInt(body.slippageTolerance);
      const min = state.mode === 'low-floor' ? 1n : (BigInt(s.amountOut) * (10000n - bps)) / 10000n;
      const desc = {
        srcToken: s.tokenIn, dstToken: s.tokenOut,
        srcReceivers: [state.mode === 'wrong-src-receiver' ? THIEF : EXECUTOR],
        srcAmounts: [BigInt(s.amountIn) - (state.mode === 'wrong-src-amount' ? 1n : 0n)],
        feeReceivers: state.mode === 'fee' ? [THIEF] : [], feeAmounts: state.mode === 'fee' ? [1n] : [],
        dstReceiver: state.mode === 'pays-thief' ? THIEF : body.recipient, amount: BigInt(s.amountIn), minReturnAmount: min,
        flags: state.mode === 'flag-0x200' ? 0x200n : 0n, permit: '0x',
      };
      const data = state.mode === 'simple-mode'
        ? KYBER.encodeFunctionData('swapSimpleMode', [EXECUTOR, desc, '0x', '0x'])
        : KYBER.encodeFunctionData('swap', [{ callTarget: state.mode === 'wrong-executor' ? THIEF : EXECUTOR, approveTarget: state.mode === 'approve-target' ? THIEF : '0x0000000000000000000000000000000000000000', targetData: '0x', desc, clientData: '0x' }]);
      return { status: 200, body: { code: 0, message: 'successfully', data: {
        routerAddress: state.mode === 'other-router' ? THIEF : KYBER_ROUTER, data, transactionValue: '0', amountOut: s.amountOut,
      } } };
    }
    return { status: 404, body: { code: 404, message: 'not here' } };
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url, body });
      const out = answer(req.url, body);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prior = process.env.NEUMA_KYBER_ORIGIN;
  process.env.NEUMA_KYBER_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  return {
    seen, state,
    reset: () => { seen.length = 0; state.mode = 'honest'; state.amountOut = amountOut; },
    close: async () => {
      if (prior === undefined) delete process.env.NEUMA_KYBER_ORIGIN; else process.env.NEUMA_KYBER_ORIGIN = prior;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
