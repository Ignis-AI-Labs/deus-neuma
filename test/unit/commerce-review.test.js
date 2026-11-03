/**
 * THE COMMERCE REVIEW's law (the CLO's watch widened to the house's
 * commercial acts, RULE 0): the real findings over real-shaped records — terms
 * once a company wins, tax once it invoices, money no invoice or raise
 * explains a week on, a buyer asking for money back, and sanctions: a match
 * against an excerpt of the real public list (test/fixtures/ofac, the US
 * Treasury's own lines), or the screen's absence said plainly.
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { commerceFindings } from '../../backend/services/legal/commerce-review.js';
import { parseSanctions, screen, nameKey } from '../../backend/services/legal/sanctions-list.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SDN = fs.readFileSync(path.join(HERE, '../fixtures/ofac/sdn-head.csv'), 'utf8');
const ALT = fs.readFileSync(path.join(HERE, '../fixtures/ofac/alt-head.csv'), 'utf8');
const NOW = Date.parse('2026-10-30T09:00:00Z');
const PAY = '0x7E7E7e7E7e7E7e7E7E7e7E7e7E7E7e7E7E7e7E7e';
const COMPANIES = [{ id: 'c-1', name: 'Tidewater' }, { id: 'c-2', name: 'Brine' }];
const record = (over = {}) => ({
  companies: COMPANIES, nowMs: NOW, payTo: { address: PAY, network: 'ethereum' },
  deals: [{ id: 'd-1', companyId: 'c-1', buyer: 'Port of Brine', stage: 'won' }, { id: 'd-2', companyId: 'c-2', buyer: 'Wharf Co', stage: 'proposed' }],
  invoices: [{ id: 'v-1', companyId: 'c-1', status: 'paid', paid: { receipt: 'k-paid' } }],
  raises: [], replies: [], receipts: [], sanctions: null, unscreened: 'off', ...over,
});
const ids = (matters) => matters.map((m) => m.externalId);

describe('the commerce review: what the house\'s commercial acts call for', () => {
  test('terms once a company wins a deal, tax once it invoices — once per company', () => {
    const matters = commerceFindings(record());
    expect(ids(matters)).toEqual(['terms:c-1', 'tax:c-1', 'sanctions-off']);
    expect(matters[0]).toMatchObject({ area: 'commerce', source: 'commerce-review', companyId: 'c-1', severity: 'medium', title: 'Customer terms for Tidewater, before it delivers to a buyer' });
    expect(matters[0].summary).toContain('Counsel question 6');
  });

  test('money at the house\'s own wallets that nothing explains, a week on — never one paid, closed, elsewhere or new', () => {
    const at = (key, to, days) => ({ key, to, amount: '90.0', asset: 'USDC', timestamp: new Date(NOW - days * 86_400_000).toISOString() });
    const raise = { company: COMPANIES[0], state: { account: { kind: 'wallet', address: '0x1111111111111111111111111111111111111111' }, investors: [{ id: 'i-1', name: 'Cy', closed: { received: { ref: 'k-closed' } } }] } };
    const matters = commerceFindings(record({
      raises: [raise],
      receipts: [at('k-odd', PAY.toLowerCase(), 8), at('k-paid', PAY, 9), at('k-closed', '0x1111111111111111111111111111111111111111', 9), at('k-new', PAY, 2), at('k-elsewhere', '0x2222222222222222222222222222222222222222', 30), at('k-raise-odd', '0x1111111111111111111111111111111111111111', 10)],
    }));
    expect(ids(matters).filter((i) => i.startsWith('inflow:'))).toEqual(['inflow:k-odd', 'inflow:k-raise-odd']);
    expect(matters.find((m) => m.externalId === 'inflow:k-odd').summary).toContain('money transmission');
  });

  test('a buyer asking for money back is a high matter: money out is the operator\'s', () => {
    const matters = commerceFindings(record({ replies: [{ postId: '2007', username: 'newvoice', text: 'I was charged me twice — refund please' }, { postId: '2001', text: 'thank you for building in the open' }] }));
    expect(matters.find((m) => m.externalId === 'refund:2007')).toMatchObject({ severity: 'high', title: 'A buyer asks for money back (@newvoice)' });
    expect(ids(matters)).not.toContain('refund:2001');
  });

  test('sanctions: off says so, an unreadable list says so, and a name on the real list is a critical possible match', () => {
    expect(commerceFindings(record()).at(-1)).toMatchObject({ externalId: 'sanctions-off', severity: 'low' });
    expect(commerceFindings(record({ unscreened: 'sdn.csv answered 503' })).at(-1)).toMatchObject({ externalId: 'sanctions-unread', severity: 'medium' });
    const list = parseSanctions(SDN, ALT);
    const raises = [{ company: COMPANIES[0], state: { investors: [{ id: 'i-9', name: 'Abu Abbas', firm: null }] } }];
    const deals = [{ id: 'd-7', companyId: 'c-1', buyer: 'National Bank of Cuba', stage: 'won' }, { id: 'd-8', companyId: 'c-1', buyer: 'Port of Brine', stage: 'won' }];
    const matters = commerceFindings(record({ deals, raises, sanctions: { list, fetchedAt: '2026-10-30T08:00:00.000Z' }, unscreened: null }));
    const hits = matters.filter((m) => m.externalId.startsWith('sanctions:'));
    expect(hits.map((m) => [m.externalId, m.severity])).toEqual([['sanctions:buyer:d-7', 'critical'], ['sanctions:investor:i-9', 'critical']]);
    expect(hits[0].title).toBe('Possible sanctions match: National Bank of Cuba (buyer) — listed as NATIONAL BANK OF CUBA, CUBA');
    expect(hits[1].title).toBe('Possible sanctions match: Abu Abbas (investor) — listed as ABBAS, Abu, SDGT');
    expect(ids(matters)).not.toContain('sanctions-off');
  });

  test('the list and the match: primary names and a.k.a.s, words in any order, accents folded', () => {
    const list = parseSanctions(SDN, ALT);
    expect(list.length).toBeGreaterThan(13); // the 13 listed names, and a.k.a.s beside them
    expect(list.find((r) => r.name === 'NATIONAL BANK OF CUBA')).toMatchObject({ id: '306', program: 'CUBA' });
    expect(nameKey('ABBAS, Abu')).toBe(nameKey('abu  abbás'));
    expect(screen([{ kind: 'buyer', id: 'x', name: 'Bank of Cuba' }], list)).toEqual([]); // fewer words: no match
  });
});
