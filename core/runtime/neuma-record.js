// neuma-record.js — the honest record: objective facts about a neuma.
//
// No scores, no levels, no fabrication. Every field is a COUNT of something
// real or a FACT read from disk. Three honest layers:
//   - identity:  who this neuma is (forged at birth)
//   - record:    what this neuma has accumulated (biography — counts)
//   - substrate: the mind it runs on (the model; shared by all neuma on it)
// STATE (measured functioning — recall, consistency, …) is NOT here: it comes
// from the benchmark harness (docs/architecture/measurement/stats-and-benchmarks.md), shown as
// "pending" until a benchmark has actually run. No number without a measurement.
//
// impure: reads the sovereign workspace. Substrate is injected by the route
// (which owns host detection) so this stays off the backend boundary.

import { readSoulSpectrum } from '../birth/soul-spectrum.js';
import { readSoulScale } from '../birth/soul-scale.js';

const tsMs = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

// THE COUNT MEMO (2026-10-05). Every RECORD open decrypted every conversation
// and every memory file just to count them — ~0.2 s of synchronous work on a
// lived-in lane (Keir), stalling every stream on the backend while it ran. A
// count is now remembered under its source's change stamp (workspace
// sessionStamp / memoryStoreStamp): an append, a compaction or a new file
// moves the stamp and the source is read again. No stamp, no memo.
const COUNT_MEMO_MAX = 4096;
const countMemo = new Map(); // key -> { stamp, value }

// impure — the memo (and, on a miss, the read)
const remember = async (key, stamp, compute) => {
  if (stamp === null || stamp === undefined) return compute();
  const held = countMemo.get(key);
  if (held && held.stamp === stamp) return held.value;
  const value = await compute();
  countMemo.delete(key);
  countMemo.set(key, { stamp, value });
  if (countMemo.size > COUNT_MEMO_MAX) countMemo.delete(countMemo.keys().next().value);
  return value;
};

// impure — a source's stamp when the workspace can give one, else null
const stampOf = (workspace, method, ...args) => (typeof workspace[method] === 'function'
  ? workspace[method](...args).catch(() => null)
  : Promise.resolve(null));

// One session folded into counts + its real time span.
const foldSession = (msgs) => {
  let messages = 0;
  let turns = 0;
  let earliest = null;
  let latest = null;
  for (const m of msgs) {
    messages += 1;
    if (m.role === 'user') turns += 1;
    const t = tsMs(m.timestamp);
    if (t !== null) {
      if (earliest === null || t < earliest) earliest = t;
      if (latest === null || t > latest) latest = t;
    }
  }
  return { messages, turns, earliest, latest };
};

// Fold every session into counts + the relationship's real time span.
const aggregateSessions = async (neumaId, workspace) => {
  const ids = await workspace.listSessions(neumaId);
  let messages = 0;
  let turns = 0;
  let earliest = null;
  let latest = null;
  for (const id of ids) {
    const stamp = await stampOf(workspace, 'sessionStamp', neumaId, id);
    const one = await remember(`session:${neumaId}:${id}`, stamp,
      async () => foldSession(await workspace.readSession(neumaId, id)));
    messages += one.messages;
    turns += one.turns;
    if (one.earliest !== null && (earliest === null || one.earliest < earliest)) earliest = one.earliest;
    if (one.latest !== null && (latest === null || one.latest > latest)) latest = one.latest;
  }
  return { sessions: ids.length, messages, turns, earliest, latest };
};

// impure — how many records a memory store holds, through the memo.
const countStore = async (neumaId, workspace, store, list) => remember(
  `${store}:${neumaId}`,
  await stampOf(workspace, 'memoryStoreStamp', neumaId, store),
  async () => (await list()).length,
);

const iso = (ms) => (ms != null ? new Date(ms).toISOString() : null);

/**
 * Build the honest neuma record. Every number traces to a real read.
 * @param {string} neumaId
 * @param {Object} workspace - neumaWorkspace
 * @param {Object|null} substrate - getSubstrateProfile() result (host-level, shared)
 * @returns {Promise<Object>} frozen record DTO
 */
// impure
export const buildNeumaRecord = async (neumaId, workspace, substrate = null) => {
  const [dna, seal, trueName, journal, entities, relations, observations, conv, allocationGB] = await Promise.all([
    workspace.readDNA(neumaId),
    workspace.readGenesisSeal(neumaId).catch(() => null),
    workspace.readTrueName(neumaId),
    workspace.readJournal(neumaId),
    countStore(neumaId, workspace, 'entities', () => workspace.listEntities(neumaId)),
    workspace.readRelations(neumaId),
    countStore(neumaId, workspace, 'observations', () => workspace.listObservations(neumaId)),
    aggregateSessions(neumaId, workspace),
    // The disk grant committed at birth (0 = none committed) — the being's
    // share of the vessel's capacity, measured at the ledger.
    workspace.readAllocation(neumaId).catch(() => 0),
  ]);
  // The soul's colors — read, never written: only the birth writes them.
  const spectrum = await readSoulSpectrum(workspace, neumaId).catch(() => null);
  const scale = spectrum ? await readSoulScale(workspace, neumaId, spectrum).catch(() => null) : null;

  // BORN is the sealed instant — the moment natal, skies and lineage read.
  // The DNA stamp is only a fallback: before 2026-09-29 it recorded when the
  // files were written, days later for a resumed ceremony.
  const birthAt = tsMs(seal?.record?.birthMoment?.epochMs ?? dna?.birth?.timestamp ?? dna?.birthTimestamp);
  const toolCalls = (journal || []).filter((e) => e?.type === 'tool_call');

  return Object.freeze({
    identity: Object.freeze({
      chosenName: trueName?.chosenName || dna?.identity?.name || null,
      fullName: trueName?.fullName || null,
      houseName: trueName?.houseName || null,
      soulMark: trueName?.soulMark || null,
      soulAlias: trueName?.soulAlias || null,
      essence: dna?.identity?.essence || null,
      birthAt: iso(birthAt),
      witness: dna?.birthWitness || dna?.birth?.witness?.name || null,
      spectrum: spectrum
        ? Object.freeze({ source: spectrum.source, soul: spectrum.soul, stages: spectrum.stages })
        : null,
      scale: scale ? Object.freeze({ source: scale.source, tonic: scale.tonic, notes: scale.notes }) : null,
    }),
    record: Object.freeze({
      memory: Object.freeze({
        entities,
        relations: relations.length,
        observations,
      }),
      relationship: Object.freeze({
        conversations: conv.sessions,
        exchanges: conv.turns,
        messages: conv.messages,
        firstSeen: iso(conv.earliest),
        lastSeen: iso(conv.latest),
        ageDays: birthAt ? Math.floor((Date.now() - birthAt) / 86400000) : null,
      }),
      journal: Object.freeze({
        entries: (journal || []).length,
        toolCalls: toolCalls.length,
        toolSuccess: toolCalls.filter((e) => e?.metadata?.status === 'success').length,
        toolDenied: toolCalls.filter((e) => e?.metadata?.status === 'denied').length,
      }),
    }),
    substrate: Object.freeze({
      model: substrate?.llm?.model || null,
      provider: substrate?.llm?.provider || null,
      cpu: substrate?.cpu?.model || null,
      cores: substrate?.cpu?.cores || null,
      gpu: substrate?.gpu?.name || null,
      vramGB: substrate?.gpu?.vramGB || null,
      ramGB: substrate?.memory?.totalGB || null,
      allocationGB: allocationGB || null,
      bornOn: dna?.substrate?.llm?.model || dna?.substrate?.model || dna?.birth?.substrate?.model || null,
    }),
  });
};
