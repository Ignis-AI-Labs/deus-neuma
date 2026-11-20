// Legal citation sources are restricted to the authorities the office's own
// source map and recency sweep declare. Exact hostnames only: a suffix rule
// would admit an attacker host wearing an official name as a prefix.

import { LEGAL_SOURCES } from './legal-sources.js';
import { RECENCY_FEEDS } from './recency-feed-catalog.js';

const urlsIn = (value) => String(value ?? '').match(/https?:\/\/[^\s]+/gi) ?? [];
const hostOf = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

export const LEGAL_SOURCE_HOSTS = Object.freeze([...new Set([
  ...LEGAL_SOURCES.flatMap((source) => [...urlsIn(source.url), ...urlsIn(source.probe)]),
  ...RECENCY_FEEDS.map((feed) => feed.url).filter(Boolean),
].map(hostOf).filter(Boolean))].sort());

/** Pure — why a citation address is outside the declared source map, or null. */
export const legalSourceProblem = (value) => {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return 'sourceUrl must be the http(s) address you read';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return 'sourceUrl must be the http(s) address you read';
  if (url.username || url.password) return 'sourceUrl must not carry a username or password — cite the public source address';
  if (!LEGAL_SOURCE_HOSTS.includes(url.hostname.toLowerCase())) {
    return `sourceUrl host ${url.hostname} is not one of the legal office's declared sources — read and cite the authority itself`;
  }
  return null;
};
