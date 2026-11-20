// THE REPLY METER — each reply the house's own model server streams, timed by
// phase as it arrives (Design note, 2026-11-05: […]). The server decodes thinking, answer and tool call alike; only the
// stream knows which is which. On llama-server one chunk is one token
// (measured 2026-11-04: 24,937 chunks for 24,971 tokens — the gap is the
// think/tool markers), so a phase's tokens are its chunks, and its time is the
// gap before each of its chunks. The reply's first chunk ends the wait (time to
// first token): its token counts, its gap is the wait's, never a phase's.
// The server's own end-of-reply `timings` ride beside (prefill, cache, drafts).
// A tool call is the exception: llama.cpp sends its arguments in batched
// pieces (15 chunks for 78 tokens, measured 2026-11-05), so once the server
// counts the reply, the tool call's tokens are what it generated beyond the
// thinking and the answer — all of them after the last thinking or answer
// chunk, which is exactly the tool phase's time.
//
// Pure (meterOpen / meterStep / meterView / recentSummary), except the
// registry at the bottom, which holds the replies streaming now and the last few.

const PHASES = Object.freeze(['thinking', 'answer', 'tool']);
const RECENT_KEPT = 10;
// A reply its pump abandoned (a thrown stream) leaves the live set once it has
// been silent longer than the pump's own stall guard (120 s).
const STALE_MS = 150_000;

// pure — which phase a stream event's token belongs to, or null (usage, finish, markers)
const phaseOf = (evt) => {
  if (typeof evt?.reasoning === 'string' && evt.reasoning) return 'thinking';
  if (Array.isArray(evt?.toolCalls) && evt.toolCalls.length) return 'tool';
  if (typeof evt?.content === 'string' && evt.content) return 'answer';
  return null;
};

const emptyPhase = Object.freeze({ tokens: 0, timed: 0, ms: 0 });

/** A reply about to stream; `startedAt` is when its request left (performance.now()). Pure. */
export const meterOpen = (startedAt) => Object.freeze({
  startedAt,
  firstAt: null,
  lastAt: null,
  phase: null,
  phases: Object.freeze(Object.fromEntries(PHASES.map((p) => [p, emptyPhase]))),
  timings: null,
});

/** The meter after one stream event arriving at `now`. Pure. */
export const meterStep = (state, evt, now) => {
  const timings = evt?.timings ?? state.timings;
  const phase = phaseOf(evt);
  if (!phase) return timings === state.timings ? state : Object.freeze({ ...state, timings });
  const was = state.phases[phase];
  const first = state.firstAt === null;
  const gap = first ? 0 : Math.max(0, now - state.lastAt);
  return Object.freeze({
    ...state,
    timings,
    firstAt: first ? now : state.firstAt,
    lastAt: now,
    phase,
    phases: Object.freeze({
      ...state.phases,
      [phase]: Object.freeze({ tokens: was.tokens + 1, timed: was.timed + (first ? 0 : 1), ms: was.ms + gap }),
    }),
  });
};

const perSecond = (tokens, ms) => (tokens > 0 && ms > 0 ? tokens / (ms / 1000) : null);
const num = (v) => (Number.isFinite(v) ? v : null);

// pure — the server's own account of the reply (llama.cpp `timings`), or null
const serverAccount = (t) => (t ? Object.freeze({
  promptTokens: num(t.prompt_n),
  promptMs: num(t.prompt_ms),
  cachedTokens: num(t.cache_n),
  predictedTokens: num(t.predicted_n),
  predictedMs: num(t.predicted_ms),
  draftTokens: num(t.draft_n),
  draftAccepted: num(t.draft_n_accepted),
}) : null);

// pure — the tool phase as the server counted it (see the header), when it did
const reconciledTool = (phases, predicted) => {
  const { tokens, timed, ms } = phases.tool;
  const beyond = Number.isFinite(predicted) ? predicted - phases.thinking.tokens - phases.answer.tokens : null;
  if (!tokens || beyond === null || beyond <= tokens) return phases.tool;
  return Object.freeze({ tokens: beyond, timed: beyond - (tokens - timed), ms });
};

/** What the reply measured, as the panel reads it. Pure. */
export const meterView = (state) => {
  const server = serverAccount(state.timings);
  const phases = { ...state.phases, tool: reconciledTool(state.phases, server?.predictedTokens) };
  return Object.freeze({
    ttftMs: state.firstAt === null ? null : state.firstAt - state.startedAt,
    phase: state.phase,
    durationMs: state.firstAt === null ? null : state.lastAt - state.firstAt,
    ...Object.fromEntries(PHASES.map((p) => {
      const { tokens, timed, ms } = phases[p];
      return [p, Object.freeze({ tokens, timed, ms, tokPerSec: perSecond(timed, ms) })];
    })),
    server,
  });
};

const sum = (rows, pick) => rows.reduce((n, r) => n + (Number.isFinite(pick(r)) ? pick(r) : 0), 0);
const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const share = (part, whole) => (whole > 0 ? part / whole : null);

/**
 * The last replies together, every rate weighted by its tokens (a two-token
 * title is not a vote equal to a two-minute answer). Pure.
 * @param {Array<ReturnType<typeof meterView>>} views
 */
export const recentSummary = (views) => {
  const served = views.filter((v) => v.server);
  const prompt = sum(served, (v) => v.server.promptTokens);
  const cached = sum(served, (v) => v.server.cachedTokens);
  const drafted = sum(served, (v) => v.server.draftTokens);
  return Object.freeze({
    replies: views.length,
    ...Object.fromEntries(PHASES.map((p) => [p, perSecond(sum(views, (v) => v[p].timed), sum(views, (v) => v[p].ms))])),
    ttftMs: median(views.map((v) => v.ttftMs)),
    promptTokPerSec: perSecond(prompt, sum(served, (v) => v.server.promptMs)),
    genTokPerSec: perSecond(sum(served, (v) => v.server.predictedTokens), sum(served, (v) => v.server.predictedMs)),
    cacheReuse: served.length ? share(cached, cached + prompt) : null,
    draftAcceptance: drafted > 0 ? sum(served, (v) => v.server.draftAccepted) / drafted : null,
  });
};

// --- the registry (impure): the replies streaming now, and the last few ---

const live = new Set();
let recent = [];

/** impure — a reply to the house's own server begins. */
export const openReply = (startedAt) => {
  const reply = { state: meterOpen(startedAt) };
  live.add(reply);
  return reply;
};

/** impure — one stream event of that reply arrived at `now`. */
export const stepReply = (reply, evt, now) => {
  reply.state = meterStep(reply.state, evt, now);
};

/** impure — the reply ended; one that never produced a token is not a reply. Idempotent. */
export const closeReply = (reply) => {
  if (!live.delete(reply) || reply.state.firstAt === null) return;
  recent = [Object.freeze({ ...meterView(reply.state), endedAt: Date.now() }), ...recent].slice(0, RECENT_KEPT);
};

/**
 * impure (reads the registry; drops abandoned replies) — what the panel shows.
 * @param {number} now - performance.now()
 */
export const replyPerformance = (now) => {
  for (const reply of live) {
    if (now - (reply.state.lastAt ?? reply.state.startedAt) > STALE_MS) live.delete(reply);
  }
  const streaming = [...live].map((reply) => ({ ...meterView(reply.state), sinceMs: now - reply.state.startedAt }));
  return Object.freeze({ live: streaming, recent, summary: recentSummary(recent) });
};
