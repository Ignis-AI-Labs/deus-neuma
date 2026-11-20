// Short-lived, exact-resource capabilities for browser lanes that cannot send Authorization.

import crypto from 'node:crypto';
import { createSessionToken, requireAuth, verifySessionToken } from './auth.js';

export const DESK_TICKET_TTL_MS = 60_000;
const MAX_TICKETS = 2048;
const tickets = new Map();

const LANES = Object.freeze({
  '/api/v1/gallery/file': { method: 'GET', required: ['rootId', 'rel'], optional: [] },
  '/api/v1/user/files/raw': { method: 'GET', required: ['path'], optional: [] },
  '/api/v1/user/files/events': { method: 'GET', required: [], optional: [] },
  '/terminal-ws': { method: 'GET', required: [], optional: ['cwd', 'launch', 'term'] },
  '/dictate-ws': { method: 'GET', required: [], optional: [] },
});
const FACE = /^\/api\/v1\/brands\/faces\/[a-z0-9-]+\/file$/;
const laneFor = (path) => FACE.test(path)
  ? { method: 'GET', required: [], optional: [] }
  : LANES[path] ?? null;

export const canonicalDeskLane = ({ method = 'GET', path, query = {} }) => {
  const lane = typeof path === 'string' ? laneFor(path) : null;
  if (!lane || method !== lane.method || !query || typeof query !== 'object' || Array.isArray(query)) return null;
  const allowed = new Set([...lane.required, ...lane.optional]);
  const canonical = {};
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return null;
    canonical[key] = value;
  }
  if (lane.required.some((key) => !canonical[key])) return null;
  return { method, path, query: Object.fromEntries(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b))) };
};

const hash = (ticket) => crypto.createHash('sha256').update(ticket).digest('hex');
const sweep = (now) => {
  for (const [key, row] of tickets) if (row.expiresAt <= now || row.sessionExpiresAt <= now) tickets.delete(key);
  while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value);
};
const cleanup = setInterval(() => sweep(Date.now()), DESK_TICKET_TTL_MS);
cleanup.unref?.();

export const issueDeskTicket = ({ address, sessionExpiresAt, method = 'GET', path, query = {}, now = Date.now() }) => {
  const lane = canonicalDeskLane({ method, path, query });
  if (!lane || typeof address !== 'string' || !Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= now) return null;
  sweep(now);
  const ticket = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Math.min(now + DESK_TICKET_TTL_MS, sessionExpiresAt);
  tickets.set(hash(ticket), { address: address.toLowerCase(), sessionExpiresAt, expiresAt, lane });
  return { ticket, expiresAt };
};

export const resolveDeskTicket = (ticket, { method = 'GET', path, query = {}, now = Date.now() }) => {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const lane = canonicalDeskLane({ method, path, query });
  const row = tickets.get(hash(ticket));
  if (!lane || !row || row.expiresAt <= now || row.sessionExpiresAt <= now
      || JSON.stringify(row.lane) !== JSON.stringify(lane)) return null;
  return { address: row.address, expiresAt: row.sessionExpiresAt, ticketExpiresAt: row.expiresAt };
};

export const deskTicketSessionForUrl = (rawUrl, method = 'GET', now = Date.now()) => {
  try {
    const url = new URL(rawUrl, 'http://localhost');
    const query = Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'ticket'));
    return resolveDeskTicket(url.searchParams.get('ticket'), { method, path: url.pathname, query, now });
  } catch {
    return null;
  }
};

export const mapDeskTicketToBearer = (req) => {
  if (req.headers.authorization) return false;
  const session = deskTicketSessionForUrl(req.originalUrl || req.url, req.method);
  if (!session) return false;
  req.headers.authorization = `Bearer ${createSessionToken(session.address)}`;
  return true;
};

export const requireDeskAuth = (req, res, next) => {
  const session = deskTicketSessionForUrl(req.originalUrl || req.url, req.method);
  if (session) {
    req.walletAddress = session.address;
    req.deskSession = session;
    return next();
  }
  return requireAuth(req, res, next);
};

export const sessionExpiryForRequest = (req) => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? verifySessionToken(header.slice(7))?.expiresAt ?? null : null;
};
