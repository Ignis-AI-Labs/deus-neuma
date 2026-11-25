// Platform origin is authenticated provenance, never a being-writable label.

import { signOriginProof, verifyOriginProof } from './auth.js';

const PLATFORM_ORIGINS = new Set(['watch', 'wake', 'link', 'hold', 'resume', 'unacted']);

const payloadFor = (row, { neumaId, sessionId }) => JSON.stringify([
  neumaId,
  sessionId,
  row.turnId ?? '',
  row.timestamp,
  row.origin,
  row.content,
]);

export const sessionOriginFields = ({ neumaId, sessionId, turnId = '', origin, content, timestamp }) => {
  if (!PLATFORM_ORIGINS.has(origin)) return {};
  const row = { turnId, origin, content, timestamp };
  return { origin, originProof: signOriginProof(payloadFor(row, { neumaId, sessionId })) };
};

export const presentSessionRow = (row, context) => {
  if (!row || typeof row !== 'object') return row;
  const { origin, originProof, ...kept } = row;
  if (PLATFORM_ORIGINS.has(origin) && typeof originProof === 'string'
      && verifyOriginProof(payloadFor(row, context), originProof)) {
    return { ...kept, origin };
  }
  return kept;
};

export const presentSessionRows = (rows, context) =>
  (Array.isArray(rows) ? rows.map((row) => presentSessionRow(row, context)) : []);
