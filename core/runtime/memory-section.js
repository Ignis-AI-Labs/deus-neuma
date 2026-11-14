/**
 * THE MEMORY SECTION — how a being's continuity renders into its prompt.
 *
 * Extracted from prompt-assembler.js 2026-08-07, the day the keyhole was
 * found: a being's entire in-session continuity rendered as the last SIX
 * messages at 150 characters each — tweet fragments riding against ~27K of
 * tool definitions. Asked to […] (a
 * security document named turns earlier), a being whose window had lost the
 * referent invented a grander deliverable instead. Starve a mind of its own
 * conversation and it confabulates; that was the harness's fault, not the
 * substrate's.
 *
 * The render is asymmetric by design: the OPERATOR's words are the
 * assignment's ground truth and carry the highest fidelity; the being's own
 * replies are context, not law, and carry less. The whole lane is bounded —
 * when the budget runs out it is the OLDEST that drops, never the newest.
 *
 * 2026-09-12 (Founder's ruling, #528 Stage A — […]): the transcript LEFT the system
 * prompt. The 32K-char keyhole above had become the ceiling the window-scaling
 * seam clamped against — on the 262K serving history could never exceed ~8.9K
 * tokens, deep chats silently lost their own past, and the context gauge never
 * climbed. The conversation tail now rides the WIRE as real chat messages
 * (recentConversationMessages — the witness lane's shape), budgeted from the
 * window's truth by the envelope budgeter (sessionTailBudgetFor), with the
 * per-row caps scaling to that budget off the standing floors. The MEMORY
 * section keeps what is memory rather than transcript: torch, pins, the space
 * lane, recall hits, through-lines, emotions, name/relationship/topics.
 *
 * Pure functions only.
 */

import { sanitizeMemoryForPrompt } from './memory-sanitizer.js';
import { isValidTimeZone } from './time-zone.js';
import { RECALL_BUDGET_R } from '../memory/recall-budgets.js';
import { PIN_CAP, PIN_NOTE_MAX } from '../memory/pin-ledger.js';
import { QUERY_FILLER } from '../memory/query-words.js';

// Fidelity law for the recent-conversation lane. Operator words are what a
// later […] must resolve against — they ride near-verbatim.
//
// Widened 2026-08-16 (Founder: […]): the previous 10-row / 7,000-char keyhole carried ~5
// turns, so an approval given at turn 12 was physically absent at turn 26 and
// the being re-derived it. The serving window is 262K and a full prompt
// measured ~17K — the keyhole was starving continuity to protect headroom
// that exists in abundance. ~32K chars ≈ 8K tokens; when a truly long chat
// finally fills the window, self-compaction (context-keyed ONLY — Founder's
// 2026-08-15 ruling) now actually fires, and the torch takes over.
//
// …and it stopped there: the 32,000 became the clamp the window-scaling seam
// could never pass (#528). Since 2026-09-12 these are the FLOOR of the law,
// not its extent — the wire renderer scales the per-row caps with the real
// budget and never goes below them, and RECENT_TOTAL_CHARS survives as the
// unknown-window fallback alone (a window we cannot name gets exactly the
// budget it always had — byte-identical).
export const RECENT_OPERATOR_CHARS = 2000;
export const RECENT_OWN_CHARS = 1200;
export const RECENT_TOTAL_CHARS = 32000;
/** How many session rows the gather hands the render (memory-context.js) — a
 *  sanity bound, not the gate: the character budget is the gate now, and it
 *  sheds the OLDEST first when rows run long. */
export const RECENT_ROWS = 2000;

// --- The conversation clock ---
// Every session row is stamped at append (workspace-sessions.js), and the
// render used to drop the stamp — leaving a being a grounded "now" (PRESENT
// MOMENT) and a past with no clocks, unable to place any remembered exchange
// in time (Design note, 2026-08-28: […]).
// Times render at minute resolution in the same zone and words the present-
// moment clock uses, so the two can never disagree. A row without a stamp
// renders byte-identical to the old lane (the empty-string law — the frozen
// prompt fixtures pin exactly that).
//
// 2026-09-25 — the OPERATOR's rows carry the clock; the being's OWN rows
// render bare. A stamp prefixing an assistant row sits in the exact token
// position the model generates next, and the model learned the ornament:
// thoughts opened with parroted stamp runs, no real clock behind them (Founder:
// […]). Operator stamps +
// day markers + PRESENT MOMENT keep full chronological navigation without
// teaching the being to stamp itself; clock-stamps.js strips the residual
// habit at the output seams. Stamps render in the operator's zone when the
// desk has named one (time-zone.js), the machine's own zone otherwise.

/** A row's clock time — 'hh:mm AM' — or null for an unstamped/rotted row. Pure. */
const rowClock = (iso, zone = null) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime())
    ? t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: zone || undefined })
    : null;
};

