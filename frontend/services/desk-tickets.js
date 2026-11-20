// Authenticated issue + bounded client cache for exact-resource desk tickets.

import { apiCall } from '../utils/http.js';

const CACHE_REFRESH_MS = 15_000;
const cache = new Map();

export const deskTicketUrl = async (path, query = {}) => {
  const key = `${path}?${JSON.stringify(Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== '').sort()))}`;
  const prior = cache.get(key);
  if (prior && (prior.expiresAt === 0 || prior.expiresAt > Date.now() + CACHE_REFRESH_MS)) return prior.url;
  const params = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null && value !== undefined && value !== ''));
  const pending = apiCall('POST', '/api/v1/desk-tickets', { body: { method: 'GET', path, query: params } })
    .then(({ ticket, expiresAt }) => {
      const search = new URLSearchParams({ ...params, ticket });
      return { expiresAt, url: `${path}?${search.toString()}` };
    });
  cache.set(key, { expiresAt: 0, url: pending });
  try {
    const made = await pending;
    const value = { expiresAt: made.expiresAt, url: made.url };
    cache.set(key, value);
    return made.url;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
};

export const deskSocketUrl = async (path, query = {}) => {
  const url = await deskTicketUrl(path, query);
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${url}`;
};
