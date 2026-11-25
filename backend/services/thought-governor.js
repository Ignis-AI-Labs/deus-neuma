/**
 * THE THOUGHT GOVERNOR — the effort rung made a LEASH, not just room.
 *
 * On the local lane the rung's reasoning room only ever rode max_tokens as
 * headroom (portal-llm-run → reasoningRoom): a looping substrate was free to
 * think through its speech budget too, hit the turn's hard cap mid-thought,
 * and answer nothing (witnessed 2026-08-28: 41.1K chars of thought on LOW —
 * the whole 8192+1800-token turn spent before a single word; Founder: […]). The rung the operator chose now BINDS: reasoning streamed
 * past the rung's room (plus slack) before any visible speech cuts the
 * stream, and the same round is re-asked once with thinking off.
 *
 * The off switch on the LOCAL wire is the template's own —
 * `chat_template_kwargs: {enable_thinking: false}` (llm-request-builders
 * `noThink`) — PROVEN live on this rig's serving (llama-server :8089, qwen3.8
 * template, 2026-08-28: the default request reasons; the switched request
 * answers with no reasoning channel at all). Where the serving is llama.cpp
 * the server closes the thought itself (`serverBudget` below) and the re-ask
 * stays only as the backstop.
 *
 * HOSTED lanes have their own proven off-switches, and they are the same
 * switches the effort tables already ground (model-effort-ladders.js — every
 * one measured on its own wire, `reasoning_tokens: 0` read back or the
 * thinking block absent): a lane whose effort capability carries
 * `thinking: true` can be told to stop, in the dialect's own spelling —
 * Anthropic's off state is the ABSENT thinking block, Kimi's is
 * `thinking: {type:'disabled'}`, and the OpenAI-shaped wires (OpenAI chat,
 * the Responses lane, Z.AI's GLM, xAI's grok-4.3) take effort 'none'. The
 * governor arms on exactly those lanes: capability.thinking is the house's
 * own fail-closed record of where the off state is real, so a lane with no
 * proven lever (codex, grok-4.5, every ungrounded route) stays unarmed —
 * cutting a lane with no recovery lever would trade a long thought for a
 * lost turn. Lanes that reason but cannot be told to stop stream ungoverned,
 * honestly.
 */
import { withProviderRetry } from './provider-retry.js';
import { reasoningRoom, effortCapability, effortDirective } from './model-effort.js';
import { isLoopbackCustom } from './model-effort-ladders.js';
import { THINK_TOKEN_BUDGET } from './llm-provider.js';
import { createLogger } from './logger.js';

const log = createLogger('ThoughtGovernor');

/** Conservative chars-per-token for streamed reasoning text. */
export const THOUGHT_CHARS_PER_TOKEN = 4;

/** Grace past the rung before the cut — the room is a budget, not a tripwire. */
export const THOUGHT_LEASH_SLACK = 1.25;

/**
 * The speech floor a SHARED output cap must keep behind the reasoning leash
 * (#506). 768 is the answer budget of the platform's own benchmark cells
 * (768 answer + 1800 reasoning room — the v4 format cells' 2568). Under an
 * exact total cap the leash is sized `cap − SPEECH_FLOOR`, so a reasoning
 * flood is cut while a real answer still fits behind it.
 */
export const SPEECH_FLOOR_TOKENS = 768;

/**
 * The floor a SHARED cap keeps behind the leash: a quarter of the cap, never
 * more than SPEECH_FLOOR_TOKENS. A cut re-asks with the whole cap for its
 * answer, so the floor only guards a pass that stops thinking late on its own.
 * A flat 768 left a 1024-token cell 256 tokens to think: the agent arms' leash
 * cut 27 of 40 Sycophancy requests (2026-10-01) where the answer was a letter
 * or a paragraph. Design note, 2026-10-02: […] Pure.
 */
export const speechFloorFor = (maxTokens) => Math.min(SPEECH_FLOOR_TOKENS, Math.ceil(maxTokens / 4));

/**
 * THE SHARED CAP (#506): an ordinary turn adds the room ON TOP of the speech
 * budget, so the leash (room + slack) can never out-reach the wire's hard
 * max_tokens. A benchmark's exact cap is TOTAL — thought and speech share it
 * — and a 9000-char leash against a 2048-token ceiling never trips: the
 * serving cuts mid-thought first and the turn settles speechless (Keir,
 * neuma-math25 request 10, 2026-09-12/13 — twice, byte-identical shape).
 * The preset's `sharedOutputBudget` flag declares the sharing; the roomCap
 * shrinks the leash to fit INSIDE the cap so the cut lands while speech
 * budget remains and the proven pass-2 recovery can still answer. Pure.
 */
