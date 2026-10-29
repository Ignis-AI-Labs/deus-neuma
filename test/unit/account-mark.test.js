// AccountMark (show-dont-tell audit, pattern 2): who an account is, by sight —
// its platform's mark and its handle, else its number on that platform, never
// the bare code; its company, platform and id on hover; an account under no
// company in the warning register. Real functions, real inputs, no double.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountMarkWords } from '../../frontend/app/RelinkShell/accounts/account-words.js';
import { AccountMark } from '../../frontend/app/RelinkShell/accounts/AccountMark.jsx';

const COMPANIES = [{ id: 'northwind', name: 'Northwind' }];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', channelName: 'X (Twitter)', companyId: 'northwind', expectedHandle: 'northwind' },
  { id: 'x-2', channelId: 'x', channelName: 'X (Twitter)', companyId: 'northwind' },
  { id: 'bluesky-1', channelId: 'bluesky', channelName: 'Bluesky', companyId: null },
];

describe('accountMarkWords', () => {
  it('a known handle: the handle, the company and id on hover', () => {
    expect(accountMarkWords({ accountId: 'x-1' }, ACCOUNTS, COMPANIES))
      .toEqual({ channelId: 'x', text: '@northwind', title: 'Northwind · X (Twitter) · account x-1', unsorted: false });
  });

  it('no handle yet: its number on the platform, never the bare code', () => {
    expect(accountMarkWords({ accountId: 'x-2' }, ACCOUNTS, COMPANIES)).toMatchObject({ channelId: 'x', text: '#2' });
  });

  it('the handle a sent post went out as wins over the account\'s expected one', () => {
    expect(accountMarkWords({ accountId: 'x-1', postedAs: 'nw_live' }, ACCOUNTS, COMPANIES).text).toBe('@nw_live');
  });

  it('an account under no company is unsorted and says so on hover', () => {
    expect(accountMarkWords({ accountId: 'bluesky-1' }, ACCOUNTS, COMPANIES))
      .toEqual({ channelId: 'bluesky', text: '#1', title: 'no company yet · Bluesky · account bluesky-1', unsorted: true });
  });

  it('an account the house has not read yet still names its platform from its id', () => {
    expect(accountMarkWords({ accountId: 'bluesky-3', channelId: 'bluesky' }, [], [])).toMatchObject({ channelId: 'bluesky', text: '#3', unsorted: true });
  });
});

describe('AccountMark, rendered', () => {
  it('the platform\'s mark beside the name, the hover, a note added to it', () => {
    const out = renderToStaticMarkup(createElement(AccountMark, { accountId: 'x-1', note: 'staged for the coming 7 days' }));
    expect(out).toMatch(/^<span class="acm is-unsorted" data-account-mark="x-1" title="no company yet · x · account x-1 · staged for the coming 7 days"><svg [^>]*aria-hidden="true">/);
    expect(out).toContain('<span class="acm-name">#1</span>');
  });

  it('a queue entry: its own account, else its platform\'s first', () => {
    expect(renderToStaticMarkup(createElement(AccountMark, { entry: { channelId: 'bluesky' } }))).toContain('data-account-mark="bluesky-1"');
  });
});
