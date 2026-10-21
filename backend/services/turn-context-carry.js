/**
 * SAY IT ONCE — the local wire's per-turn context, carried instead of resent
 * (Design note, 2026-10-05: […]).
 *
 * llama-server reuses a slot's cache only up to the first token that differs.
 * The per-turn block (clock, memory, working lists — the volatile tail,
 * llm-request-builders.js localPrefixStableMessages) rode the current turn
 * and was STRIPPED from that turn once it became history, so every turn
 * re-read from the last ask onward and re-sent the whole block: ~990 tokens
 * a turn on a live Keir sitting, ~20 s on a CPU machine.
 *
 * Now each turn's block stays in history exactly as it was sent (held here,
 * per chat, in memory — never written to the being's record), and the next
 * turn's block carries only the clock and the sections that CHANGED. A
 * section whose last copy left the wire (shed, compacted, a backend restart)
 * is sent whole again; a section that emptied says so, so a stale copy never
 * reads as current. Blocks the window cannot hold are dropped oldest-half
 * first — one re-read, then stable again for many turns.
 *
 * impure — holds per-connection state; never throws into a turn (a carry
 * that cannot apply returns null and the wire keeps the plain law).
 */
import { createHash, randomUUID } from 'node:crypto';
import { CHARS_PER_TOKEN, SAFETY_RESERVE_TOKENS, MIN_COMPLETION_TOKENS } from './context-budget.js';

const CHATS_MAX = 8;
/** An unknown window carries at most this many characters of earlier blocks. */
export const CARRY_UNKNOWN_CHARS = 16000;

export const CARRY_NOTE = 'The harness\'s standing context for this turn — the clock, your memory, your working lists. '
  + 'These are not the operator\'s words; the operator\'s message follows this block. '
  + 'Earlier turns keep their blocks as they were sent; a section repeats only when it changed, '
  + 'so the newest block naming a section is the one that stands.';

/** The note on a later block — the full one already stands earlier in the chat. */
export const CARRY_NOTE_SHORT = 'Harness context for this turn — not the operator\'s words. Unchanged sections and lines stand from earlier blocks.';

const fingerprint = (text) => createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
const wrap = (body, note = CARRY_NOTE) => `<harness-context>\n${note}\n\n${body}\n</harness-context>`;

// The clock section's fixed guidance lines stand from the block that last
// carried them: a later block sends its heading and the lines that changed
// (the time always; the date lines when the day turns).
const changedLines = (text, priorText) => {
  const prior = new Set(String(priorText || '').split('\n'));
  const lines = String(text).split('\n');
  return [lines[0], ...lines.slice(1).filter((line) => !prior.has(line))].join('\n');
};
const charsOf = (content) => (typeof content === 'string'
  ? content.length
  : Array.isArray(content) ? content.reduce((n, part) => n + String(part?.text ?? '').length, 0) : 0);

/**
 * impure — this chat's carry on this connection (created on first use; the
 * connection holds a few chats, least recently used dropped).
 * @param {Object} connection
 * @param {string} chatId
 * @returns {{byTurn: Map<string, {turnKey: string, block: string}>, shown: Map<string, {fp: string, turnId: string, label: string}>}|null}
 */
const contextCarryFor = (connection, chatId) => {
  if (!connection || typeof chatId !== 'string' || !chatId) return null;
  const all = connection._contextCarry instanceof Map ? connection._contextCarry : (connection._contextCarry = new Map());
  const state = all.get(chatId) || { byTurn: new Map(), shown: new Map() };
  all.delete(chatId);
  all.set(chatId, state);
  if (all.size > CHATS_MAX) all.delete(all.keys().next().value);
  return state;
};

/**
 * The anchor's carry descriptor for one turn — a fresh key per turn, so the
 * rounds of one turn send the same bytes and a retry composes anew.
 * @param {{connection: Object, chatId: string, turnId: string, window?: number|null}} args
 * @returns {{state: Object, turnId: string, turnKey: string, window: number|null}|null}
 */
export const carryForTurn = ({ connection, chatId, turnId, window = null } = {}) => {
  const state = contextCarryFor(connection, chatId);
  if (!state || typeof turnId !== 'string' || !turnId) return null;
  return { state, turnId, turnKey: randomUUID(), window: Number.isFinite(window) && window > 0 ? window : null };
};

