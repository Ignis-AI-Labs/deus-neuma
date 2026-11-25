/**
 * memory_map — a being's own map of its memory.
 *
 * memory_search answers […]; memory_list walks the record in order.
 * Neither says what the memory is MADE of. This does: the topics a life has
 * gathered into, who it speaks of, when — and from any of those, a page of
 * memories, and from any memory, the ones nearest to it. It is the same atlas
 * the operator's CONTEXT MAP · MEMORY view draws (backend/services/memory-atlas.js),
 * so the being and its operator are looking at one map.
 *
 * A read of the being's own record: the lane comes from the connection, never
 * from an argument.
 */
import { readMemoryAtlas } from '../memory-atlas.js';
import {
  WALK_LIMIT_DEFAULT, WALK_LIMIT_MAX, readWalkFilters, shapeOverview, shapeWalkMemory, shapeWalkPage,
} from '../../../core/memory/atlas-walk.js';

export const MEMORY_MAP_TOOL = Object.freeze({
  name: 'memory_map',
  server: 'memory',
  description: `See what YOUR OWN memory is made of, and walk it — args {topic?, person?, period?, kind?, space?, state?, sort?, offset?, limit?, memory?}. With no args: the overview — every topic your memories gather into (named by the words that set it apart, with its size, dates and an example), the people they speak of, the months they fall in, and their kinds. Then open any of those: {topic: N} (the number from the overview; 0 = memories in no topic), {person: "name"}, {period: "YYYY-MM"}, {kind: "…"} — filters combine, and each page lists memories with a mem_… ref (or an id) you can pass on. {memory: "<ref or id>"} shows one memory and the memories nearest to it, so you can follow a thread from one to the next. sort: newest (default) | linked (most connected first — the memories a topic turns on). limit default ${WALK_LIMIT_DEFAULT}, max ${WALK_LIMIT_MAX}. Use this when you need the lay of your memory rather than one fact: before answering "what do we know about X", when a search came back thin, or to find what you have never thought to search for. memory_expand reopens any ref in full.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      topic: Object.freeze({ type: 'number', description: 'a topic number from the overview (0 = memories in no topic)' }),
      person: Object.freeze({ type: 'string', description: 'a name from the overview — memories that speak of them' }),
      period: Object.freeze({ type: 'string', description: 'a month, YYYY-MM, from the overview' }),
      kind: Object.freeze({ type: 'string', description: 'a kind from the overview, e.g. conversation | note | fact | identity' }),
      space: Object.freeze({ type: 'string', description: 'a project space id from the overview' }),
      state: Object.freeze({ type: 'string', description: 'active | set-aside (superseded, retracted or archived) — default both' }),
      sort: Object.freeze({ type: 'string', description: 'newest (default) | linked' }),
      offset: Object.freeze({ type: 'number', description: 'skip this many (default 0)' }),
      limit: Object.freeze({ type: 'number', description: `max memories on the page, 1-${WALK_LIMIT_MAX} (default ${WALK_LIMIT_DEFAULT})` }),
      memory: Object.freeze({ type: 'string', description: 'a mem_… ref or an id from a page — show that memory and its nearest memories' }),
    }),
  }),
});

/**
 * One step of the walk. impure — reads the lane's atlas.
 * @param {string} laneId - the being bound to the connection
 * @param {Object} [args] - the tool call's arguments
 * @returns {Promise<{ok:true, content:string, summary:string}|{ok:false, reason:string}>}
 */
export const walkMemoryMap = async (laneId, args = {}) => {
  const atlas = await readMemoryAtlas(laneId);
  if (typeof args?.memory === 'string' && args.memory.trim()) {
    const one = shapeWalkMemory(atlas, args.memory);
    return one.ok ? { ok: true, content: one.content, summary: 'read one memory and its nearest' } : one;
  }
  const filters = readWalkFilters(atlas, args || {});
  if (!filters.ok) return filters;
  if (filters.said.length === 0 && args?.offset === undefined && args?.sort === undefined) {
    return { ok: true, content: shapeOverview(atlas), summary: `read the memory map — ${atlas.totals.topics} topics, ${atlas.totals.memories} memories` };
  }
  if (args?.sort !== undefined && args.sort !== 'newest' && args.sort !== 'linked') {
    return { ok: false, reason: 'sort must be newest or linked' };
  }
  const page = shapeWalkPage(atlas, {
    by: filters.by, said: filters.said, offset: args?.offset, limit: args?.limit, sort: args?.sort || 'newest',
  });
  return { ok: true, content: page.content, summary: `walked the memory map — ${page.shown} of ${page.total}${filters.said.length ? ` (${filters.said.join(' · ')})` : ''}` };
};
