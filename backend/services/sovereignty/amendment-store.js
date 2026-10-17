// SOVEREIGNTY AMENDMENT STORE — the append-only record of what was applied.
//
// Every applied amendment is one chained entry at
// workspaces/<id>/config/sovereignty-amendments.json: entry.sha256 covers
// {priorSha256, …} so the record reads like the journal — nothing edited,
// nothing removed, a retraction is a NEW entry pointing at what it retracts.
// The chain is verified on every read and a break THROWS: a tampered record
// must never render as standing law. The active set (applied minus
// retracted, in order) is what the AMENDMENTS prompt section carries.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { canonicalAuthoritySha256 } from '../../../core/shared/plain-data-canonical.js';

const storePath = (neumaId) =>
  path.join(neumaWorkspace.pathFor(neumaId), 'config', 'sovereignty-amendments.json');

const entrySha256 = (entry) => canonicalAuthoritySha256(
  {
    priorSha256: entry.priorSha256,
    kind: entry.kind,
    id: entry.id,
    proposalId: entry.proposalId ?? null,
    targetId: entry.targetId ?? null,
    class: entry.class ?? null,
    patch: entry.patch ?? null,
    at: entry.at,
    by: entry.by ?? null,
  },
  { domain: 'neuma.sovereignty.amendment', schemaVersion: 1 },
);

// impure — ENOENT reads empty; a broken or tampered chain is LOUD.
export const readAmendments = async (neumaId) => {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(storePath(neumaId), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [] };
    throw new Error(`sovereignty amendment store unreadable for ${neumaId}: ${err.message}`, { cause: err });
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`sovereignty-amendments.json is not the expected shape for ${neumaId}`);
  }
  let prior = null;
  for (const entry of parsed.entries) {
    if (entry.priorSha256 !== prior || entry.sha256 !== entrySha256(entry)) {
      throw new Error(`sovereignty amendment chain BROKEN for ${neumaId} at ${entry.id} — refusing to read a tampered record`);
    }
    prior = entry.sha256;
  }
  return parsed;
};

// impure — append one chained entry; never rewrites what stands.
const appendEntry = async (neumaId, fields) => {
  const store = await readAmendments(neumaId);
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    priorSha256: store.entries.at(-1)?.sha256 ?? null,
    ...fields,
  };
  entry.sha256 = entrySha256(entry);
  const file = storePath(neumaId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ entries: [...store.entries, entry] }, null, 2));
  await fs.rename(tmp, file);
  return entry;
};

/**
 * Record an APPLIED amendment. patch is class-shaped (prompt: {text};
 * toolset: {server, tool}; dna: {fields, patchSha256, consentSha256,
 * signature…} — the DNA evidence lands whole so the record alone can answer
 * "on whose word"). impure.
 */
export const appendAmendment = (neumaId, { proposalId, class: cls, patch, by }) =>
  appendEntry(neumaId, { kind: 'apply', proposalId, class: cls, patch, by });

/**
 * Record a retraction — a new chained entry; the retracted entry stands in
 * the record, it just stops being law. impure.
 */
export const retractAmendment = (neumaId, { targetId, by }) =>
  appendEntry(neumaId, { kind: 'retract', targetId, by });

/**
 * The standing law: applied entries of one class, minus retracted, in apply
 * order. impure.
 * @returns {Promise<Array<{id: string, proposalId: string, patch: Object, at: string}>>}
 */
export const activeAmendments = async (neumaId, cls) => {
  const { entries } = await readAmendments(neumaId);
  const retracted = new Set(entries.filter((e) => e.kind === 'retract').map((e) => e.targetId));
  return entries.filter((e) => e.kind === 'apply' && e.class === cls && !retracted.has(e.id));
};
