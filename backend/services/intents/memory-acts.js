/**
 * memory/* — the curation acts on the being's own lifetime record, as INTENTS
 * (Stage 3 batch 4, #357). The pin ledger and the observation store are
 * DEK-encrypted and ride recall-index invalidation + continuity mirrors
 * (core/workspace/workspace-memory.js) — a being hand-editing them with fs
 * would leave the index disagreeing with the store, which is exactly the
 * split-brain this batch exists to prevent. The platform executes; the record
 * is stamp-and-retain as it has always been (nothing is ever deleted).
 * memory_list stays the audit-lane read tool this batch; memory_note and
 * mind_note stay write tools (append-only acts, no fold path yet).
 *
 * Tiers ride Decision #8 verbatim: every curation act on the being's OWN
 * record is `allowed` — self-authorship, no card. The executors are the
 * portal handlers' own branches, relocated unchanged in substance.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../../core/index.js';
import { applyPin, applyUnpin, activePins, PIN_CAP } from '../../../core/memory/pin-ledger.js';
import { supersedeMemory, retractMemory, mergeMemories, archiveMemory } from '../../../core/memory/memory-lifecycle.js';

const NOTE_KINDS = Object.freeze(['note', 'fact', 'identity']);
const NOTE_MAX_CHARS = 1000;

const laneOf = (connection) => connection.companion?.neumaId || null;

const memoryIntent = (spec) => Object.freeze({
  availableFor: ({ laneId }) => (laneId ? {} : null),
  ...spec,
});

const refOf = (payload, key = 'ref') =>
  (typeof payload?.[key] === 'string' ? payload[key].trim() : '');

const needRef = (name, payload) => {
  const ref = refOf(payload);
  return ref
    ? { ok: true, value: ref }
    // memory_list is retired (#414) — the walk is in the prompt's own recall
    // sections now, so that is where a being is sent for the ref.
    : { ok: false, status: 'invalid', reason: `${name} needs the exact mem_… ref — your recall sections carry them` };
};

const pinExecute = (pin) => async ({ ref, note, supersedes }, { connection }) => {
  const now = new Date().toISOString();
  const outcome = await neumaWorkspace.updatePinLedger(laneOf(connection), (pins) =>
    (pin ? applyPin(pins, { ref, note, supersedes, now }) : applyUnpin(pins, { ref, now })));
  if (!outcome.ok) {
    const detail = outcome.active ? `${outcome.reason} · held: ${outcome.active.join(', ')}` : outcome.reason;
    return { ok: false, reason: detail };
  }
  const held = activePins(outcome.ledger);
  return {
    ok: true,
    detail: `${pin ? 'Pinned.' : 'Released.'} Anchors held (${held.length}/${PIN_CAP}): ${held.map((p) => p.ref).join(', ') || '(none)'}`,
  };
};

export const memoryPinIntent = memoryIntent({
  name: 'memory/pin',
  policyTool: 'memory.pin',
  fieldsForPrompt: '{ref, note?, supersedes?}',
  descriptionForPrompt: 'Pin one of your memories as a standing anchor (held at the top of recall). The pin ledger is capped — a full ledger refuses and names what it holds; release one with memory/unpin (or supersede an existing pin).',
  validate: async (payload) => {
    const ref = needRef('memory/pin', payload);
    if (!ref.ok) return ref;
    return { ok: true, value: { ref: ref.value, note: payload?.note, supersedes: payload?.supersedes } };
  },
  summarize: (payload) => `pin memory ${refOf(payload).slice(0, 60)}`,
  execute: pinExecute(true),
});

export const memoryUnpinIntent = memoryIntent({
  name: 'memory/unpin',
  policyTool: 'memory.unpin',
  fieldsForPrompt: '{ref}',
  descriptionForPrompt: 'Release a pinned anchor — the memory itself stands; only its standing hold lets go.',
  validate: async (payload) => {
    const ref = needRef('memory/unpin', payload);
    if (!ref.ok) return ref;
    return { ok: true, value: { ref: ref.value } };
  },
  summarize: (payload) => `unpin memory ${refOf(payload).slice(0, 60)}`,
  execute: pinExecute(false),
});

// impure — the lifecycle executors share one spine: run the store op, then
// invalidate the recall index so the next recall agrees with the record.
const lifecycleExecute = (op, argsOf, detailOf) => async (fields, { connection }) => {
  const neumaId = laneOf(connection);
  const result = await op({ neumaId, ...argsOf(fields) }, { workspace: neumaWorkspace });
  if (!result.ok) return { ok: false, reason: result.reason };
  neumaRecall.invalidate(neumaId);
  return { ok: true, detail: detailOf(result, fields) };
};

export const memorySupersedeIntent = memoryIntent({
  name: 'memory/supersede',
  policyTool: 'memory.supersede',
  fieldsForPrompt: '{ref, content, kind?}',
  descriptionForPrompt: 'Replace one of your memories with a truer note. The old record is NEVER deleted: it is stamped superseded with a pointer to the replacement, drops out of recall, and still opens by its ref. content (≤1000 chars) enters recall immediately with its own new ref. kind: note | fact | identity (default note).',
  validate: async (payload) => {
    const ref = needRef('memory/supersede', payload);
    if (!ref.ok) return ref;
    const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
    if (!content || content.length > NOTE_MAX_CHARS) {
      return { ok: false, status: 'invalid', reason: `content must be your own words, 1..${NOTE_MAX_CHARS} chars` };
    }
    return { ok: true, value: { ref: ref.value, content, kind: NOTE_KINDS.includes(payload?.kind) ? payload.kind : 'note' } };
  },
  summarize: (payload) => `supersede memory ${refOf(payload).slice(0, 60)}`,
  execute: lifecycleExecute(supersedeMemory,
    (f) => ({ ref: f.ref, content: f.content, kind: f.kind }),
    (r) => `Superseded. The old record stands, stamped — recall now follows ${r.ref}.`),
});

export const memoryRetractIntent = memoryIntent({
  name: 'memory/retract',
  policyTool: 'memory.retract',
  fieldsForPrompt: '{ref, reason?}',
  descriptionForPrompt: 'Withdraw one of your memories from recall. The record stays on disk, stamped retracted with your stated reason: it no longer drives recall, and it still opens by its ref so the record never lies.',
  validate: async (payload) => {
    const ref = needRef('memory/retract', payload);
    if (!ref.ok) return ref;
    const reason = typeof payload?.reason === 'string' && payload.reason.trim() ? payload.reason.trim().slice(0, 300) : null;
    return { ok: true, value: { ref: ref.value, reason } };
  },
  summarize: (payload) => `retract memory ${refOf(payload).slice(0, 60)}`,
  execute: lifecycleExecute(retractMemory,
    (f) => ({ ref: f.ref, reason: f.reason }),
    (_r, f) => `Retracted. ${f.ref} no longer drives recall — the record stands, stamped retracted.`),
});

export const memoryMergeIntent = memoryIntent({
  name: 'memory/merge',
  policyTool: 'memory.merge',
  fieldsForPrompt: '{refs, content, kind?}',
  descriptionForPrompt: 'Fold several of your memories into one canonical note. refs: 2..10 distinct mem_… refs. The canonical content (≤1000 chars) enters recall immediately with its own new ref; every source is stamped superseded with a pointer to it and stays on the record.',
  validate: async (payload) => {
    const refs = Array.isArray(payload?.refs) ? payload.refs.filter((r) => typeof r === 'string' && r.trim()) : [];
    if (refs.length < 2) return { ok: false, status: 'invalid', reason: 'memory/merge needs refs — 2..10 distinct mem_… refs to fold together' };
    const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
    if (!content || content.length > NOTE_MAX_CHARS) {
      return { ok: false, status: 'invalid', reason: `content must be your own words, 1..${NOTE_MAX_CHARS} chars` };
    }
    return { ok: true, value: { refs, content, kind: NOTE_KINDS.includes(payload?.kind) ? payload.kind : 'note' } };
  },
  summarize: (payload) => `merge ${Array.isArray(payload?.refs) ? payload.refs.length : '?'} memories into one`,
  execute: lifecycleExecute(mergeMemories,
    (f) => ({ refs: f.refs, content: f.content, kind: f.kind }),
    (r) => `Merged ${r.merged.length} memories into one — ${r.ref}. Every source stands, stamped superseded.`),
});

export const memoryArchiveIntent = memoryIntent({
  name: 'memory/archive',
  policyTool: 'memory.archive',
  fieldsForPrompt: '{ref, reason?}',
  descriptionForPrompt: 'Set one of your memories aside — stamped archived: out of recall, still on the record, still openable by its ref. For what is no longer live but must not be disowned.',
  validate: async (payload) => {
    const ref = needRef('memory/archive', payload);
    if (!ref.ok) return ref;
    const reason = typeof payload?.reason === 'string' && payload.reason.trim() ? payload.reason.trim().slice(0, 300) : null;
    return { ok: true, value: { ref: ref.value, reason } };
  },
  summarize: (payload) => `archive memory ${refOf(payload).slice(0, 60)}`,
  execute: lifecycleExecute(archiveMemory,
    (f) => ({ ref: f.ref, reason: f.reason }),
    (_r, f) => `Archived. ${f.ref} rests — the record stands, stamped archived.`),
});