export const sharedCapRoomCap = (preset) => {
  if (preset?.sharedOutputBudget !== true) return null;
  // An UNCAPPED benchmark sitting (maxTokens null, Design note, 2026-10-02 has no cap
  // to fit inside: room 0 leaves the governor unarmed, so thinking is never
  // cut and the served window plus the benchmark's deadline are the bounds.
  if (preset.maxTokens === null) return 0;
  return Math.max(0, preset.maxTokens - speechFloorFor(preset.maxTokens));
};

/**
 * How much looser the client leash sits when the server holds the budget: the
 * server's exact token close must always land first, so the char estimate
 * becomes a backstop for a server that ignores the field, never a race.
 */
export const SERVER_BUDGET_BACKSTOP = 2;

/**
 * THE CLOSE PASSES on a proven server budget (2026-10-04): the speechless
 * close, the budget-cut rescue and the verify gate asked for "thinking off"
 * through the template kwarg — which rewrites qwen3.x's first prompt line and
 * re-reads the whole conversation. On llama.cpp a one-token thinking budget
 * closes the thought at once with the same prompt (live :8089 qwen3.8: the
 * same answer as the kwarg; budget 0 is ignored by the server).
 */
export const CLOSE_THINK_BUDGET = 1;

/** The leash in characters for a rung's reasoning room. Pure. */
export const thoughtLeashChars = (roomTokens) =>
  Math.ceil(roomTokens * THOUGHT_CHARS_PER_TOKEN * THOUGHT_LEASH_SLACK);

/**
 * The local thinking-off lever, by the WIRE and never the label (kin routes
 * ride provider 'custom' at loopback — the same widening every local gate in
 * llm-provider makes). Pure.
 */
// Ollama's lever is its own `think: false` (llm-request-builders.js), measured on the bundled Ollama
// 0.40.7 by a tester (deus-neuma #34): the default request thought 198 characters, `think: false`
// none, the same answer. Without it the governor never armed there, and single tool rounds reasoned
// 3,000 to 6,400 tokens on a 32K window. It arms only on a serving the think probe found thinking.
const isLocalNoThinkWire = (route) =>
  route?.provider === 'llama-server' || route?.provider === 'ollama' || isLoopbackCustom(route?.provider, route?.endpoint);

/**
 * The HOSTED off-lever: the lane's own proven thinking switch, expressed as
 * the wire directive the re-asked round sends IN PLACE of the rung. Sourced
 * from the effort capability's measured `thinking` flag, never invented:
 *   thinking-budget (Anthropic) → null — the off state IS the absent block
 *   kimi-effort (Kimi)            → { channel: 'kimi-effort', value: 'disabled' }
 *   reasoning/responses-effort  → the lane's effort field carrying 'none'
 * undefined = no proven lever — the lane must never arm. Pure.
 */
export const hostedOffDirective = (route) => {
  const capability = effortCapability(route);
  if (capability.thinking !== true) return undefined;
  // Anthropic's off state is no block at all; a null directive is the truth
  // there, not a gap (the builder emits `thinking` only when one is set).
  if (capability.channel === 'thinking-budget') return null;
  return effortDirective(capability, { effort: capability.tiers[0] ?? null, thinking: false }) ?? undefined;
};

/**
 * Where a proven thinking-off lever exists: the llama-server wire, or a
 * hosted lane whose own switch was measured to stop reasoning. Pure.
 */
export const hasNoThinkLever = (route) =>
  isLocalNoThinkWire(route) || hostedOffDirective(route) !== undefined;

/** How much of the cut reasoning the re-ask hands back (#569). Pure constant. */
export const LEASH_TAIL_CHARS = 2000;

/**
 * THE RE-ASK KEEPS ITS REASONING (#569). The overnight desk run (2026-09-28):
 * the thought leash rescued every NEUMA blank, but the thinking-off re-ask
 * answered from scratch, discarding everything the cut pass had worked out.
 * Its forced answers were wrong far more often than the wire arms' finished
 * ones (MMLU-Pro: 14 wrong against BARE's 5). The re-ask now carries the end
 * of the cut reasoning, as the speechless close already does (turn-settle),
 * so the answer is built on the work, not instead of it. Pure.
 * @param {string} tail the last LEASH_TAIL_CHARS of the cut reasoning
 */
