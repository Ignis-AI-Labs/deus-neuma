// THE COMPANY READER — each gathered company's own site, read in bulk.
//
// Design note, 2026-11-16: […] The index (company-index.js) says a company exists; this says what it IS, in
// its own words, and how it can be reached, from the one source nobody has to pay for: its site.
//
// For one company: the home page, then at most two of its own contact / about / team pages.
//   alive        the site answered with a page (a site that does not is a dead end, said so with why)
//   description  what the company says it is (its own meta description, else its title)
//   emails       the addresses it publishes, each with the page it stands on (protected ones decoded)
//   socials      its own X, LinkedIn, Telegram, Discord and GitHub links
// Only a company's own public pages are read, through the platform's web guard (no private
// address, redirects re-checked); nothing is sent but the request. The parsing is PURE; the
// reading is impure (network), behind the `lead-sources` connection switch.

import { assertSafeWebTarget, nextRedirectUrl } from '../web-guard.js';
import { requestWebOnce, readBounded } from '../web-fetch.js';
import { revealAddresses, decodeEntities, extractTitle } from '../html-to-text.js';

export const READ_MAX = 60;
const PAGE_BYTES = 600_000;
const MORE_PAGES = 2;
const EMAILS_MAX = 6;
const text = (v, max) => decodeEntities(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, max);

// An address that is a file name, a tracker or a placeholder is not somebody to write to.
const NOT_AN_ADDRESS = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$|@(sentry|example|domain|email|yourdomain|company|wixpress|sentry-next)\.|^(your|name|email|user|you|firstname|john\.doe)@/i;
const ADDRESS = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;

