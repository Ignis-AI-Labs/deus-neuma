/**
 * RECALL DOCS — the pure document shapes of the recall engine.
 *
 * Extracted from neuma-recall.js under the size law + decomposition-first
 * (harness-friction-map T2 landed the append lane and pushed the engine past
 * the cap): these four helpers are PURE — no index, no workspace, no state —
 * and every consumer (the engine, the append lane, compactors, tests)
 * imports them from neuma-recall.js's re-export barrel unchanged.
 */
import { normalizeSpace } from './space.js';
import { RECALL_BUDGET_R } from './recall-budgets.js';
import { isValidAt } from './recall-eligibility.js';

// The barrel stays in neuma-recall.js (wide-import-fan law): path-pinned
// importers keep working; new code may import from here directly.

/**
 * Render a structured observation into searchable text (query side). Pure.
 * @param {Object} obs - Observation record
 * @returns {string} Concatenated searchable text
 */
export const observationToText = (obs) => {
  if (!obs || typeof obs !== 'object') return '';
  const fields = ['userMessage', 'response', 'content', 'text', 'summary'];
  return fields
    .map((f) => (typeof obs[f] === 'string' ? obs[f] : ''))
    .join(' ')
    .trim();
};

/**
 * Render a structured observation into the human-readable string the prompt
 * assembler surfaces as a recalled memory. Pure.
 * @param {Object} obs - Observation record
 * @returns {string} Readable memory line
 */
export const observationToMemory = (obs) => {
  if (!obs || typeof obs !== 'object') return '';
  if (obs.type === 'exchange') {
    const witness = (obs.userMessage || '').trim();
    const reflected = (obs.response || '').trim();
    if (witness && reflected) return `The operator said: "${witness}" — you reflected: "${reflected}"`;
    return reflected || witness;
  }
  return observationToText(obs);
};

/**
 * Build searchable documents from observation records. Records with no usable
 * text are dropped. Pure.
 * @param {Array<Object>} observations - Observation records
 * @returns {Array<{id:number,text:string,memory:string,timestamp:(string|null),emotion:(string|null)}>}
 */
export const buildDocs = (observations) => {
  const docs = [];
  let id = 0;
  for (const obs of observations || []) {
    const text = observationToText(obs);
    if (!text) continue;
    const recordedAt = obs.recordedAt || obs.timestamp || null;
    docs.push({
      id: id++,
      obsId: obs.id ?? null,
      text,
      memory: observationToMemory(obs),
      timestamp: recordedAt,
      occurredAt: obs.occurredAt || recordedAt,
      recordedAt,
      invalidatedAt: obs.invalidatedAt || null,
      supersededBy: obs.supersededBy || null,
      emotion: typeof obs.emotion === 'string' ? obs.emotion : null,
      // Phase-1 anchor (content-time coordinates into the archive) — carried
      // so the sovereign search lane can mint mem_ refs; the prompt lane
      // never renders it.
      anchor: obs.anchor || null,
      // Phase-3: a deliberate note's own stable ref (mem_note_…) and the
      // record's provenance — carried so search hits can name themselves
      // (deliberate vs crystallized) and be addressed by ref.
      noteRef: obs.memoryRef || null,
      type: typeof obs.type === 'string' ? obs.type : null,
      source: typeof obs.source === 'string' ? obs.source : null,
      // Layer-1 episodic scope. Untagged (pre-B1) observations read as the
      // general space — the migration default, no file rewrite (CORE-005 §8).
      space: normalizeSpace(obs.space),
    });
  }
  return docs;
};


/**
 * The in-space recent lane (CORE-005 B2): newest-first valid episodes from the
 * ACTIVE project space, excluding memories already surfaced as relevant hits,
 * bounded by R. The general space returns [] — "This space" is a project
 * concept; general chats carry no such lane. Pure.
 * @param {Array} docs - buildDocs output
 * @param {string} activeId - normalized active space id
 * @param {{asOf?:(string|number|Date|null), exclude?:Array<{memory:string}>, limit?:number}} [opts]
 * @returns {Array<{memory:string,timestamp:(string|null),occurredAt:(string|null),emotion:(string|null)}>}
 */
export const recentInSpace = (docs, activeId, { asOf = null, exclude = [], limit = RECALL_BUDGET_R } = {}) => {
  if (!activeId || activeId === 'general') return [];
  const seen = new Set(exclude.map((m) => m.memory));
  const instant = (d) => {
    const t = Date.parse(d.occurredAt || d.timestamp || '');
    return Number.isNaN(t) ? 0 : t;
  };
  return docs
    .filter((d) => d.space.id === activeId && isValidAt(d, asOf) && d.memory && !seen.has(d.memory))
    .sort((a, b) => instant(b) - instant(a))
    .slice(0, limit)
    .map((d) => ({ memory: d.memory, timestamp: d.timestamp, occurredAt: d.occurredAt, emotion: d.emotion }));
};