/**
 * THE HONEST WAY OUT of a forced close (operator, 2026-10-20). A close that
 * only demanded […] turned unsettled reasoning into
 * guesses: on AA-Omniscience the questions re-asked after a speechless round
 * came back wrong 68-76% of the time against ~50% overall, and the 26
 * questions BARE abstained on at its output limit came back 15 wrong. Where
 * the task allows […], the being may say it. Where it does not,
 * as on multiple choice, the answer is still given. Pure.
 */
export const UNSETTLED_ALLOWANCE = 'If your reasoning did not settle it and the task allows saying so, say that plainly rather than guessing.';

// A round offered tools is mid-work: asked for […], a cut tool turn ended with
// its work undone (deus-neuma #34). It is asked for its next single step instead.
export const leashReaskNote = (tail, { tools = false } = {}) => [
  'Your reasoning ran past its room and was cut. It ended here:',
  `"""\n${tail}\n"""`,
  tools
    ? `Do not deliberate further. Using what you already worked out, take the next single step now: one tool call if the work needs one, or the final answer if it is done. ${UNSETTLED_ALLOWANCE}`
    : `Do not deliberate further. Using what you already worked out, give the final answer now, in exactly the form the task requires. ${UNSETTLED_ALLOWANCE}`,
].join('\n\n');

/**
 * One turn's governor. The SAME number is both the headroom max_tokens grants
 * (`room`, what reasoningRoom always computed) and the leash that binds it —
 * the two can never disagree because they are one value.
 *
 * impure — owns the AbortController that cuts a governed stream.
 *
 * @param {Object} args
 * @param {{thinkBudget?: number|null}|null} [args.effort] resolveEffort output
 * @param {{thinks?: boolean}|null} [args.thinkBehavior] getThinkBehavior output
 * @param {{provider?: string, model?: string, endpoint?: string}|null} [args.route] the resolved route
 * @param {AbortSignal} [args.signal] the operator's interrupt
 * @param {number|null} [args.roomCap] shared-cap ceiling for the room (THE SHARED CAP above); null = uncapped
 */