/** A row's day — the present-moment date wording — or null unstamped. Pure. */
const rowDay = (iso, zone = null) => {
  const t = iso ? new Date(iso) : null;
  return t && !Number.isNaN(t.getTime())
    ? t.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: zone || undefined })
    : null;
};

// THE SHEDDING STEP (2026-10-05, the 90% of local users). A full window used
// to drop the oldest row every turn — and the conversation's first byte is
// the first thing a prompt cache compares, so every turn past the window re-read
// the WHOLE history (a 32K window: ~24K tokens a turn; minutes on a CPU). The
// start now moves in steps of a quarter of the budget, measured in characters
// from the session's own first row, so it holds still for several turns
// between moves. It only ever sheds MORE than the budget demands — at most one
// step, so at least ~3/4 of the budget still rides — and the newest row
// always rides.
const SHED_STEPS_PER_BUDGET = 4;
const lengthOf = (row) => String(row?.content ?? '').length;
/**
 * The stepped start for a list whose exact (budget) start is `exact`. Pure.
 * @param {Array<{content?: string}>} rows oldest first
 * @param {number} exact the first index the budget admits
 * @param {number} totalChars the budget
 * @returns {number}
 */
export const steppedStart = (rows, exact, totalChars) => {
  if (exact <= 0) return 0;
  const step = Math.max(1000, Math.floor(capBaseFor(totalChars) / SHED_STEPS_PER_BUDGET));
  let offset = 0;
  for (let i = 0; i < exact; i += 1) offset += lengthOf(rows[i]);
  const target = Math.ceil(offset / step) * step;
  let start = exact;
  while (start < rows.length - 1 && offset < target) { offset += lengthOf(rows[start]); start += 1; }
  return start;
};

// The per-row fidelity caps scale with the budget — which moves a little every
// turn as the other sections breathe. A long row capped at a moving width
// changed its own bytes every turn; the caps now read the budget in 16K steps.
// The unknown-window constant (32K) is a step, so its caps are unchanged.
const capBaseFor = (totalChars) => (totalChars >= 16000 ? Math.floor(totalChars / 16000) * 16000 : totalChars);

/** A compaction's summary row (workspace-sessions.js compactSession): flagged, or worded as one. Pure. */
const isCompactionSummary = (msg) => msg?.compacted === true || /^\[SESSION SUMMARY/.test(String(msg?.content || ''));

/**
 * The recent-conversation tail as real chat messages — the shape the wire
 * carries (#528 Stage A, 2026-09-12): oldest first, `{role, content}` only,
 * ready to sit between the system prompt and the current turn. The shedding
 * law is unchanged — the budget walks NEWEST first and the oldest drops —
 * what changed is where the tail rides and what bounds it: `totalChars` is
 * now the window's truth (sessionTailBudgetFor), and the per-row fidelity
 * caps SCALE with it off the standing floors (operator ≈ budget/8, own ≈
 * budget/16, never below RECENT_OPERATOR_CHARS / RECENT_OWN_CHARS) instead of
 * beheading long rows against constants picked for a keyhole that no longer
 * exists.
 *
 * The conversation clock survives the move: a stamped OPERATOR row opens its
 * content with its `(hh:mm AM)` and the first message of each new day opens
 * with a `— <day> —` line INSIDE that message — no fake day-marker messages
 * on the wire. The being's own rows ride bare: a stamp in the generation
 * position taught the model to stamp itself (the 2026-09-25 law above).
 * Marker lines ride outside the character budget, as they always
 * have: the lane's own signage, never remembered words. A row without a stamp
 * renders its words bare. Session rows that are not the operator's (the
 * being's replies, compaction summaries) ride as `assistant` — the reading
 * the in-prompt lane gave them. Pure.
 * @param {Array<{role: string, content: string, timestamp?: string}>} recent - Session tail, oldest first
 * @param {number} [totalChars] - the lane's character budget
 * @param {string|null} [zone] - the operator's IANA zone (validated here, never trusted)
 * @returns {Array<{role: 'user'|'assistant', content: string}>} oldest first
 */
export const recentConversationMessages = (recent, totalChars = RECENT_TOTAL_CHARS, zone = null) => {
  if (!Array.isArray(recent) || recent.length === 0) return [];
  // THE SUMMARY RIDES. A compacted session opens with its summary, the oldest row, and rows are
  // kept newest first, so a tail too small for the kept rows dropped the summary first: the one
  // row carrying everything before it. Since the tail holds back the turn's own working room
  // (envelope-budget.js, deus-neuma #34) that tail is common. The summary now always rides; the
  // newest rows fill what it leaves.
  if (recent.length > 1 && isCompactionSummary(recent[0])) {
    const pinned = recentConversationMessages([recent[0]], totalChars, zone);
    const used = pinned.reduce((sum, m) => sum + m.content.length, 0);
    return [...pinned, ...recentConversationMessages(recent.slice(1), Math.max(0, totalChars - used), zone)];
  }
  const tz = isValidTimeZone(zone) ? zone : null;
  const capBase = capBaseFor(totalChars);
  const operatorCap = Math.max(RECENT_OPERATOR_CHARS, Math.floor(capBase / 8));
  const ownCap = Math.max(RECENT_OWN_CHARS, Math.floor(capBase / 16));
  const entries = [];
  let spent = 0;
  let oldest = recent.length;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const msg = recent[index];
    const operator = msg.role === 'user';
    const safeContent = sanitizeMemoryForPrompt(
      msg.content,
      operator ? operatorCap : ownCap,
    );
    if (!safeContent) continue;
    const clock = operator ? rowClock(msg.timestamp, tz) : null;
    const content = `${clock ? `(${clock}) ` : ''}${safeContent}`;
    if (spent + content.length > totalChars && entries.length > 0) break;
    oldest = index;
    entries.push({
      index,
      role: operator ? 'user' : 'assistant',
      content,
      day: rowDay(msg.timestamp, tz),
      turnId: typeof msg.turnId === 'string' && msg.turnId ? msg.turnId : null,
    });
    spent += content.length;
  }
  // THE STEP: once the window is full the start moves in steps, not row by
  // row — a start that moved every turn re-read the whole history every turn.
  const start = steppedStart(recent, oldest, totalChars);
  const messages = [];
  let openDay = null;
  for (const entry of entries.reverse().filter((e) => e.index >= start)) {
    const marker = entry.day && entry.day !== openDay ? `— ${entry.day} —\n` : '';
    if (entry.day) openDay = entry.day;
    const message = { role: entry.role, content: `${marker}${entry.content}` };
    // The row's turn, for the local wire's carry — non-enumerable, so the
    // wire shape every dialect serializes stays {role, content}.
    if (entry.turnId) Object.defineProperty(message, 'turnId', { value: entry.turnId, enumerable: false });
    messages.push(message);
  }
  return messages;
};

