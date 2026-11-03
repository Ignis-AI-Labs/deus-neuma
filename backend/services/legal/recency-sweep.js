// RECENCY SWEEP — the app searches the official feeds itself for anything
// from the last 120 days on a legal question, and a filing must answer for
// every action it finds (recency-feeds.js says why and what reaches).
//
// The office names its search terms; each must appear in the filing's own
// text, so the sweep searches what the filing is about. Every action found is
// OWED a line in the filing's recency account — by its number, its title or
// its address — even if the line is […]. Exchanges'
// routine rule filings are listed, never owed. Every read is journaled and
// held by the web access switch like any web read; what the feeds say is
// outside text and reaches the office framed as such.

import { fetchWebPage } from '../web-fetch.js';
import { journalWebCall } from '../web-being-tools.js';
import { webSettings } from '../web-settings.js';
import { frameUntrustedContent } from '../untrusted-content.js';
import { squeeze } from './citation-record.js';
import { WEB_OFF } from './cite-check.js';
import {
  RECENCY_FEEDS, SWEEP_JURISDICTIONS, EU_GAP, windowStart, feedUrls, parseFeed, parseFederalRegister,
  matchesTerms, foundItem, unaddressed,
} from './recency-feeds.js';

const TERMS_MAX = 4;
const OWED_MAX = 40;
const PARALLEL = 4;

/** The sweep the filing asks for, or a reason it cannot run. Pure. */
export const sweepProblem = (sweep, filingText) => {
  const terms = Array.isArray(sweep?.terms) ? sweep.terms.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
  const places = Array.isArray(sweep?.jurisdictions) ? sweep.jurisdictions : [];
  const shape = `sweep: {terms: ["<the words this question turns on>"], jurisdictions: [${SWEEP_JURISDICTIONS.join(' | ')}]}`;
  if (!terms.length || terms.length > TERMS_MAX) return `name 1 to ${TERMS_MAX} search terms for the app's recency sweep — ${shape}`;
  if (terms.some((t) => squeeze(t).length < 3)) return 'a search term is a word or phrase of at least three letters';
  const text = squeeze(filingText);
  const offTopic = terms.filter((t) => !text.includes(squeeze(t)));
  if (offTopic.length) return `every sweep term must appear in the filing's own words, so the sweep searches what it is about: ${offTopic.map((t) => `"${t}"`).join(', ')} does not`;
  if (!places.length || places.some((j) => !SWEEP_JURISDICTIONS.includes(j))) return `jurisdictions is a list of ${SWEEP_JURISDICTIONS.join(' | ')} — ${shape}`;
  return null;
};

// impure — one feed read for every address it answers a sweep on.
const readFeed = async (feed, terms, since, today, connection) => {
  const out = { id: feed.id, name: feed.name, jurisdiction: feed.jurisdiction, ok: true, errors: [], reach: null, overflow: false, items: [] };
  for (const url of feedUrls(feed, terms, since, today)) {
    const page = await fetchWebPage(url).catch((err) => ({ ok: false, error: err.message }));
    await journalWebCall(connection, 'legal/recency_sweep', url.slice(0, 200), page.ok ? 'ok' : 'error');
    if (!page.ok) { out.errors.push(page.error); continue; }
    try {
      if (feed.search === 'federal-register') {
        const { count, items } = parseFederalRegister(page.text);
        if (count > items.length) out.overflow = true;
        out.items.push(...items);
      } else {
        const entries = parseFeed(page.text);
        const dates = entries.map((e) => e.date).filter(Boolean).sort();
        if (!feed.search && dates.length) out.reach = dates[0];
        out.items.push(...entries.filter((e) => matchesTerms(e, terms)));
      }
    } catch (err) {
      out.errors.push(`unreadable answer: ${err.message}`);
    }
  }
  out.ok = out.errors.length === 0;
  out.items = out.items.filter((e) => !e.date || e.date >= since).map((e) => foundItem(feed, e));
  return out;
};

/**
 * impure — run the sweep. Refuses (refused true) while web access is off.
 * @param {{terms: string[], jurisdictions: string[]}} sweep
 * @param {{connection: Object, today?: string}} ctx
 */
export const runRecencySweep = async (sweep, { connection, today = new Date().toISOString().slice(0, 10) }) => {
  if (!(await webSettings.isEnabled())) return { refused: true, text: WEB_OFF };
  const terms = sweep.terms.map((t) => String(t).trim()).filter(Boolean);
  const since = windowStart(today);
  const feeds = RECENCY_FEEDS.filter((f) => sweep.jurisdictions.includes(f.jurisdiction));
  const read = [];
  for (let i = 0; i < feeds.length; i += PARALLEL) {
    read.push(...await Promise.all(feeds.slice(i, i + PARALLEL).map((f) => readFeed(f, terms, since, today, connection))));
  }
  const seen = new Set();
  const items = read.flatMap((f) => f.items)
    .filter((i) => { const k = i.link || i.key; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { refused: false, since, until: today, terms, jurisdictions: sweep.jurisdictions, feeds: read, items };
};

// pure — one found action as the office reads it.
const itemLine = (i) => `[${i.ref.length > 40 ? i.source : i.ref}] ${i.date ?? 'undated'}${i.kind ? ` ${i.kind}` : ''} — ${i.title}${i.link ? ` <${i.link}>` : ''}`;

/**
 * The sweep judged against the filing's recency account. Pure.
 * @returns {{ok: boolean, text: string, owed: Array<Object>, missing: Array<Object>}}
 */
export const sweepVerdict = (result, recencyText) => {
  const owed = result.items.filter((i) => i.owed);
  const missing = unaddressed(result.items, recencyText);
  const tooMany = owed.length > OWED_MAX;
  const reach = result.feeds.map((f) => `- ${f.name}: ${f.ok ? `${f.items.length} found` : `UNREAD (${f.errors.join('; ').slice(0, 160)})`}${f.reach && f.reach > result.since ? ` — the feed reaches back only to ${f.reach}` : ''}${f.overflow ? ' — more than 100 matched one term: the newest 100 were read' : ''}`);
  const listing = [
    ...(missing.length ? ['OWED AN ANSWER (name each in recency by its number or title, and say what it means for this question — "not on point, because …" is an answer):', ...missing.slice(0, OWED_MAX).map(itemLine)] : []),
    ...(result.items.some((i) => !i.owed) ? ['Listed only (exchange rule filings, meeting notices):', ...result.items.filter((i) => !i.owed).slice(0, 15).map(itemLine)] : []),
  ].join('\n');
  const text = [
    `RECENCY SWEEP — the app searched the official feeds for ${result.terms.map((t) => `"${t}"`).join(', ')} from ${result.since} to ${result.until} (${result.jurisdictions.join(', ')}): ${result.items.length} action(s) found, ${owed.length} owed an answer, ${missing.length} not yet answered.`,
    ...reach,
    ...(result.jurisdictions.includes('EU') ? [EU_GAP] : []),
    tooMany ? `Over ${OWED_MAX} actions are owed an answer: the terms are too wide for one filing. Choose the words this exact question turns on.` : null,
    listing ? frameUntrustedContent('the regulators\' own feeds (titles and links as they publish them)', listing) : 'Nothing found in the window.',
  ].filter(Boolean).join('\n');
  return { ok: !tooMany && missing.length === 0, text, owed, missing };
};