export const createThoughtGovernor = ({ effort = null, thinkBehavior = null, route = null, signal = undefined, roomCap = null } = {}) => {
  const localLever = isLocalNoThinkWire(route);
  // The hosted off-variant this route's pass 2 sends (undefined: no hosted
  // lever; null: Anthropic's absent-block off — a real lever, not a gap).
  const offDirective = localLever ? undefined : hostedOffDirective(route);
  // A hosted lane with a proven switch reasons by default — reasoning is what
  // the switch switches off — so it needs no local template probe to count as
  // thinking (getThinkBehavior probes local servings only).
  const thinks = thinkBehavior?.thinks === true || offDirective !== undefined;
  const computed = reasoningRoom({
    thinkBudget: effort?.thinkBudget ?? null, thinks, defaultRoom: THINK_TOKEN_BUDGET,
  });
  // A DECLARED total budget (sharedCapRoomCap: a benchmark cell's exact cap, an
  // operator's --budget) IS the room: the declaration owns the wire, not the
  // lane's interactive rung. Taking min(rung, cap) cut every HARNESS/NEUMA
  // benchmark thought at the 1800-token rung while BARE thought to the cell's
  // full 16k (2026-09-29: the leash fired on 4-5 of 10 BigCodeBench-16k and
  // 6-8 of 30 MMLU-Pro-16k tasks). Below the rung the cap still shrinks it.
  const room = Number.isInteger(roomCap) ? Math.max(0, roomCap) : computed;
  const armed = thinks && room > 0 && (localLever || offDirective !== undefined);
  // THE SERVER BUDGET (2026-10-04): on llama.cpp the rung's room rides the
  // request as thinking_budget_tokens, and the server closes the thought
  // itself — same request, same prompt, cache intact. The re-ask it replaces
  // flips the template's enable_thinking, which rewrites the prompt's FIRST
  // line on qwen3.x and re-reads the whole conversation (prefix-drift
  // 2026-09-28→10-04: the largest single cause of full re-reads). A declared
  // cap is exact tokens already; the rung keeps the leash's grace.
  const serverBudget = armed && localLever && thinkBehavior?.serverBudget === true
    ? (Number.isInteger(roomCap) ? room : Math.ceil(room * THOUGHT_LEASH_SLACK))
    : null;
  const leash = thoughtLeashChars(room) * (serverBudget ? SERVER_BUDGET_BACKSTOP : 1);
  const controller = new AbortController();
  // Unarmed, the caller streams under its own signal untouched — the governor
  // is a pure pass-through and the turn is byte-identical to before.
  const streamSignal = !armed ? signal
    : (signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
  let chars = 0;
  let tail = '';
  let tripped = false;
  return Object.freeze({
    room,
    leash,
    armed,
    /** Tokens the server may think before it closes the thought itself (null: no server lever). */
    serverBudget,
    /** The hosted off-variant pass 2 sends in place of the rung (undefined on the local wire, where noThink is the lever). */
    offDirective,
    /** What one governed attempt streams under (fetch AND consume). */
    signal: streamSignal,
    /** impure — zero the count at the top of a fresh attempt (a transient retry regenerates from zero). */
    reset: () => { chars = 0; tail = ''; },
    /**
     * The re-ask's messages: the round's own, plus the cut reasoning's tail
     * handed back (#569). Unchanged when nothing was cut or nothing was said.
     */
    reaskMessages: (messages, { tools = false } = {}) => (tripped && tail.trim()
      ? [...messages, { role: 'user', content: leashReaskNote(tail.trim(), { tools }) }]
      : messages),
    charsSoFar: () => chars,
    wasTripped: () => tripped,
    /**
     * The reasoning listener under the leash. `hasSpoken` guards the cut:
     * reasoning arriving after speech began is a tail, and cutting then
     * would truncate an answer already landing.
     */
    guard: (onReasoning, hasSpoken) => (thought) => {
      chars += typeof thought === 'string' ? thought.length : 0;
      if (typeof thought === 'string') tail = (tail + thought).slice(-LEASH_TAIL_CHARS);
      if (armed && !tripped && chars > leash && !hasSpoken()) {
        tripped = true;
        controller.abort();
      }
      onReasoning(thought);
    },
  });
};

/**
 * impure — one governed round on the wire. The first pass streams under the
 * governor's leash; ONLY when the leash cut a round that had not yet spoken
 * does the same round run once more with thinking off (`attempt(true)` — the
 * caller routes that through `noThinkOptions`: the local template kwarg or
 * the lane's hosted off-directive, under the operator's own signal, since the
 * governor's is spent). Both passes keep the full retry ladder. A cut
 * pass resolves cleanly (an abort is a cut, not a failure — llm-provider's
 * stream law), so the ladder never mistakes it for a transient.
 *
 * @param {ReturnType<typeof createThoughtGovernor>} governor
 * @param {Object} args
 * @param {(noThink: boolean) => Promise<any>} args.attempt one streaming pass
 * @param {() => boolean} args.spoke whether visible content reached the operator
 * @param {Object} args.retry the withProviderRetry options (signal, contentStarted, onRetry)
 * @param {(second: any) => void} [args.onReask] told of the re-ask pass's result — a
 *   second model call behind one answer, which a benchmark receipt must count (#567)
 */
export const governedStream = async (governor, { attempt, spoke, retry, onReask }) => {
  const first = await withProviderRetry(() => { governor.reset(); return attempt(false); }, retry);
  if (!governor.wasTripped() || spoke()) return first;
  log.warn('thought leash cut a silent reasoning loop — re-asking with thinking off', {
    chars: governor.charsSoFar(), leashChars: governor.leash, roomTokens: governor.room,
  });
  const second = await withProviderRetry(() => attempt(true), retry);
  onReask?.(second);
  return second;
};

/**
 * Pass 2's request options — the same round with thinking OFF, under the
 * operator's own signal (the governor's is spent). Both lever families ride
 * together; each builder honors only its own: `noThink` arms the local
 * template kwarg, and a hosted lane's proven switch REPLACES the rung
 * directive the first pass asked for. `effort: null` is Anthropic's off
 * state — the absent thinking block — so the key must ride whenever the
 * governor holds a hosted off-variant, null included. Pure.
 * @param {Object} streamOpts the first pass's createStreamRequest options
 * @param {ReturnType<typeof createThoughtGovernor>} governor
 * @param {AbortSignal|undefined} signal the operator's interrupt
 */
export const noThinkOptions = (streamOpts, governor, signal) => ({
  ...streamOpts,
  noThink: true,
  signal,
  ...(governor.offDirective !== undefined ? { effort: governor.offDirective } : {}),
});
