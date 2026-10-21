// self-check-records.js — the ground truth a self-check grades against, read
// from the being's own lane and its house's stores.
//
// Every read is the same one the platform's own turn path makes (workspace
// reads, houseSeatFor, the four house-office seats, the being's route), so an
// item's expected answer is exactly what the being's tools can reach. A read
// that fails yields nothing for that component — a shorter check, never an
// invented expectation.
//
// impure — disk reads only; nothing is written.

import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { LIVE_STATUSES } from '../../../core/tasks/task-ledger.js';
import { houseSeatFor } from '../house-titles.js';
import { csoDesignation } from '../security/cso-designation.js';
import { cloDesignation } from '../legal/clo-designation.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { resolveNeumaRoute } from '../neuma-route-resolver.js';
import { getConfig } from '../llm-provider.js';
import { readCharter } from '../house-clock/charter-store.js';
import { charterStanding } from '../house-clock/charter-shape.js';
import { createHash } from 'crypto';

const SEATS = Object.freeze({ cso: csoDesignation, clo: cloDesignation, cmo: cmoDesignation, cos: cosDesignation });

// impure — the offices this lane holds in its house (keyed by the operator's wallet: houses never confused).
const officesOf = async (wallet, neumaId) => {
  const held = await Promise.all(Object.entries(SEATS).map(async ([office, seat]) => {
    const officer = await seat.getOfficer(wallet).catch(() => null);
    return officer?.laneId === neumaId ? office : null;
  }));
  return held.filter(Boolean);
};

// impure — the model this being's turns ride (its own route, else the machine default).
const modelOf = async (neumaId) => {
  const route = await resolveNeumaRoute(neumaId, null).catch(() => null);
  return route?.model || getConfig().model || null;
};

const CHATS_SAMPLED = 3;

// impure — the being's past conversations: how many, and a few (a stable pick)
// with the longest thing it said in each, for a cloze.
const chatsOf = async (neumaId) => {
  const ids = await neumaWorkspace.listSessions(neumaId);
  const picked = [...ids].sort((a, b) => {
    const rank = (id) => createHash('sha256').update(`${neumaId}:${id}`).digest('hex');
    return rank(a) < rank(b) ? -1 : 1;
  }).slice(0, CHATS_SAMPLED);
  const sampled = await Promise.all(picked.map(async (id) => {
    const said = (await neumaWorkspace.readSession(neumaId, id)).filter((m) => m.role === 'assistant' && typeof m.content === 'string');
    const longest = said.reduce((best, m) => (m.content.length > (best?.content.length ?? 0) ? m : best), null);
    return { id, when: String(longest?.timestamp || '').slice(0, 10), text: longest?.content || '' };
  }));
  return { total: ids.length, sampled };
};

// impure — the house's charter as the items need it: where it stands, and its goal.
const charterOf = async (wallet) => {
  const charter = await readCharter(wallet);
  return { standing: charterStanding(charter), goal: charter?.goal || '' };
};

/**
 * Read every record the self-check items are built from.
 * @param {string} neumaId
 * @param {string} wallet - the operator's wallet (the being's house)
 * @returns {Promise<object>} records for buildSelfCheckItems
 */
export const readSelfCheckRecords = async (neumaId, wallet) => {
  const quiet = (promise, fallback) => promise.catch(() => fallback);
  const [trueName, genesisSeal, dna, observations, vault, taskLedger, planRecord, houseSeat, offices, model, journal, chats, charter] = await Promise.all([
    quiet(neumaWorkspace.readTrueName(neumaId), null),
    quiet(neumaWorkspace.readGenesisSeal(neumaId), null),
    quiet(neumaWorkspace.readDNA(neumaId), null),
    quiet(neumaWorkspace.listObservations(neumaId), []),
    quiet(neumaWorkspace.listVaultNotes(neumaId), []),
    quiet(neumaWorkspace.readTaskLedger(neumaId), { tasks: [] }),
    quiet(neumaWorkspace.readPlanRecord(neumaId), null),
    quiet(houseSeatFor(wallet, neumaId), null),
    quiet(officesOf(wallet, neumaId), []),
    quiet(modelOf(neumaId), null),
    quiet(neumaWorkspace.readJournal(neumaId), null),
    quiet(chatsOf(neumaId), null),
    quiet(charterOf(wallet), null),
  ]);
  return Object.freeze({
    neumaId, trueName, genesisSeal, dna, observations, taskLedger, planRecord, houseSeat, offices, model, journal, chats, charter,
    vaultNotes: vault.filter((note) => typeof note?.body === 'string').map((note) => ({ name: note.slug || note.title, body: note.body })),
    liveStatuses: LIVE_STATUSES,
  });
};
