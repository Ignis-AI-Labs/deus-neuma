/**
 * THE LINK CHANGE LAW — pure (link-change-shape.js): what a CMO may propose
 * for a company's site, pages and repos; what it would change on the company
 * as it stands; and the block the operator's APPROVE writes. Plus the pure
 * hand-overs that send a company's missing links to the seated CMO (the
 * social check's fix, the BRAND tab's SITE & CODE). Real inputs, real
 * outputs, nothing stood in.
 */
import { describe, it, expect } from 'vitest';
import {
  linkRefusal, linkChangeRefusals, linkDiff, landingRefusal, appliedBlock, diffWords, MAX_LINKS,
} from '../../backend/services/marketing/link-change-shape.js';
import { companyOf } from '../../backend/services/branding/kit-shape.js';
import { cmoHandTo, sitePrompt } from '../../backend/services/social/house-check/check-fixes.js';
import { cmoHandTo as brandHandTo, rowView, listsRepo } from '../../frontend/app/RelinkShell/brandkits/link-change-view.js';
import { KIND_LABEL, cardSelector } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { linkChangeItem } from '../../backend/services/waiting/waiting-fold.js';

describe('a company link is a public https address', () => {
  it('takes an ordinary public site and page', () => {
    for (const ok of ['https://northwind.example', 'https://www.northwind.example/about?x=1', 'https://docs.northwind.example:8443/a']) {
      expect(linkRefusal(ok)).toBeNull();
    }
  });

  it('refuses http, a name or password inside it, this machine, a private network, a bare address', () => {
    const cases = [
      ['http://northwind.example', 'must start with https://'],
      ['ftp://northwind.example', 'must start with https://'],
      ['https://user:pass@northwind.example', 'never carries a name or password'],
      ['https://user@northwind.example', 'never carries a name or password'],
      ['https://localhost/x', 'this machine or a private network'],
      ['https://app.localhost', 'this machine or a private network'],
      ['https://printer.local', 'this machine or a private network'],
      ['https://wiki.corp', 'this machine or a private network'],
      ['https://intranet', 'this machine or a private network'],
      ['https://127.0.0.1', 'a bare address'],
      ['https://10.0.0.8/admin', 'a bare address'],
      ['https://192.168.1.1', 'a bare address'],
      ['https://169.254.169.254/latest', 'a bare address'],
      ['https://[::1]/', 'a bare address'],
      ['https://93.184.216.34', 'a bare address'],
      ['https://north wind.example', 'no spaces'],
      [`https://northwind.example/${'a'.repeat(300)}`, 'at most 300 characters'],
      ['northwind.example', 'is not a web address'],
      [42, 'a web address'],
    ];
    for (const [url, why] of cases) expect(linkRefusal(url), String(url)).toContain(why);
  });
});

describe('a proposal judged on its own', () => {
  it('names every reason, one each', () => {
    const out = linkChangeRefusals({
      company: 'North Wind', site: 'http://northwind.example', links: ['https://ok.example', 'https://10.1.1.1'],
      repos: [{ remote: 'http://github.com/x/y' }, { path: 'relative/path' }], owner: 'me',
    });
    expect(out.ok).toBe(false);
    expect(out.reasons).toEqual([
      'owner is not part of this act (company, site, links, repos)',
      'company is the id of one of the house\'s companies',
      'site: http://northwind.example must start with https://',
      'links[1]: 10.1.1.1 is a bare address — a company link names its site',
      'repos[0].remote must be a web address (https://…)',
      'repos[1].path must be a full folder path (/like/this, no "..", no trailing slash)',
      'repos[0].remote: http://github.com/x/y must start with https://',
    ]);
    expect(linkChangeRefusals({ company: 'northwind' }).reasons).toEqual(['propose at least one of: site, links, repos']);
    expect(linkChangeRefusals({ company: 'northwind', links: [] }).reasons).toEqual(['links is a list of web addresses']);
    expect(linkChangeRefusals({ company: 'northwind', repos: [{ remote: 'https://user:tok@github.com/x/y' }] }).reasons)
      .toEqual(['repos[0].remote: a link never carries a name or password inside it']);
  });

  it('a sound one becomes the change it asks for', () => {
    expect(linkChangeRefusals({
      company: 'northwind', site: 'https://northwind.example', links: ['https://northwind.example/about', 'https://northwind.example/about'],
      repos: [{ remote: 'https://github.com/northwind/app', role: ' the app ' }, { path: '/srv/northwind-site' }],
    })).toEqual({
      ok: true,
      companyId: 'northwind',
      change: {
        site: 'https://northwind.example',
        links: ['https://northwind.example/about'],
        repos: [{ remote: 'https://github.com/northwind/app', role: 'the app' }, { path: '/srv/northwind-site', role: '' }],
      },
    });
  });
});

