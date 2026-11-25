// atlas-view.js — the arithmetic behind the MEMORY view: which memories the
// chosen ways-in leave on the list, what the chosen filters are called, and
// the small figures the rail draws. Pure — no React, no DOM.

import { filterMemories, monthOf } from '../../../../core/memory/atlas-filter.js';

/** No way in chosen: everything shows. */
export const NO_FILTERS = Object.freeze({ topic: null, person: null, period: null, kind: null, state: null });

const KIND_WORDS = Object.freeze({
  conversation: 'CONVERSATION', housemate: 'FROM A HOUSEMATE', platform: 'FROM THE PLATFORM',
  note: 'OWN NOTE', fact: 'OWN FACT', identity: 'OWN IDENTITY',
});
/** A memory kind in the words the view shows. */
export const kindWords = (kind) => KIND_WORDS[kind] || String(kind || 'other').toUpperCase();

const STATE_WORDS = Object.freeze({ active: 'ACTIVE', superseded: 'REPLACED', retracted: 'TAKEN BACK', archived: 'PUT AWAY' });
/** A memory's standing in the words the view shows. */
export const stateWords = (state) => STATE_WORDS[state] || String(state || '').toUpperCase();

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** "2026-11" → "NOV 2026"; anything else is shown as it is. */
export const monthWords = (key) => {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  return m && MONTHS[Number(m[2]) - 1] ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(key || '').toUpperCase();
};
/** An ISO stamp as "NOV 20, 2026" (UTC, so a row never moves a day with the viewer's clock), "UNDATED" when it is none. */
export const dayWords = (iso) => {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return 'UNDATED';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

/** A topic's name, or the words for the memories in none. */
export const topicWords = (atlas, topic) =>
  (topic >= 0 ? atlas?.topics?.[topic]?.name ?? `Topic ${topic + 1}` : 'No topic');

/**
 * The memories the chosen ways-in and the search leave, in the atlas's own
 * order (newest first). `found` is a search's answer (ids) or null. Pure.
 * @param {Object} atlas
 * @param {typeof NO_FILTERS} filters
 * @param {string[]|null} found
 * @returns {Array}
 */
export const shownMemories = (atlas, filters, found) => filterMemories(atlas?.memories, {
  ...(Number.isInteger(filters?.topic) ? { topic: filters.topic } : {}),
  person: filters?.person, period: filters?.period, kind: filters?.kind, state: filters?.state,
  ids: Array.isArray(found) ? new Set(found) : null,
});

/**
 * Each chosen way-in as a chip the operator can lift: what it is and its
 * words. Pure.
 * @returns {Array<{key:string, label:string, words:string}>}
 */
export const filterChips = (atlas, filters, query) => [
  ...(query ? [{ key: 'query', label: 'WORDS', words: query }] : []),
  ...(Number.isInteger(filters?.topic) ? [{ key: 'topic', label: 'TOPIC', words: topicWords(atlas, filters.topic) }] : []),
  ...(filters?.person ? [{ key: 'person', label: 'SPEAKS OF', words: filters.person }] : []),
  ...(filters?.period ? [{ key: 'period', label: 'MONTH', words: monthWords(filters.period) }] : []),
  ...(filters?.kind ? [{ key: 'kind', label: 'KIND', words: kindWords(filters.kind) }] : []),
  ...(filters?.state ? [{ key: 'state', label: 'STANDING', words: filters.state === 'active' ? 'ACTIVE ONLY' : 'SET ASIDE ONLY' }] : []),
];

/** Press a way-in: the same one again lifts it, another replaces it. Pure. */
export const toggleFilter = (filters, key, value) => ({ ...filters, [key]: filters[key] === value ? null : value });

/**
 * How many of each way-in the CURRENT list holds — so the rail's counts answer
 * […], not "how many exist". The way-in being counted is
 * left out of its own count (choosing a topic must not zero the other topics).
 * Pure.
 * @returns {{topic:Map<number,number>, person:Map<string,number>, period:Map<string,number>, kind:Map<string,number>}}
 */
export const facetCounts = (atlas, filters, found) => {
  const count = (key, of) => {
    const tally = new Map();
    for (const m of shownMemories(atlas, { ...filters, [key]: null }, found)) {
      for (const v of of(m)) tally.set(v, (tally.get(v) || 0) + 1);
    }
    return tally;
  };
  return {
    topic: count('topic', (m) => [m.topic]),
    person: count('person', (m) => m.people || []),
    period: count('period', (m) => [monthOf(m.at)]),
    kind: count('kind', (m) => [m.kind]),
  };
};

/** The trail of opened memories: open one (a repeat of the last is no step), or step back. Pure. */
export const openOnTrail = (trail, id) => (trail[trail.length - 1] === id ? trail : [...trail, id].slice(-50));
export const backOnTrail = (trail) => trail.slice(0, -1);

const TURN = /^(>>| {2}) \[([^\]]*)\] (user|assistant|system|tool): ?(.*)$/;

/**
 * A reopened conversation as turns. The platform hands the source back as the
 * text a being reads ("   [when] role: words", the remembered pair marked
 * ">>"); the operator's reader shows who spoke instead. Lines that follow a
 * turn belong to it. Returns null when the text is not that shape, so the
 * reader falls back to showing it as it is. Pure.
 * @param {string} content
 * @returns {Array<{who:'said'|'answered'|'other', at:string, words:string, focus:boolean}>|null}
 */
export const sourceTurns = (content) => {
  const turns = [];
  for (const line of String(content || '').split('\n').slice(1)) {
    if (line === 'Related memories:') break;
    const m = TURN.exec(line);
    if (m) {
      turns.push({ who: m[3] === 'user' ? 'said' : m[3] === 'assistant' ? 'answered' : 'other', at: m[2], words: m[4], focus: m[1] === '>>' });
    } else if (turns.length) {
      turns[turns.length - 1].words += `\n${line}`;
    } else {
      return null;
    }
  }
  return turns.length ? turns : null;
};
