// The treasury's pure law, called for real (RULE 0 — real inputs, real
// outputs, nothing stood in): the SPEND card's exact figures, expiry, the
// being's news, the flight marks, the window's sums and labels — and the
// structural law that no money path consults a mandate or any grant beyond
// the operator's own policy and signature.
import fs from 'fs/promises';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { spendCardOf, fromWallet, recipientStanding, historyRowOf } from '../../backend/services/treasury/spend-card.js';
import { expireStale } from '../../backend/services/treasury/spend-records.js';
import { spendNewsOf } from '../../backend/services/treasury/spend-news.js';
import { treasuryMarks } from '../../backend/services/treasury/treasury-flight.js';
import { spendItem } from '../../backend/services/treasury/treasury-waiting.js';
import { timeLeftLabel, recipientLines, fromLine, limitsLine, reviewLine, mayApprove } from '../../frontend/app/RelinkShell/spend/spend-card-view.js';
import { heldOn, treasuryOverview, historyStatus } from '../../frontend/app/RelinkShell/treasury-view.js';
import { cardSelector, KIND_LABEL, bandMayApprove } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';

const TO = '0x1111111111111111111111111111111111111111';
const FROM = '0x2222222222222222222222222222222222222222';
const request = (over = {}) => ({ id: 'r1', to: TO, value: '0.050000000000000001', memo: 'Ink.', nonce: 'n1', expiry: 1_000_000, requestedAt: '2026-10-24T00:00:00.000Z', status: 'pending', ...over });

describe('the SPEND card — exact, whole, plain', () => {
  it('balance after is computed in wei: one wei over a round figure is shown, never rounded away', () => {
    const card = spendCardOf(request(), {
      neumaId: 'quill', name: 'Quill', network: 'base', chainLabel: 'Base mainnet', allowlist: { entries: [{ address: TO, label: 'ink shop', addedAt: '2026-10-01' }] },
      thresholdEth: 0, capEth: '0.1', address: FROM, balanceEth: '0.1', records: [], review: null, nowSec: 1_000_000 - 3600,
    });
    expect(card.amount).toBe('0.050000000000000001');
    expect(card.from).toEqual({ address: FROM, balanceEth: '0.1', balanceAfterEth: '0.049999999999999999', short: false });
    expect(card.recipient).toMatchObject({ standing: 'approved', label: 'ink shop', firstTime: true });
    expect(card.secondsLeft).toBe(3600);
    expect(card.reason).toBe('Ink.');
  });

  it('an unread balance is null (never 0); a short wallet says so; a removed recipient is named', () => {
    expect(fromWallet(FROM, null, 1n)).toEqual({ address: FROM, balanceEth: null, balanceAfterEth: null, short: false });
    expect(fromWallet(FROM, '0.01', ethers.parseEther('0.02')).short).toBe(true);
    expect(recipientStanding(TO, { entries: [] }, [{ status: 'executed', to: TO.toUpperCase().replace('0X', '0x') }])).toMatchObject({ standing: 'removed', priorSends: 1, firstTime: false });
  });

  it('expiry settles a request at the moment it expired, and only a pending one', () => {
    const out = expireStale([request({ expiry: 100 }), request({ id: 'r2', expiry: 300 }), request({ id: 'r3', status: 'executed', expiry: 100 })], 200);
    expect(out.map((r) => r.status)).toEqual(['expired', 'pending', 'executed']);
    expect(out[0].resolvedAt).toBe(new Date(100_000).toISOString());
  });

  it('the being is told each outcome once, in plain words; an autonomous send and old history are not news', () => {
    const now = Date.parse('2026-10-24T12:00:00.000Z');
    const news = spendNewsOf([
      request({ id: 'a', status: 'rejected', note: 'Not now.', resolvedAt: '2026-10-24T10:00:00.000Z' }),
      request({ id: 'b', status: 'expired', resolvedAt: '2026-10-24T11:00:00.000Z' }),
      request({ id: 'c', status: 'executed', autonomous: true, resolvedAt: '2026-10-24T11:00:00.000Z' }),
      request({ id: 'd', status: 'executed', txHash: '0xabc', resolvedAt: '2026-09-01T00:00:00.000Z' }),
      request({ id: 'e', status: 'executed', txHash: '0xdef', toldAt: '2026-10-24T11:30:00.000Z', resolvedAt: '2026-10-24T11:00:00.000Z' }),
    ], now);
    expect(news.ids).toEqual(['a', 'b']);
    expect(news.text).toContain('DECLINED');
    expect(news.text).toContain('Their note: "Not now."');
    expect(news.text).toContain('EXPIRED');
    expect(spendNewsOf([], now)).toEqual({ text: '', ids: [] });
  });

  it('a history row carries the being\'s reason and the operator\'s note', () => {
    expect(historyRowOf(request({ status: 'rejected', note: 'No.' }), { neumaId: 'quill', name: 'Quill' })).toMatchObject({ status: 'rejected', reason: 'Ink.', note: 'No.', told: false });
  });
});

