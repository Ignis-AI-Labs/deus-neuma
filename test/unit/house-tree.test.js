/**
 * The HOUSE RAIL's pure law (marketing/house-tree.js) — real inputs, real
 * outputs: the rows, where a company or an account may move, and where the
 * operator stands.
 */
import { describe, it, expect } from 'vitest';
import { houseTreeRows, companyMoveTargets, accountMoveTargets, isHere } from '../../frontend/app/RelinkShell/marketing/house-tree.js';

const COMPANIES = [
  { id: 'ignis', name: 'Ignis AI Labs', depth: 0, parentId: null },
  { id: 'deus-neuma', name: 'Deus Neuma', depth: 1, parentId: 'ignis' },
  { id: 'umbrae', name: 'Umbrae', depth: 0, parentId: null },
];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', companyId: 'umbrae', expectedHandle: 'Umbrae_Ignis' },
  { id: 'x-2', channelId: 'x', companyId: 'deus-neuma' },
  { id: 'tiktok-1', channelId: 'tiktok', companyId: 'ignis' },
  { id: 'bluesky-1', channelId: 'bluesky', companyId: null },
];

describe('the rows', () => {
  it('HOUSE, each company with its own accounts beneath, UNSORTED last', () => {
    const rows = houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS });
    expect(rows.map((r) => `${r.depth}:${r.key}`)).toEqual([
      '0:house', '1:company:ignis', '2:account:tiktok-1', '2:company:deus-neuma', '3:account:x-2',
      '1:company:umbrae', '2:account:x-1', '1:unsorted', '2:account:bluesky-1',
    ]);
  });

  it('an account reads by its handle, else its number on the platform; its company on hover', () => {
    const rows = houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS });
    expect(rows.find((r) => r.id === 'x-1')).toMatchObject({ name: '@Umbrae_Ignis', channelId: 'x' });
    expect(rows.find((r) => r.id === 'x-2').name).toBe('#2');
    expect(rows.find((r) => r.id === 'x-2').title).toContain('Deus Neuma');
  });

  it('no UNSORTED row when every account has its company; an account naming a gone company is unsorted', () => {
    expect(houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS.slice(0, 3) }).some((r) => r.kind === 'unsorted')).toBe(false);
    expect(houseTreeRows({ companies: COMPANIES, accounts: [{ id: 'x-9', channelId: 'x', companyId: 'gone' }] }).map((r) => r.key).slice(-2)).toEqual(['unsorted', 'account:x-9']);
  });
});

describe('campaigns on the rail', () => {
  const CAMPAIGNS = [
    { id: 'c1', name: 'Market Depth', companyId: 'umbrae', status: 'active' },
    { id: 'c2', name: 'Old Brand Push', companyId: null, status: 'ended' },
  ];
  it('each company\'s campaigns stand under it before its accounts; one naming no company is UNSORTED', () => {
    const rows = houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS, campaigns: CAMPAIGNS });
    expect(rows.map((r) => `${r.depth}:${r.key}`).slice(5)).toEqual(['1:company:umbrae', '2:campaign:c1', '2:account:x-1', '1:unsorted', '2:campaign:c2', '2:account:bluesky-1']);
    expect(rows.find((r) => r.id === 'c2')).toMatchObject({ kind: 'campaign', status: 'ended', title: 'campaign · Old Brand Push · ended' });
  });

  it('on a campaign\'s page its row is lit — not its company\'s', () => {
    const rows = houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS, campaigns: CAMPAIGNS });
    expect(rows.filter((r) => isHere(r, { companyId: 'umbrae', tab: 'campaigns', campaignId: 'c1' })).map((r) => r.key)).toEqual(['campaign:c1']);
  });
});

describe('where things may move', () => {
  it('a company: the top or any company not itself or below it — its place marked', () => {
    expect(companyMoveTargets(COMPANIES, 'ignis').map((t) => t.id)).toEqual(['top', 'umbrae']);
    expect(companyMoveTargets(COMPANIES, 'umbrae').map((t) => `${t.id}${t.checked ? '*' : ''}`)).toEqual(['top*', 'ignis', 'deus-neuma']);
    expect(companyMoveTargets(COMPANIES, 'deus-neuma').find((t) => t.checked).id).toBe('ignis');
  });

  it('an account: any company, its own marked', () => {
    expect(accountMoveTargets(COMPANIES, 'umbrae').map((t) => `${t.id}${t.checked ? '*' : ''}`)).toEqual(['ignis', 'deus-neuma', 'umbrae*']);
  });
});

describe('where the operator stands', () => {
  const rows = houseTreeRows({ companies: COMPANIES, accounts: ACCOUNTS });
  const lit = (here) => rows.filter((r) => isHere(r, here)).map((r) => r.key);
  it('HOUSE at the top, a company at its level, an account at its own', () => {
    expect(lit({ companyId: null })).toEqual(['house']);
    expect(lit({ companyId: 'umbrae' })).toEqual(['company:umbrae']);
    expect(lit({ companyId: 'umbrae', account: { channelId: 'x', accountId: 'x-1' } })).toEqual(['account:x-1']);
  });
});
