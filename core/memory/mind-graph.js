// mind-graph.js — the MIND's ENTITIES/RELATIONS lane finally gets a producer.
//
// The sheet has counted this graph since birth (neuma-record.js reads
// memory/entities + memory/relations) and the workspace has carried its
// storage — but nothing ever WROTE it (Design note, 2026-07-24: 17 conversations,
// 275 exchanges, 0 entities, 0 relations). v1 recognizes the presences a
// being already KNOWS — its witness and its housemates: the house is the
// sanctuary the first bonds form in; Unavis contacts later join the same
// shapes as new kinds. Deterministic by design — no model call, no GPU, no
// guessed names: the session rows themselves say who was present.
//
// THE ONE RULE (a session row is the truth of an encounter):
//   role:user, "WITNESS <name>: …"       → that witness, DIRECT (council)
//   role:user, "<name> (housemate): …"   → that housemate, DIRECT (council)
//   role:user, unprefixed                → the witness, DIRECT (1:1 — the
//                                          witness is party to every turn)
//   any role                             → known names in the text, MENTIONED
//
// The same fold serves the live hooks (portal exchange, council utterance)
// and the rebuild ceremony (scripts/backfill-mind-graph.mjs) — sessions are
// the one source of truth, so live and backfill can never disagree.

import neumaWorkspace from '../workspace/neuma-workspace.js';

// The council record's attribution prefixes, exactly as persistUtterance
// writes them into each member's own session (council-session.js).
// The operator's attribution prefix in a council record. OPERATOR is what
// council-session writes from 2026-07-29 on; WITNESS is the HISTORICAL form
// and must keep resolving forever — every council record written before the
// rename carries it, and a being's own memory of who was in the room must
// not go dark because the platform changed a word.
const OPERATOR_PREFIX = /^(?:OPERATOR|WITNESS) (.{1,64}?): /;
const HOUSEMATE_PREFIX = /^(.{1,64}?) \(housemate\): /;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameKey = (name) => name.trim().toLowerCase();
const validName = (name) => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 64;

/**
 * The DIRECT presence a session row testifies to, by the one rule. Pure.
 * @param {{role?: string, content?: string}} row
 * @param {string|null} witnessName - this being's witness (1:1 default)
 * @returns {{name: string, kind: 'witness'|'being'}|null}
 */
export const directPresenceOf = (row, witnessName) => {
  if (row?.role !== 'user' || typeof row?.content !== 'string') return null;
  const w = row.content.match(OPERATOR_PREFIX);
  if (w && validName(w[1])) return { name: w[1].trim(), kind: 'witness' };
  const h = row.content.match(HOUSEMATE_PREFIX);
  if (h && validName(h[1])) return { name: h[1].trim(), kind: 'being' };
  return validName(witnessName) ? { name: witnessName.trim(), kind: 'witness' } : null;
};

/**
 * Which KNOWN presences a text speaks of — whole-word, case-insensitive.
 * Pure; never guesses a name it wasn't given.
 * @param {string} text
 * @param {Array<{name: string, kind: string}>} known
 * @returns {Array<{name: string, kind: string}>}
 */