/**
 * impure (records the block) — this turn's block body: the clock always, a
 * section only when it changed or its last copy is not on this wire, and a
 * one-line notice for a section that emptied. A later round of the same turn
 * returns the bytes already sent. What each section put in the block is held
 * beside it (bySection), for the gauge.
 * @param {Object} state contextCarryFor's state
 * @param {{turnId: string, turnKey: string, sections: ReadonlyArray<{id: string, label?: string, text: string}>, carried: Set<string>}} args
 * @returns {string} the wrapped block
 */
const blockForTurn = (state, { turnId, turnKey, sections, carried }) => {
  const held = state.byTurn.get(turnId);
  if (held?.turnKey === turnKey) return held.block;
  const parts = [];
  const standing = [];
  const bySection = new Map();
  const shown = new Map(state.shown);
  for (const section of sections) {
    const fp = fingerprint(section.text);
    const prior = state.shown.get(section.id);
    const priorStands = Boolean(prior) && carried.has(prior.turnId);
    if (section.id !== 'present' && priorStands && prior.fp === fp) {
      standing.push(section.label || section.id);
      continue;
    }
    if (section.id === 'present' && priorStands) {
      // Its fixed lines still stand where they were last sent: the carrier keeps them.
      const moved = changedLines(section.text, prior.text);
      parts.push(moved);
      bySection.set(section.id, moved);
      continue;
    }
    parts.push(section.text);
    bySection.set(section.id, section.text);
    shown.set(section.id, { fp, turnId, label: section.label || section.id, ...(section.id === 'present' ? { text: section.text } : {}) });
  }
  const now = new Set(sections.map((section) => section.id));
  for (const [id, prior] of state.shown) {
    if (now.has(id)) continue;
    if (carried.has(prior.turnId)) parts.push(`${prior.label}: none now — the earlier one no longer stands.`);
    shown.delete(id);
  }
  if (standing.length) parts.unshift(`Still standing from earlier in this chat (unchanged): ${standing.join(', ')}.`);
  const block = wrap(parts.join('\n\n'), carried.size ? CARRY_NOTE_SHORT : CARRY_NOTE);
  state.shown = shown;
  state.byTurn.delete(turnId);
  state.byTurn.set(turnId, { turnKey, block, bySection });
  return block;
};

/**
 * Pure — a carried ask as it goes back on the wire. Byte-identical to what was
 * sent whenever the history row still says exactly that ask (its render only
 * adds the clock stamp the block's own PRESENT MOMENT already carries): this
 * model family rewinds its cache only to saved checkpoints, so one changed
 * character inside the last ask cost a ~520-token rewind where 43 were new
 * (synthetic probe on the live serving, 2026-10-05). A row that says
 * something else — documents, a revised ask, a sanitized or capped render —
 * keeps its history render behind the block.
 * @param {{block: string, sent?: string|null}} held
 * @param {string} rendered the history row's content
 * @returns {string}
 */
const restoredAsk = (held, rendered) => (typeof held.sent === 'string' && held.sent && rendered.endsWith(held.sent)
  ? `${held.block}\n\n${held.sent}`
  : `${held.block}\n\n${rendered}`);

/**
 * impure — the local wire under the carry: earlier blocks back in front of
 * their own asks, the current ask led by this turn's block; what it put there
 * is recorded on the descriptor (carry.wire). Null when the carry cannot
 * apply (no per-section tail) — the caller keeps the plain law.
 * @param {Array<Object>} messages system + transcript + current turn (+ rounds)
 * @param {{stable: string, volatileSections?: Array}} split the system message's cache split
 * @param {number} at the current turn's index
 * @param {{state: Object, turnId: string, turnKey: string, window: number|null}} carry
 * @returns {Array<Object>|null}
 */