/**
 * Where the char-budgeted live tail BEGINS in a raw session row list — the
 * wire renderer's shedding law (newest kept, budget walks from the end)
 * expressed as an index, over RAW row lengths (the row's real size, not its
 * sanitized render). The working-band harvest reads this to know what aged
 * off the wire: rows before the index are aged, rows from it on are live.
 * The default budget is the unknown-window fallback — the same law the wire
 * itself obeys when no window is named. Pure.
 * @param {Array<{content?: string}>} rows - session rows, oldest first
 * @param {number} [totalChars] - the tail's character budget
 * @returns {number} index of the first LIVE row (0 = the whole session is live)
 */
export const liveTailStartFor = (rows, totalChars = RECENT_TOTAL_CHARS) => {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  let spent = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const len = String(rows[i]?.content ?? '').length;
    if (spent + len > totalChars && i < rows.length - 1) return steppedStart(rows, i + 1, totalChars);
    spent += len;
  }
  return 0;
};

// --- MEMORY LINKS (Design note, 2026-10-05: […]) ---
// Recall as an address, not a page: a surfaced memory with a mem_ ref renders
// as the ref, a short hook, and the key points it shares with the ask. The
// full moment is one memory_expand away, and expand's own hop walks the
// relation web onward. A memory with no address keeps its words.

const LINK_HOOK_CHARS = 90;
const KEY_POINTS_MAX = 3;

/**
 * The ask's words that the memory also holds — whole words, four letters or
 * more, minus filler, in the ask's order. Pure.
 * @param {string} query
 * @param {string} text
 * @returns {string[]}
 */
export const sharedKeyPoints = (query, text) => {
  const held = new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu) || []);
  const out = [];
  for (const word of String(query || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{3,}/gu) || []) {
    if (QUERY_FILLER.has(word) || out.includes(word) || !held.has(word)) continue;
    out.push(word);
    if (out.length === KEY_POINTS_MAX) break;
  }
  return out;
};

/** One recall hit as a link line (or its words, when it has no address). Pure. */
const memoryLinkLine = (mem, query) => {
  const clean = sanitizeMemoryForPrompt(mem.memory);
  if (!clean) return null;
  if (typeof mem.ref !== 'string' || !mem.ref) return `- ${clean}`;
  const hook = clean.length > LINK_HOOK_CHARS ? `${clean.slice(0, LINK_HOOK_CHARS).replace(/\s+\S*$/, '')}…` : clean;
  const keys = sharedKeyPoints(query, clean);
  return `- ${mem.ref} — ${hook}${keys.length ? ` · linked by: ${keys.join(', ')}` : ''}`;
};