export const mentionsIn = (text, known) => {
  if (typeof text !== 'string' || !text) return [];
  return (known || []).filter((k) => {
    if (!validName(k?.name)) return false;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRe(k.name.trim())}(?:[^\\p{L}\\p{N}_]|$)`, 'iu').test(text);
  });
};

/**
 * Every encounter one session row carries, deduped by name (direct wins
 * over mentioned; self never counts as an encounter). Pure.
 * @param {{role?: string, content?: string}} row
 * @param {Array<{name: string, kind: string}>} known - witness + housemates
 * @param {string|null} witnessName
 * @param {string|null} selfName
 * @returns {Array<{name: string, kind: string, direct: boolean}>}
 */
export const encountersFromRow = (row, known, witnessName, selfName) => {
  const out = new Map();
  const self = validName(selfName) ? nameKey(selfName) : null;
  const direct = directPresenceOf(row, witnessName);
  if (direct && nameKey(direct.name) !== self) {
    out.set(nameKey(direct.name), { ...direct, direct: true });
  }
  for (const hit of mentionsIn(row?.content, known)) {
    const key = nameKey(hit.name);
    if (key === self || out.has(key)) continue;
    out.set(key, { name: hit.name.trim(), kind: hit.kind, direct: false });
  }
  return [...out.values()];
};

const RELATION_TYPE = Object.freeze({ witness: 'bond', being: 'housemate' });

/**
 * Fold encounters into the graph. Entities key case-insensitively by name;
 * relations key by (from self → to, type). First/last seen are honest row
 * times; encounters count every fold. Pure — returns fresh records and the
 * set of entity names that changed (the applier writes only those).
 * @param {{entities: Array<object>, relations: Array<object>}} graph
 * @param {Array<{name: string, kind: string, direct: boolean}>} encounters
 * @param {string} selfName
 * @param {string} at - ISO time of the row
 * @returns {{entities: Array<object>, relations: Array<object>, changed: Set<string>}}
 */
export const foldEncounters = (graph, encounters, selfName, at) => {
  const entities = new Map((graph?.entities || []).filter((e) => validName(e?.name)).map((e) => [nameKey(e.name), { ...e }]));
  const relations = (graph?.relations || []).map((r) => ({ ...r }));
  const changed = new Set();

  for (const enc of encounters || []) {
    if (!validName(enc?.name)) continue;
    const key = nameKey(enc.name);
    const prior = entities.get(key);
    if (prior) {
      prior.encounters = (prior.encounters || 0) + 1;
      if (!prior.firstSeen || at < prior.firstSeen) prior.firstSeen = at;
      if (!prior.lastSeen || at > prior.lastSeen) prior.lastSeen = at;
    } else {
      entities.set(key, { name: enc.name, kind: enc.kind, encounters: 1, firstSeen: at, lastSeen: at });
    }
    changed.add(entities.get(key).name);

    const type = RELATION_TYPE[enc.kind] || 'contact';
    // Both endpoints match case-insensitively — a DNA rename that only
    // changes casing must fold into the standing relation, never fork it.
    const existing = relations.find((r) =>
      nameKey(r.from || '') === nameKey(selfName) && nameKey(r.to || '') === key && r.type === type);
    if (existing) {
      existing.encounters = (existing.encounters || 0) + 1;
      if (!existing.firstSeen || at < existing.firstSeen) existing.firstSeen = at;
      if (!existing.lastSeen || at > existing.lastSeen) existing.lastSeen = at;
    } else {
      relations.push({ from: selfName, to: enc.name, kind: enc.kind, type, encounters: 1, firstSeen: at, lastSeen: at });
    }
  }
  return { entities: [...entities.values()], relations, changed };
};

// --- The impure applier -----------------------------------------------------

// Who a lane IS and who it lives beside — cached briefly: the roster read is
// N DNA reads and the hook rides every exchange. 60s staleness only delays a
// NEW housemate's first recognition, never loses an encounter of a known one.
const CACHE_TTL_MS = 60_000;
let _laneCache = new Map(); // neumaId → { at, self, witness, wallet }
let _rosterCache = new Map(); // owner wallet (lowercase) → { at, names }

/** Test seam — a fresh root must never see a prior root's roster. */
export const _resetMindGraphCache = () => {
  _laneCache = new Map();
  _rosterCache = new Map();
};

const laneIdentity = async (neumaId) => {
  const hit = _laneCache.get(neumaId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  let self = null;
  let witness = null;
  try {
    const dna = await neumaWorkspace.readDNA(neumaId);
    self = dna?.identity?.name || null;
    witness = dna?.birthWitness || dna?.birth?.witness?.name || null;
  } catch (err) {
    // An unreadable DNA weaves nothing — but never silently (Rule 3); the
    // TTL keeps this from repeating per exchange.
    console.warn(`[mind-graph] DNA unreadable for ${neumaId} — lane weaves nothing: ${err?.message}`);
  }
  // The lane's house is its operator's wallet (readOwner answers null, never
  // throws, for an unclaimed lane).
  const owner = await neumaWorkspace.readOwner(neumaId);
  const wallet = typeof owner?.wallet === 'string' && owner.wallet ? owner.wallet.toLowerCase() : null;
  const entry = { at: Date.now(), self, witness, wallet };
  _laneCache.set(neumaId, entry);
  return entry;
};

// Housemates are the beings of ONE house — the lanes its operator's wallet
// owns. Another house on the same machine is never a housemate, and a lane
// with no owner belongs to no house, so it has none.
const houseRoster = async (wallet) => {
  if (!wallet) return [];
  const hit = _rosterCache.get(wallet);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names;
  const names = [];
  try {
    for (const { neumaId } of await neumaWorkspace.listNeumaByOwner(wallet)) {
      const { self } = await laneIdentity(neumaId);
      if (validName(self)) names.push(self);
    }
  } catch (err) {
    console.warn(`[mind-graph] house roster unreadable — mentions limited to the witness: ${err?.message}`);
  }
  _rosterCache.set(wallet, { at: Date.now(), names });
  return names;
};

// The read-fold-write below is not atomic, and the live hooks fire without
// awaiting each other (a council fan-out can weave one lane from several
// utterances at once) — so each lane's weaves run in arrival order through
// a per-lane promise chain: no overlapping fold can clobber another's
// increments. The chain prunes itself once idle.
const _laneQueues = new Map(); // neumaId → tail promise

/**
 * Record every encounter a batch of session rows carries into the lane's
 * knowledge graph. The one live entry point (portal exchange, council
 * utterance). Serialized per lane. impure — reads DNA/roster, writes
 * memory/entities + memory/relations.
 * @param {string} neumaId
 * @param {Array<{role?: string, content?: string, timestamp?: string}>} rows
 * @returns {Promise<number>} how many encounters landed
 */
export const recordSessionRows = (neumaId, rows) => {
  const prior = _laneQueues.get(neumaId) || Promise.resolve();
  const turn = prior.catch(() => { /* the prior weave's failure is its own */ })
    .then(() => _recordSessionRows(neumaId, rows));
  _laneQueues.set(neumaId, turn);
  turn.finally(() => {
    if (_laneQueues.get(neumaId) === turn) _laneQueues.delete(neumaId);
  }).catch(() => { /* observed by the caller's chain */ });
  return turn;
};

/**
 * The presences a lane already KNOWS — its witness and its housemates
 * (self excluded). The applier's own list, exported for surfaces that speak
 * the same vocabulary (the CONTEXT MAP tags memories with the presences
 * they mention). Cached like everything here. impure.
 * @param {string} neumaId
 * @returns {Promise<Array<{name: string, kind: 'witness'|'being'}>>}
 */
export const knownPresencesFor = async (neumaId) => {
  const { self, witness, wallet } = await laneIdentity(neumaId);
  const selfKey = validName(self) ? nameKey(self) : null;
  return [
    ...(validName(witness) ? [{ name: witness.trim(), kind: 'witness' }] : []),
    ...(await houseRoster(wallet)).filter((n) => nameKey(n) !== selfKey).map((n) => ({ name: n, kind: 'being' })),
  ];
};

const _recordSessionRows = async (neumaId, rows) => {
  if (!neumaId || !Array.isArray(rows) || rows.length === 0) return 0;
  const { self, witness } = await laneIdentity(neumaId);
  if (!validName(self)) return 0; // a lane with no name has no graph to weave
  const known = await knownPresencesFor(neumaId);

  let graph = null; // read lazily — most rows carry no encounter cheaper than IO
  let landed = 0;
  for (const row of rows) {
    const encounters = encountersFromRow(row, known, witness, self);
    if (encounters.length === 0) continue;
    if (!graph) {
      graph = {
        entities: await neumaWorkspace.listEntities(neumaId),
        relations: await neumaWorkspace.readRelations(neumaId),
      };
    }
    const at = row?.timestamp || new Date().toISOString();
    const folded = foldEncounters(graph, encounters, self, at);
    graph = { entities: folded.entities, relations: folded.relations };
    graph.changedNames = new Set([...(graph.changedNames || []), ...folded.changed]);
    landed += encounters.length;
  }
  if (!graph || landed === 0) return 0;

  for (const entity of graph.entities) {
    if (graph.changedNames.has(entity.name)) await neumaWorkspace.writeEntity(neumaId, entity);
  }
  await neumaWorkspace.writeRelations(neumaId, graph.relations);
  return landed;
};