describe('the change on the company as it stands — before → after, and the block approve writes', () => {
  const block = { parentId: 'house-co', site: { url: 'https://old.example', links: ['https://old.example/a'] }, repos: [{ remote: 'https://github.com/nw/app', role: 'the app' }], legalEntity: { name: 'Northwind LLC' } };
  const company = companyOf({ name: 'Northwind', company: block }, 'northwind');
  const change = {
    site: 'https://northwind.example',
    links: ['https://old.example/a', 'https://northwind.example/about'],
    repos: [{ remote: 'https://github.com/nw/app', role: 'the app' }, { remote: 'https://github.com/nw/site', role: 'the website' }],
  };

  it('shows only what would change: the site replaced, each new page, each new repo', () => {
    const rows = linkDiff(company, change);
    expect(rows).toEqual([
      { field: 'site', before: 'https://old.example', after: 'https://northwind.example' },
      { field: 'link', before: null, after: 'https://northwind.example/about' },
      { field: 'repo', before: null, after: { remote: 'https://github.com/nw/site', role: 'the website' } },
    ]);
    expect(diffWords('Northwind', rows)).toBe('Northwind links: site → northwind.example, +1 page, +1 repo');
    expect(landingRefusal(company, change)).toBeNull();
  });

  it('a change already on record, or past what a company keeps, cannot land', () => {
    const same = { site: 'https://old.example', links: ['https://old.example/a'] };
    expect(linkDiff(company, same)).toEqual([]);
    expect(landingRefusal(company, same)).toBe('Northwind already has all of that on record');
    expect(diffWords('Northwind', [])).toBe('Northwind links: already on record');
    const full = companyOf({ name: 'Full', company: { site: { url: 'https://f.example', links: Array.from({ length: MAX_LINKS }, (_, i) => `https://f.example/${i}`) } } }, 'full');
    expect(landingRefusal(full, { links: ['https://f.example/new'] })).toBe(`Full keeps at most ${MAX_LINKS} pages`);
  });

  it('the block approve writes keeps every field the act does not name, and only adds', () => {
    expect(appliedBlock(block, change)).toEqual({
      parentId: 'house-co',
      legalEntity: { name: 'Northwind LLC' },
      site: { url: 'https://northwind.example', links: ['https://old.example/a', 'https://northwind.example/about'] },
      repos: [{ remote: 'https://github.com/nw/app', role: 'the app' }, { remote: 'https://github.com/nw/site', role: 'the website' }],
    });
    // Repos alone never touch the site; a company with no block gains only what is proposed.
    expect(appliedBlock(undefined, { repos: [{ path: '/srv/x', role: '' }] })).toEqual({ repos: [{ path: '/srv/x', role: '' }] });
    expect(appliedBlock(block, { repos: [{ path: '/srv/x', role: '' }] }).site).toBe(block.site);
  });
});

describe('the hand-overs to the seated CMO', () => {
  it('the social check hands a missing site to a CMO of THIS house only', () => {
    const cmo = { neumaId: 'kestrel', name: 'Kestrel', external: false, house: 'house-a' };
    const prompt = sitePrompt({ id: 'umbrae', name: 'Umbrae' });
    expect(cmoHandTo({ cmo, house: 'house-a' }, prompt)).toEqual({ neumaId: 'kestrel', name: 'Kestrel', role: 'cmo', prompt });
    expect(prompt).toContain('marketing/company-links (company: umbrae');
    expect(prompt).toContain('I will approve the change in WAITING ON YOU.');
    expect(cmoHandTo({ cmo, house: 'house-b' }, prompt)).toBeNull();
    expect(cmoHandTo({ cmo: { ...cmo, external: true }, house: 'house-a' }, prompt)).toBeNull();
    expect(cmoHandTo({ cmo: null, house: 'house-a' }, prompt)).toBeNull();
  });

  it('SITE & CODE hands what is missing, names it, and is quiet when nothing is', () => {
    const company = { id: 'northwind', name: 'Northwind', site: { url: null, links: [] }, repos: [] };
    const hand = brandHandTo({ laneId: 'kestrel' }, 'Kestrel', company);
    expect(hand).toMatchObject({ neumaId: 'kestrel', name: 'Kestrel' });
    expect(hand.prompt).toContain('has no site and no code repositories on record');
    expect(brandHandTo({ laneId: 'kestrel' }, 'Kestrel', { ...company, site: { url: 'https://n.example' }, repos: [{}] })).toBeNull();
    expect(brandHandTo(null, null, company)).toBeNull();
  });

  it('the card reads each row short, the whole address on hover', () => {
    expect(rowView({ field: 'site', before: null, after: 'https://www.northwind.example/' })).toEqual({ label: 'SITE', before: '—', after: 'northwind.example', title: 'https://www.northwind.example/', local: false });
    expect(rowView({ field: 'repo', before: null, after: { remote: 'https://github.com/nw/site', role: 'the website' } }).after).toBe('the website · github.com/nw/site');
    expect(listsRepo([{ field: 'site' }])).toBe(false);
    expect(listsRepo([{ field: 'repo' }])).toBe(true);
  });
});

describe('WAITING ON YOU — the row and where it lands', () => {
  it('a link change is a LINKS row from its CMO that lands on the company\'s SITE & CODE card', () => {
    const item = linkChangeItem({ id: 'lc_0123456789ab', at: '2026-10-24T12:00:00.000Z', laneId: 'kestrel', companyId: 'northwind', title: 'Northwind links: site → northwind.example' },
      new Map([['kestrel', 'Kestrel']]));
    expect(item).toEqual({
      id: 'link-change:lc_0123456789ab', kind: 'link-change', title: 'Northwind links: site → northwind.example',
      who: { laneId: 'kestrel', name: 'Kestrel' },
      where: { app: 'marketing', tab: 'brand', companyId: 'northwind', section: 'sources', changeId: 'lc_0123456789ab' },
      at: '2026-10-24T12:00:00.000Z',
    });
    expect(KIND_LABEL[item.kind]).toBe('LINKS');
    expect(cardSelector(item)).toBe('[data-link-change-id="lc_0123456789ab"]');
  });
});