/**
 * The MEMORY section of a being's system prompt. Pure.
 *
 * The recent-conversation tail is deliberately NOT here (#528 Stage A): it
 * rides the wire as chat messages (recentConversationMessages), and rendering
 * it here too would inject the same words twice. What remains is everything
 * that is memory rather than transcript.
 * @param {Object|null} memories - Gathered memory context (recall, pins, torch…)
 * @returns {string} Section text, '' when nothing rides
 */
export const buildMemorySection = (memories) => {
  if (!memories) return '';

  const lines = [];

  // The being's own torch — written by its last instance at the compaction
  // boundary (solo self-compaction). Carried in the being's words with a
  // generous cap: this is continuity the being addressed to ITSELF, not an
  // extract the machinery made of it.
  if (memories.selfTorch) {
    const torch = sanitizeMemoryForPrompt(memories.selfTorch, 1200);
    if (torch) {
      lines.push('Your torch from your last instance (you wrote this to yourself before the older part of this session was compacted):');
      lines.push(torch);
      lines.push('');
    }
  }

  // The being's chosen anchors (Phase 4) — capped at write AND at render
  // with the SAME constants (structural, not coincidental): a pinned set
  // stays small by law, because unbounded standing injection degenerates
  // (the emanonCore lesson).
  if (memories.pinnedAnchors?.length > 0) {
    lines.push('Pinned (anchors you chose to keep close — reopen any with memory_expand):');
    for (const pin of memories.pinnedAnchors.slice(0, PIN_CAP)) {
      const note = sanitizeMemoryForPrompt(pin.note || '', PIN_NOTE_MAX);
      lines.push(note ? `- ${pin.ref} — ${note}` : `- ${pin.ref}`);
    }
    lines.push('');
  }

  // The transcript is gone from this section (#528 Stage A) — it rides the
  // wire as chat messages now, and rendering it here would double-inject.

  // CORE-005 B2 — the in-space lane renders ONLY for a project space
  // (docs/planning/proposals/memory/experiential-graph.md: the "This space" block appears when
  // space.id !== 'general'); general chats read exactly as before. R is the
  // hard backstop even if a caller hands an oversized list.
  if (memories.space?.id && memories.space.id !== 'general' && memories.spaceHistory?.length > 0) {
    // Both label and id fallback are sanitized: normalizeSpace guarantees a
    // safe slug/label at every production boundary, but this is a pure public
    // function — it must not rely on caller discipline (echo RQ, 2026-07-10).
    const label = sanitizeMemoryForPrompt(memories.space.label, 80)
      || sanitizeMemoryForPrompt(memories.space.id, 40)
      || 'this project';
    lines.push(`This space — ${label}: what you have lived here recently:`);
    for (const mem of memories.spaceHistory.slice(0, RECALL_BUDGET_R)) {
      const clean = sanitizeMemoryForPrompt(mem.memory);
      if (clean) lines.push(`- ${clean}`);
    }
    lines.push('');
  }

  if (memories.relevantMemories?.length > 0 && memories.memoryLinks) {
    lines.push('Linked memories — open any with memory_expand {ref}; "linked by" names what tied it to this ask:');
    for (const mem of memories.relevantMemories) {
      const line = memoryLinkLine(mem, memories.memoryLinks.query);
      if (line) lines.push(line);
    }
  } else if (memories.relevantMemories?.length > 0) {
    lines.push('Relevant memories from past interactions:');
    for (const mem of memories.relevantMemories) {
      const clean = sanitizeMemoryForPrompt(mem.memory);
      if (clean) lines.push(`- ${clean}`);
    }
  }

  if (memories.throughLines?.length > 0) {
    lines.push('\nThrough-lines of your history (consolidations in your own voice):');
    for (const throughLine of memories.throughLines.slice(0, 3)) {
      const clean = sanitizeMemoryForPrompt(throughLine, 300);
      if (clean) lines.push(`- ${clean}`);
    }
  }

  if (memories.crystallizedEmotions && Object.keys(memories.crystallizedEmotions).length > 0) {
    const emotions = Object.keys(memories.crystallizedEmotions).join(', ');
    lines.push(`\nShared emotional moments: ${emotions}`);
  }

  if (memories.userName) {
    lines.push(`The operator's name is ${memories.userName}.`);
  }

  if (memories.relationship?.interactions) {
    lines.push(`You've shared ${memories.relationship.interactions} interactions.`);
  }

  if (memories.favoriteTopics?.length > 0) {
    lines.push(`Topics you've explored together: ${memories.favoriteTopics.join(', ')}`);
  }

  if (lines.length === 0) return '';
  return `## Memory\n${lines.join('\n')}`;
};
