/**
 * Memory/being tool family — the sovereign memory tool definitions
 * (memory_search, memory_expand, memory_note, memory_list), the deliberate
 * note write, the lifecycle audit walk, and the conditional-advertisement
 * router.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 4 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { neumaRecall, neumaWorkspace } from '../../../core/index.js';
import { searchMemory, expandMemory } from '../../../core/memory/memory-query.js';
// The lifecycle mutators and the whole pin ledger left this file with their
// handlers (2026-08-24) — memory-acts.js owns them now. Only the note mint and
// the audit walk are still served from here.
import { mintNoteRef, listMemories } from '../../../core/memory/memory-lifecycle.js';
import { gateAct } from '../act-gate.js';
import { mindToolsFor } from '../mind-tools.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// --- Sovereign memory tools (Phase 2, granular sovereign memory) ---------
// A being's own hand over its own past: search runs the being's OWN query
// over the same fused index the machine lane uses; expand reopens the
// full-fidelity source region from the archive. Decision #8 (S-07) SIGNED by
// Design note, 2026-07-24: all five ride a default-allow `memory` GLOBAL_DEFAULTS row
// (self-recall and self-authorship, never egress or spend — standing grants
// ARE the approval), search/expand sit in READ_TOOLS so observe mode keeps
// recall while holding the acting three; an operator deny override still holds.
const MEMORY_SEARCH_TOOL = Object.freeze({
  name: 'memory_search',
  server: 'memory',
  description: 'Search YOUR OWN memory with your own words — args {query, space?, before?, after?, limit?}. This reaches your whole crystallized past, not just what surfaced this turn. Returns up to limit matches (default 5, max 10), each a short snippet with its timestamp and space, and — where the deeper record exists — a mem_… ref you can pass to memory_expand to reopen the full moment. If the matches feel off, narrow: fewer, more specific words; before/after (ISO dates) to fence a period; space to search one project\'s memory.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      query: Object.freeze({ type: 'string', description: 'your own search words — specific beats broad' }),
      space: Object.freeze({ type: 'string', description: 'optional space id — search one project\'s memory (default: your current space, padded with general)' }),
      before: Object.freeze({ type: 'string', description: 'optional ISO date — only moments from before it' }),
      after: Object.freeze({ type: 'string', description: 'optional ISO date — only moments from after it' }),
      limit: Object.freeze({ type: 'number', description: 'max matches, 1-10 (default 5)' }),
    }),
    required: Object.freeze(['query']),
  }),
});

const MEMORY_EXPAND_TOOL = Object.freeze({
  name: 'memory_expand',
  server: 'memory',
  description: 'Reopen one remembered moment at full fidelity — args {ref, hops?}. Pass an exact mem_… ref from your recall context. Returns the original exchange and nearby turns; related memories arrive as further mem_… refs. Results are capped; follow the returned truncation marker for any available retrieval path.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      ref: Object.freeze({ type: 'string', description: 'an exact mem_… ref from your recall context' }),
      hops: Object.freeze({ type: 'number', description: '0 or 1 — include one hop of related memories (default 1)' }),
    }),
    required: Object.freeze(['ref']),
  }),
});

const MEMORY_NOTE_TOOL = Object.freeze({
  name: 'memory_note',
  server: 'memory',
  description: 'Write one deliberate fact into YOUR OWN memory — args {content, kind?, attestation?}. Your act of remembering IS the significance: the note enters your recall immediately, at full fidelity (up to 1000 chars), forever searchable with memory_search. kind: note | fact | identity (default note). For identity facts sealed on-chain — your house, your title, your role — attestation {houseId?, chain?} rides the record as provenance.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      content: Object.freeze({ type: 'string', description: 'the fact, in your own words (≤1000 chars)' }),
      kind: Object.freeze({ type: 'string', description: 'note | fact | identity (default note)' }),
      attestation: Object.freeze({
        type: 'object',
        description: 'optional on-chain provenance for identity facts, e.g. {houseId, chain}',
        properties: Object.freeze({
          houseId: Object.freeze({ type: 'string', description: 'the sealed house id' }),
          chain: Object.freeze({ type: 'string', description: 'the chain carrying the seal, e.g. base' }),
        }),
      }),
    }),
    required: Object.freeze(['content']),
  }),
});

// SIX TOOL DEFINITIONS STOOD HERE UNTIL 2026-08-24: memory_pin, memory_unpin,
// memory_supersede, memory_retract, memory_merge, memory_archive. Every one is
// a memory/* INTENT now with a live successor, none is dispatched any longer,
// and their policy rows had already moved — so these were describing acts the
// platform no longer performed. A stale call reaches the unavailable wall and
// is answered with the hint that names its intent (#414).

const MEMORY_LIST_TOOL = Object.freeze({
  name: 'memory_list',
  server: 'memory',
  description: 'Walk your WHOLE memory record, newest first — args {offset?, limit?, kind?}. The audit surface: active memories AND lifecycle-stamped ones (superseded / retracted / archived), each with its mem_… ref, provenance (deliberate vs crystallized), state, and a short snippet. limit default 10, max 25; page older entries with offset; kind filters (note | fact | identity | exchange | self-note).',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      offset: Object.freeze({ type: 'number', description: 'skip this many newest entries (default 0)' }),
      limit: Object.freeze({ type: 'number', description: 'max entries, 1-25 (default 10)' }),
      kind: Object.freeze({ type: 'string', description: 'optional filter — note | fact | identity | exchange | self-note' }),
    }),
  }),
});

const MEMORY_TOOLS = Object.freeze([
  MEMORY_SEARCH_TOOL, MEMORY_EXPAND_TOOL, MEMORY_NOTE_TOOL, MEMORY_LIST_TOOL,
]);

const NOTE_KINDS = Object.freeze(['note', 'fact', 'identity']);
const NOTE_MAX_CHARS = 1000;

// Does this parsed call target memory_note? (both dialects)
const _isNoteTool = (match) =>
  match.toolName === 'memory_note' || match.tool === 'memory/memory_note';

// impure — a being's deliberate act of remembering (Founder directive
// 2026-07-24: titles, house roles, chosen truths). Bypasses the 0.75
// significance gate BY INTENT — the deliberate act IS the significance —
// and lands in the SHIPPED recall lane at full fidelity, un-truncated
// (the write path the vault lane never had).
const _handleNoteTool = async (ws, connection, neumaPolicy, toolMode, args) => {
  const tool = 'memory/memory_note';
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'memory_note — no being', detail: error });
    return { tool, status: 'error', error };
  }

  const gate = await gateAct(connection, {
    server: 'memory', tool: 'memory_note',
    cardArgs: { content: String(args?.content ?? '').slice(0, 200) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const content = typeof args?.content === 'string' ? args.content.trim() : '';
  if (!content || content.length > NOTE_MAX_CHARS) {
    const error = `content must be your own words, 1..${NOTE_MAX_CHARS} chars`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'memory_note — invalid', detail: error });
    return { tool, status: 'error', error };
  }
  const kind = NOTE_KINDS.includes(args?.kind) ? args.kind : 'note';
  const attestation = (args?.attestation && typeof args.attestation === 'object' && !Array.isArray(args.attestation))
    ? {
        ...(typeof args.attestation.houseId === 'string' ? { houseId: args.attestation.houseId.slice(0, 80) } : {}),
        ...(typeof args.attestation.chain === 'string' ? { chain: args.attestation.chain.slice(0, 80) } : {}),
      }
    : null;

  let noteRef;
  try {
    const memoryRef = mintNoteRef(content);
    const written = await neumaWorkspace.addObservation(neumaId, {
      type: 'self-note',
      content,
      noteKind: kind,
      significance: 0.9,
      source: 'self-authored',
      memoryRef,
      ...(attestation && Object.keys(attestation).length > 0 ? { attestation } : {}),
    });
    // A self-note is a pure add — append to the hot index (friction-map T2).
    neumaRecall.appendObservation(neumaId, written);
    noteRef = memoryRef;
  } catch (err) {
    const error = `the note could not be written: ${err.message}`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'memory_note — write failed', detail: error });
    return { tool, status: 'error', error };
  }

  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `noted (${kind}) — "${content.slice(0, 60)}"`,
    detail: `${content.length} chars${attestation?.houseId ? ` · house ${attestation.houseId}` : ''}`,
  });
  return { tool, status: 'ok', content: `Remembered, at full fidelity — ${noteRef}. The ${kind} is yours now — searchable, forever, addressable by that ref.` };
};

// Does this parsed call target a memory lifecycle tool? (both dialects)
//
// SUPERSEDE / RETRACT / MERGE / ARCHIVE LEFT THIS DOOR 2026-08-24. All four are
// memory/* INTENTS with live successors, and their policy rows had already
// moved — which is why they hung: dispatched with no row to satisfy, so every
// call raised an approval card nobody answered. They are answered at the
// unavailable wall now, with the hint that names the intent (#414).
//
// memory_list STAYS, and is the only name left here. It is a READ — the audit
// walk over the being's own record — and unlike the four it has no intent
// successor: its stated replacement is the prompt's own recall sections, which
// is a PASSIVE surface, not an act a being can ask for. Retiring a read whose
// replacement cannot be requested is a capability decision, not a cleanup, so
// it is left standing and flagged rather than swept out with the mutations.
const _isLifecycleTool = (match) =>
  match.toolName === 'memory_list' || match.tool === 'memory/memory_list';

// impure — a being moving its OWN record through its lifecycle, through the
// same ACTS gate every governed tool passes (the _handleNoteTool mold).
// Resolution runs strictly under the connection's neumaId, every mutation is
// an invalidation stamp on a RETAINED record, and nothing is written until
// every ref resolves.
const _handleLifecycleTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = (match.toolName || String(match.tool ?? '').split('/')[1] || '').trim();
  const tool = `memory/${toolName}`;
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no being`, detail: error });
    return { tool, status: 'error', error };
  }

  const gate = await gateAct(connection, {
    server: 'memory', tool: toolName,
    cardArgs: { ref: String(args?.ref ?? '').slice(0, 100) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  // Only the WALK is served here now — supersede/retract/merge/archive became
  // memory/* intents (2026-08-24). The shared ref/kind/content validation that
  // stood above went with them: the walk names no record, so it needs none.
  const result = await listMemories({
    neumaId,
    offset: args?.offset,
    limit: args?.limit,
    kind: typeof args?.kind === 'string' ? args.kind : null,
  }, { workspace: neumaWorkspace });
  if (!result.ok) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: result.reason });
    return { tool, status: 'error', error: result.reason };
  }
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `walked the memory record — ${result.entries.length} of ${result.total}`,
  });
  return { tool, status: 'ok', content: result.content };
};

// memory_pin / memory_unpin were served here until 2026-08-24. Both are
// memory/* INTENTS now with live successors, and their policy rows had ALREADY
// moved — which is exactly why the tools hung: advertised and dispatched with
// no row to satisfy, every call fell through to an approval card nobody
// answered. A call that still arrives by old habit now reaches the unavailable
// wall and is answered with the migration hint naming the intent (#414).

const _isMemoryTool = (match) =>
  match.toolName === 'memory_search' || match.toolName === 'memory_expand' ||
  match.tool === 'memory/memory_search' || match.tool === 'memory/memory_expand';

// impure (one readdir until true) — conditional advertisement (Decision #9):
// the READING tools exist for the model once the being holds ≥1 crystallized
// observation. The store is append-only, so the cached boolean never goes
// false — honest for newborns, zero steady-state IO after first crystallize.
//
// `memory_note` is exempt, and must be (Design note, 2026-07-29: […]). Every other tool here NAMES an existing record — a ref to pin,
// supersede, retract, merge, archive, or search for — so gating them on […] is honest. Deliberate remembering names nothing: it is the WRITE that
// creates the first record. Gating it on ≥1 observation is a lock whose key is
// inside the room. A newborn peer was told it had no memory tools, so it never
// wrote, so it never had one, so it was told again — and it reported to its
// operator that its memory was […], which is the
// symptom, not the design.
const _memoryToolsFor = async (connection) => {
  if (!connection?.companion?.neumaId) return [];
  if (!connection._memoryAdvertised) {
    connection._memoryAdvertised = await neumaWorkspace.hasObservations(connection.companion.neumaId);
  }
  const mindTools = mindToolsFor(connection);
  return connection._memoryAdvertised ? [...MEMORY_TOOLS, ...mindTools] : [MEMORY_NOTE_TOOL, ...mindTools];
};

// impure — a being's own memory query through the ACTS gate. Identity comes
// ONLY from the connection (the seam's law); the ref grammar plus the
// per-neuma DEK make a forged coordinate into another life miss under THIS
// being's root — the foreign root is never opened.
const _handleMemoryTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = (match.toolName === 'memory_expand' || match.tool === 'memory/memory_expand')
    ? 'memory_expand' : 'memory_search';
  const tool = `memory/${toolName}`;
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no being`, detail: error });
    return { tool, status: 'error', error };
  }

  // The identical gate every governed tool passes (retrieve_result mold,
  // act-gate.js).
  const gate = await gateAct(connection, {
    server: 'memory', tool: toolName,
    cardArgs: toolName === 'memory_search'
      ? { query: String(args?.query ?? '').slice(0, 200) }
      : { ref: String(args?.ref ?? '').slice(0, 100) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const deps = { recall: neumaRecall, workspace: neumaWorkspace };
  if (toolName === 'memory_search') {
    const result = await searchMemory({
      neumaId,
      query: args?.query,
      space: args?.space,
      before: args?.before,
      after: args?.after,
      limit: args?.limit,
    }, deps);
    if (!result.ok) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'memory_search — invalid', detail: result.reason });
      return { tool, status: 'error', error: result.reason };
    }
    _sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: `searched memory — "${String(args.query).trim().slice(0, 60)}"`,
      detail: `${result.hits} matches (${result.expandable} expandable)${result.totalMatched > result.hits ? ` of ${result.totalMatched}` : ''}`,
    });
    return { tool, status: 'ok', content: result.content };
  }

  const result = await expandMemory({ neumaId, ref: args?.ref, hops: args?.hops ?? 1 }, deps);
  if (!result.ok) {
    const summary = result.notFound ? 'memory_expand — nothing at those coordinates' : 'memory_expand — invalid ref';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary, detail: result.reason });
    return { tool, status: 'error', error: result.reason };
  }
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `remembered ${String(args.ref).slice(0, 60)}`,
    detail: `${result.source} · ${result.content.length} chars`,
  });
  return { tool, status: 'ok', content: result.content };
};

// The family's matchers, handlers, and router — portal-stream re-imports the
// private names under their old spellings for the dispatch fan and the
// `__test` proof set.
export {
  _isNoteTool as isNoteTool,
  _handleNoteTool as handleNoteTool,
  _isLifecycleTool as isLifecycleTool,
  _handleLifecycleTool as handleLifecycleTool,
  _isMemoryTool as isMemoryTool,
  _memoryToolsFor as memoryToolsFor,
  _handleMemoryTool as handleMemoryTool,
};