export const carriedMessages = (messages, split, at, carry) => {
  const sections = split?.volatileSections;
  if (!Array.isArray(sections) || !sections.length || !carry?.state) return null;
  const { state } = carry;
  // A RETRY answers a point this chat already carried: the same turnId under
  // a fresh turnKey. Its old block and the sections it last carried no longer
  // stand on this wire (the take they rode is being replaced), so the point's
  // row is not counted as carried and those sections go out whole.
  const prior = state.byTurn.get(carry.turnId);
  if (prior && prior.turnKey !== carry.turnKey) {
    state.byTurn.delete(carry.turnId);
    for (const [id, shown] of state.shown) if (shown.turnId === carry.turnId) state.shown.delete(id);
  }
  let rows = [];
  for (let i = 1; i < at; i += 1) {
    const m = messages[i];
    if (m?.role === 'user' && typeof m.content === 'string' && typeof m.turnId === 'string' && state.byTurn.has(m.turnId)) rows.push(i);
  }
  // Fit: what the wire already carries plus the restored blocks must stay
  // inside the window; past it, the oldest half of the blocks goes at once.
  const limit = carry.window
    ? (carry.window - SAFETY_RESERVE_TOKENS - MIN_COMPLETION_TOKENS) * CHARS_PER_TOKEN
    : Infinity;
  const base = messages.reduce((n, m) => n + charsOf(m?.content), 0);
  const blockOf = (i) => restoredAsk(state.byTurn.get(messages[i].turnId), messages[i].content).length - messages[i].content.length;
  let extra = rows.reduce((n, i) => n + blockOf(i), 0);
  const cap = carry.window ? limit : CARRY_UNKNOWN_CHARS;
  while (rows.length && (base + extra > limit || extra > cap)) {
    for (const i of rows.slice(0, Math.ceil(rows.length / 2))) {
      extra -= blockOf(i);
      state.byTurn.delete(messages[i].turnId);
    }
    rows = rows.filter((i) => state.byTurn.has(messages[i].turnId));
  }
  const restored = new Set(rows);
  const carried = new Set(rows.map((i) => messages[i].turnId));
  const block = blockForTurn(state, { turnId: carry.turnId, turnKey: carry.turnKey, sections, carried });
  const turn = messages[at];
  const content = Array.isArray(turn.content)
    ? [{ type: 'text', text: block }, ...turn.content]
    : `${block}\n\n${turn.content ?? ''}`;
  state.byTurn.get(carry.turnId).sent = typeof turn.content === 'string' ? turn.content : null;
  // What the carry put on this wire, for the gauge (wireContextSections): the
  // earlier blocks restored in front of their asks, and this turn's block.
  carry.wire = Object.freeze({
    carried: rows.map((i) => `${state.byTurn.get(messages[i].turnId).block}\n\n`).join(''),
    block: Array.isArray(turn.content) ? block : `${block}\n\n`,
    bySection: state.byTurn.get(carry.turnId).bySection,
  });
  return messages.map((message, i) => {
    if (i === 0) return { role: 'system', content: split.stable };
    if (i === at) return { ...turn, content };
    if (restored.has(i)) return { ...message, content: restoredAsk(state.byTurn.get(message.turnId), message.content) };
    return message;
  });
};

/**
 * Pure — the gauge's sections as the carried wire holds them. A volatile
 * section counts only what this turn's block carried of it (an unchanged one
 * stands in an earlier block and drops out); the block's own frame — its
 * wrapper, note, standing line and joins — and the earlier turns' blocks
 * restored in front of their asks are sections of their own, where the
 * volatile ones begin. Without a recorded carry (any other dialect, the plain
 * law, the wire not built yet) the sections return untouched.
 * @param {ReadonlyArray<{id: string, label: string, text: string}>} sections the turn's composition sections
 * @param {Object} system the turn's system message (messages[0])
 * @returns {ReadonlyArray<{id: string, label: string, text?: string, chars?: number}>}
 */
export const wireContextSections = (sections, system) => {
  const wire = system?.contextCarry?.wire;
  const volatile = system?.cacheSplit?.volatileSections;
  if (!wire || !Array.isArray(volatile)) return sections;
  const ids = new Set(volatile.map((section) => section.id));
  const at = sections.findIndex((section) => ids.has(section.id));
  if (at < 0) return sections;
  const out = [];
  let rode = 0;
  for (const section of sections) {
    if (!ids.has(section.id)) { out.push(section); continue; }
    const text = wire.bySection.get(section.id);
    if (text === undefined) continue;
    rode += text.length;
    out.push(text === section.text ? section : Object.freeze({ ...section, text }));
  }
  return Object.freeze([
    ...out.slice(0, at),
    ...(wire.carried ? [Object.freeze({ id: 'harnessCarry', label: 'HARNESS CONTEXT, EARLIER TURNS', text: wire.carried })] : []),
    Object.freeze({ id: 'harnessFrame', label: 'HARNESS CONTEXT FRAME', chars: wire.block.length - rode }),
    ...out.slice(at),
  ]);
};