const SOCIAL = Object.freeze([
  ['x', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent\b|share\b|home\b|search\b|hashtag\b|i\/)([A-Za-z0-9_]{1,15})(?=["'/?#\s]|$)/i, (m) => `https://x.com/${m[1]}`],
  ['linkedin', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|school)\/([A-Za-z0-9._%-]{1,100})/i, (m) => `https://www.linkedin.com/${m[1]}/${m[2]}`],
  ['telegram', /https?:\/\/(?:t\.me|telegram\.me)\/(?!share\b)([A-Za-z0-9_+]{3,64})/i, (m) => `https://t.me/${m[1]}`],
  ['discord', /https?:\/\/(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,32})/i, (m) => `https://discord.gg/${m[1]}`],
  ['github', /https?:\/\/github\.com\/(?!sponsors\b|features\b|about\b)([A-Za-z0-9-]{1,39})(?=["'/?#\s]|$)/i, (m) => `https://github.com/${m[1]}`],
]);

const MORE = /(contact|about|team|people|company|imprint|impressum)/i;

/** pure — a tag's attribute, whatever its quotes. */
const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;

/** pure — what a page says the company is: its meta description (or the social one), else nothing. */
export const describedAs = (html) => {
  for (const [, tag] of String(html).matchAll(/(<meta\b[^>]*>)/gi)) {
    const key = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (key === 'description' || key === 'og:description' || key === 'twitter:description') {
      const said = text(attr(tag, 'content'), 300);
      if (said.length >= 12) return said;
    }
  }
  return '';
};

// A small company may publish a mailbox at one of these; any other foreign domain on its page is somebody else's
// (a vendor, a widget) or a decoding gone wrong, and is never kept.
const MAILBOX_HOSTS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'proton.me', 'protonmail.com', 'pm.me', 'icloud.com', 'yahoo.com', 'hey.com', 'fastmail.com', 'zoho.com', 'gmx.com', 'gmx.de', 'web.de', 'mail.com', 'tutanota.com', 'tuta.com']);

/** pure — the addresses a page publishes that are the company's own (protected ones decoded): at its domain first, then at a public mailbox. */
export const addressesOn = (html, domain) => {
  const found = new Set();
  for (const m of revealAddresses(String(html)).matchAll(ADDRESS)) {
    const email = m[0].toLowerCase().replace(/^(?:u003e|mailto:)/, '');
    if (!NOT_AN_ADDRESS.test(email)) found.add(email);
  }
  const own = (e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`);
  return [...found].filter((e) => own(e) || MAILBOX_HOSTS.has(e.split('@')[1])).sort((a, b) => Number(own(b)) - Number(own(a)) || a.localeCompare(b)).slice(0, EMAILS_MAX);
};

/** pure — the company's own social links on a page. */
export const socialsOn = (html) => Object.fromEntries(SOCIAL.map(([key, shape, link]) => { const m = shape.exec(String(html)); return [key, m ? link(m) : null]; }).filter(([, v]) => v));

/** pure — the company's own contact / about / team pages linked from a page, absolute, at most a few. */
export const morePages = (html, pageUrl) => {
  const here = new URL(pageUrl);
  const out = new Set();
  for (const [, tag] of String(html).matchAll(/(<a\b[^>]*>)/gi)) {
    const href = attr(tag, 'href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let url;
    try { url = new URL(href, here); } catch { continue; }
    if (url.hostname !== here.hostname || !/^https?:$/.test(url.protocol) || !MORE.test(url.pathname) || /\.(pdf|png|jpe?g|zip)$/i.test(url.pathname)) continue;
    url.hash = '';
    if (url.pathname !== here.pathname) out.add(url.href);
  }
  // contact first, then about, then the rest
  return [...out].sort((a, b) => Number(!/contact/i.test(a)) - Number(!/contact/i.test(b)) || a.length - b.length).slice(0, MORE_PAGES);
};

/** pure — everything one page gives. */
export const pageFacts = (html, pageUrl, domain) => ({
  title: text(extractTitle(html) ?? '', 120),
  description: describedAs(html),
  emails: addressesOn(html, domain).map((email) => ({ email, page: pageUrl })),
  socials: socialsOn(html),
  more: morePages(html, pageUrl),
});

/** pure — one company's reading, from its pages in the order they were read. */
export const siteOf = (domain, pages, readAt) => {
  const emails = new Map();
  for (const p of pages) for (const e of p.emails) if (!emails.has(e.email)) emails.set(e.email, e);
  const home = pages[0];
  const host = (() => { try { return new URL(home.url).hostname.replace(/^www\./, ''); } catch { return domain; } })();
  return {
    alive: true,
    description: home.description || home.title || '',
    title: home.title,
    emails: [...emails.values()].slice(0, EMAILS_MAX),
    socials: Object.assign({}, ...pages.map((p) => p.socials).reverse()),
    // A site that answers from another company's address was sold, parked or folded into someone else.
    movedTo: host !== domain && !host.endsWith(`.${domain}`) && !domain.endsWith(`.${host}`) ? host : null,
    pagesRead: pages.length,
    readAt,
  };
};

/** pure — one company's reading in one line, as the sales seat reads it. */
export const siteLine = (domain, site) => (site.alive
  ? [`${domain} — ALIVE`, site.movedTo ? `now answers from ${site.movedTo}` : null, site.description || 'says nothing about itself', site.emails.length ? `publishes ${site.emails.map((e) => e.email).join(', ')}` : 'publishes no address', Object.keys(site.socials).length ? Object.values(site.socials).join(' ') : null].filter(Boolean).join(' — ')
  : `${domain} — NO SITE: ${site.why}`);

// ── impure ──────────────────────────────────────────────────────────────────

/**
 * impure — one public page's HTML through the web guard (redirects re-checked), or why not.
 * @returns {Promise<{ok: true, url: string, html: string} | {ok: false, why: string}>}
 */
export const guardedPage = async (target, { signal } = {}) => {
  let url = target;
  for (let hops = 0; hops <= 4; hops += 1) {
    const guard = await assertSafeWebTarget(url);
    if (!guard.ok) return { ok: false, why: guard.reason === 'unresolvable' ? 'the address does not exist' : `the address was refused (${guard.reason})` };
    const { res, error } = await requestWebOnce(url, guard.addrs, { signal });
    if (error) return { ok: false, why: /no answer within/.test(error) ? 'it did not answer in time' : 'it could not be reached' };
    if (res.statusCode >= 300 && res.statusCode < 400) {
      const next = nextRedirectUrl(url, res.headers.location);
      res.destroy();
      if (!next) return { ok: false, why: 'it redirects nowhere' };
      url = next;
      continue;
    }
    if (res.statusCode !== 200) { res.destroy(); return { ok: false, why: `it answered ${res.statusCode}` }; }
    if (!/html|text\/plain/i.test(String(res.headers['content-type'] ?? 'text/html'))) { res.destroy(); return { ok: false, why: 'it serves no page' }; }
    const { buf } = await readBounded(res, PAGE_BYTES);
    return { ok: true, url, html: buf.toString('utf8') };
  }
  return { ok: false, why: 'it redirects without end' };
};

/**
 * impure — read one company's site: its home page, then at most two of its own contact / about / team pages.
 * Never throws: a company that cannot be read comes back `alive: false` with why.
 * @param {string} domain
 * @param {{fetchPage?: Function, signal?: AbortSignal, now?: () => string}} opts - fetchPage: the page read (a test serves the same pages from this machine)
 */
export const readCompanySite = async (domain, { fetchPage = guardedPage, signal, now = () => new Date().toISOString() } = {}) => {
  try {
    let home = await fetchPage(`https://${domain}/`, { signal });
    if (!home.ok) {
      const plain = await fetchPage(`http://${domain}/`, { signal });
      if (!plain.ok) return { alive: false, why: home.why, readAt: now() };
      home = plain;
    }
    const first = { url: home.url, ...pageFacts(home.html, home.url, domain) };
    const pages = [first];
    for (const more of first.more) {
      const page = await fetchPage(more, { signal });
      if (page.ok) pages.push({ url: page.url, ...pageFacts(page.html, page.url, domain) });
    }
    return siteOf(domain, pages, now());
  } catch (err) {
    return { alive: false, why: err.message, readAt: now() };
  }
};

/**
 * impure — read many companies' sites, a few at a time.
 * @returns {Promise<Array<{domain: string, site: object}>>} in the order asked
 */
export const readSites = async (domains, { concurrency = 8, onProgress = () => {}, ...opts } = {}) => {
  const todo = domains.slice(0, READ_MAX);
  const out = new Array(todo.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= todo.length) return;
      out[i] = { domain: todo[i], site: await readCompanySite(todo[i], opts) };
      const done = out.filter(Boolean);
      onProgress(`${done.length} of ${todo.length} sites read — ${done.filter((r) => r.site.alive).length} alive, last ${todo[i]}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return out;
};
