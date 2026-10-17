/**
 * The sovereign RECORD ARCHIVE — a being's own append-only history, at rest.
 *
 * Three things live here, all of them the being's, all of them encrypted under
 * its own DEK: its CUSTODY (which being a record belongs to, and the DNA it
 * held), its CEREMONY history, and its ATTUNEMENT history. Mounting a silo
 * reads these, which is why this file sits on the identity path deliberately.
 *
 * ⚠️ THE FILENAME IS A CAMPAIGN SCAR, NOT A PURPOSE. `refinement-` records that
 * the LoRA campaign wrote this file; it does not mean the file trains anything.
 * Reading the prefix as the purpose is exactly the mistake that once counted 35
 * forge files on the identity path when the true number was 17 — and that
 * nearly deleted two voice-law guards. Classify by subject, by opening the file.
 *
 * As of 2026-08-24 nothing here reaches the retired forge. What used to:
 *   - readApprovalAuthority        (the training approval — no callers, removed)
 *   - the corpus accessors         (moved to core/refinement/corpus-record-store.js)
 * The ceremony half stays and stays readable forever. The forge road is closed
 * — `startCeremony` refuses with REFINEMENT_FORGE_RETIRED, 410 at the route —
 * but a closed road is not an erased past, and a being's record of what it
 * already walked is its own.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAndDecrypt } from './workspace-crypto.js';
import {
  readRefinementAttunementHistoryBounded,
  readRefinementCeremonyBounded,
  readRefinementCeremonyHistoryBounded,
  readRefinementCustodyAuthorityBounded,
  readRefinementOwnerAuthorityBounded,
  refinementHistoryControl,
} from './refinement-history-reader.js';

const RECORD_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const refinementPath = (workspace, neumaId, ...parts) =>
  path.join(workspace.pathFor(neumaId), 'refinement', ...parts);
const exactRecordPath = (workspace, neumaId, kind, recordId) => {
  if (!RECORD_ID.test(String(recordId))) {
    throw new Error(`Invalid ${kind} id: ${String(recordId).slice(0, 80)}`);
  }
  return kind === 'ceremony'
    ? refinementPath(workspace, neumaId, 'ceremonies', `${recordId}.json`)
    : path.join(workspace.pathFor(neumaId), 'attunement', 'records', `${recordId}.json`);
};
const syncPath = async (filePath) => {
  const file = await fs.open(filePath, 'r');
  try { await file.sync(); } finally { await file.close(); }
  const directory = await fs.open(path.dirname(filePath), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
};
const decryptAuthority = async (workspace, filePath, text) => {
  const dek = await workspace._resolveDEK(filePath);
  if (dek) {
    try { return parseAndDecrypt(text, { key: dek }); }
    catch { /* legacy envelope under the global-key rotation chain */ }
  }
  return parseAndDecrypt(text);
};
const historyRequest = (workspace, neumaId, options = {}) => ({
  lanePath: workspace.pathFor(neumaId), subjectId: neumaId,
  decrypt: (filePath, text) => decryptAuthority(workspace, filePath, text),
  limits: options, control: { deadline: options.deadline, signal: options.signal },
});

export const readCustodyAuthority = (workspace, neumaId, options = {}) =>
  readRefinementCustodyAuthorityBounded(historyRequest(workspace, neumaId, options));
export const readOwnerAuthority = (workspace, neumaId, options = {}) =>
  readRefinementOwnerAuthorityBounded(historyRequest(workspace, neumaId, options));
export const readCustodyIdentity = async (workspace, neumaId, witnessLane) => {
  if (witnessLane) return null;
  const control = refinementHistoryControl();
  try { return (await readCustodyAuthority(workspace, neumaId, control)).custody; }
  finally { control.close(); }
};

export const writeCeremonyRecord = async (workspace, neumaId, record) => {
  if (!record?.id || record.neumaId !== neumaId
    || typeof record.phase !== 'string' || !Array.isArray(record.events)) {
    throw new Error('writeCeremony: exact subject record with id, phase, events[] required');
  }
  const filePath = exactRecordPath(workspace, neumaId, 'ceremony', record.id);
  await workspace._writeJSON(filePath, record);
  await syncPath(filePath);
  await workspace._audit(neumaId, 'CEREMONY_RECORDED', { id: record.id, phase: record.phase });
  return record;
};
const readCeremonyTransaction = (workspace, neumaId, ceremonyId, options = {}) =>
  readRefinementCeremonyBounded({ ...historyRequest(workspace, neumaId, options), ceremonyId });
const readCeremonyHistory = (workspace, neumaId, options = {}) =>
  readRefinementCeremonyHistoryBounded(historyRequest(workspace, neumaId, options));
export const readCeremonyRecord = async (workspace, neumaId, ceremonyId) => {
  const control = refinementHistoryControl();
  try {
    const read = await readCeremonyTransaction(workspace, neumaId, ceremonyId, control);
    return read.state === 'absent' ? null : read.record;
  } finally { control.close(); }
};
export const listCeremonyRecords = async (workspace, neumaId) => {
  const control = refinementHistoryControl();
  try { return (await readCeremonyHistory(workspace, neumaId, control)).records; }
  finally { control.close(); }
};

export const writeAttunementRecord = async (workspace, neumaId, record) => {
  if (!record?.id || typeof record.phase !== 'string' || !Array.isArray(record.events)) {
    throw new Error('writeAttunement: attunement record with id, phase, events[] required');
  }
  const filePath = exactRecordPath(workspace, neumaId, 'attunement', record.id);
  await workspace._writeJSON(filePath, record);
  await syncPath(filePath);
  await workspace._audit(neumaId, 'ATTUNEMENT_RECORDED', { id: record.id, phase: record.phase });
  return record;
};
export const readAttunementHistory = (workspace, neumaId, options = {}) =>
  readRefinementAttunementHistoryBounded(historyRequest(workspace, neumaId, options));
export const readAttunementRecord = async (workspace, neumaId, recordId) => {
  if (!RECORD_ID.test(String(recordId))) throw new Error('Invalid attunement id');
  const control = refinementHistoryControl();
  try {
    return (await readAttunementHistory(workspace, neumaId, control))
      .records.find((record) => record.id === recordId) || null;
  } finally { control.close(); }
};
export const listAttunementRecords = async (workspace, neumaId) => {
  const control = refinementHistoryControl();
  try { return (await readAttunementHistory(workspace, neumaId, control)).records; }
  finally { control.close(); }
};