describe('the waiting row and the card it lands on', () => {
  it('a spend is SPEND, lands on its card, and is never a one-press approve', () => {
    const item = spendItem(request(), 'quill', new Map([['quill', 'Quill']]));
    expect(KIND_LABEL[item.kind]).toBe('SPEND');
    expect(cardSelector(item)).toBe('[data-spend-id="r1"]');
    expect(bandMayApprove({ ...item, text: item.title })).toBe(false);
    expect(cardSelector({ where: { app: 'treasury', flagId: 'tf_0123456789ab' } })).toBe('[data-flag-id="tf_0123456789ab"]');
  });

  it('the card reads plainly: time left, standing, first time, balance, limits, review', () => {
    expect([timeLeftLabel(0), timeLeftLabel(59), timeLeftLabel(600), timeLeftLabel(3 * 3600 + 120)]).toEqual(['EXPIRED', 'UNDER A MINUTE LEFT', '10M LEFT', '3H 2M LEFT']);
    expect(recipientLines({ standing: 'approved', label: 'ink', approvedAt: '2026-10-01T00:00:00Z', firstTime: true }))
      .toEqual({ standing: 'ON YOUR APPROVED LIST AS "ink" SINCE 2026-10-01', warning: 'FIRST TIME — this being has never sent money to this address. Check it is the one you meant.' });
    expect(fromLine({ address: FROM, balanceEth: null })).toBe('BALANCE UNREAD — THE CHAIN DID NOT ANSWER');
    expect(limitsLine({ thresholdEth: 0, capEth: '0.1' })).toMatch(/^EVERY SEND FROM THIS BEING NEEDS YOUR SIGNATURE/);
    expect(reviewLine(null, false).mark).toBe('NO QUAESTOR SEATED — NOBODY REVIEWED THIS');
    const card = { amountValid: true, recipient: { standing: 'approved' }, from: { short: false } };
    expect(mayApprove(card, '', 100)).toBe(false);
    expect(mayApprove(card, 'pw', 0)).toBe(false);
    expect(mayApprove({ ...card, recipient: { standing: 'removed' } }, 'pw', 100)).toBe(false);
    expect(mayApprove(card, 'pw', 100)).toBe(true);
  });
});

describe('the treasury window and its flight check', () => {
  it('sums held ETH exactly and counts what was unread', () => {
    expect(heldOn([{ balances: { base: '0.1' } }, { balances: { base: '0.2' } }, { balances: { base: null } }], 'base')).toEqual({ total: '0.3', unread: 1 });
    expect(treasuryOverview({ pending: [1, 2], flags: [1], marks: [{ state: 'ok' }, { state: 'fail' }, { state: 'warn' }], wallets: [], moneyIn: { count: 4 } }))
      .toMatchObject({ waiting: 3, notOk: 2, failing: 1, received: 4 });
    expect(historyStatus({ status: 'executed', autonomous: true })).toBe('SENT UNDER ITS LIMIT');
  });

  it('marks are true: an unread balance is UNREAD, never ok', () => {
    const lane = { neumaId: 'quill', name: 'Quill', address: FROM, baseEth: null, thresholdEth: 0, allowlistCount: 1, custody: 'sealed', records: [] };
    const marks = Object.fromEntries(treasuryMarks({ officer: null, officerName: null, lanes: [lane], capEth: '0.1', rawSigningRefused: true, nowMs: 0 }).map((m) => [m.id, m.state]));
    expect(marks).toEqual({ seat: 'warn', wallets: 'unread', limits: 'ok', allowlists: 'ok', pending: 'ok', custody: 'ok', trade: 'ok' });
    expect(treasuryMarks({ officer: null, lanes: [lane], capEth: '0.1', rawSigningRefused: false, nowMs: 0 }).find((m) => m.id === 'trade').state).toBe('fail');
  });
});

describe('no grant beyond the operator\'s own reaches money', () => {
  const MONEY_PATHS = [
    'backend/services/neuma-wallet-spend.js', 'backend/services/neuma-wallet.js', 'backend/services/intents/wallet-send.js',
    'backend/routes/neuma-wallet-routes.js', 'core/wallet/spend-policy.js', 'backend/routes/treasury-routes.js',
  ];

  it('no money path imports a mandate, and the treasury modules import none either', async () => {
    const treasury = (await fs.readdir('backend/services/treasury')).map((f) => path.join('backend/services/treasury', f));
    for (const file of [...MONEY_PATHS, ...treasury, 'backend/services/intents/treasury-acts.js']) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, `${file} reaches a mandate`).not.toMatch(/from ['"][^'"]*mandate/);
    }
  });

  it('the only callers that can send or approve are the operator\'s routes and the being\'s own wallet/send', async () => {
    const callers = [];
    const walk = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (p.endsWith('.js') && !MONEY_PATHS.slice(0, 2).includes(p)) {
          if (/\b(requestSpend|approvePendingSpend\w*|sendTransaction)\s*\(/.test(await fs.readFile(p, 'utf8'))) callers.push(p);
        }
      }
    };
    await walk('backend');
    expect(callers.sort()).toEqual(['backend/routes/neuma-wallet-routes.js', 'backend/services/intents/wallet-send.js']);
  });
});
