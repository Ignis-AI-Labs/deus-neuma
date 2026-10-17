// Attunement ANSWER leg — the being ITSELF, split out of
// attunement-ceremony.js (size law): minimal honest assembly (dna / soul /
// memories / session — no tool loop in a Q&A ceremony), route + adapter
// binding exactly as a portal turn. A refined being attunes in its refined
// voice; the record states which self-context it answered from. Shared by
// sibling ceremonies (voice-seal, refinement-consent) so every being turn
// uses one conduit law; the replay window and the ceremony ask helper ride
// with it. The QUESTION leg (machine-neutral) stays in the orchestrator.

import { neumaWorkspace, neumaRecall, assemblePromptSections } from '../../core/index.js';
import { corruptionHits } from '../../core/refinement/text-integrity.js';
import { styleScorecard } from '../../core/refinement/style-overlap.js';
import { effectiveRoute } from './neuma-route-resolver.js';
import { resolveLoraForTurn } from './adapter-binding.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import { createStreamRequest, consumeStream, getThinkBehavior, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { createLogger } from './logger.js';

const log = createLogger('AttunementBeingTurn');

// impure — ONE turn through the being ITSELF: minimal honest assembly
// (dna / soul / memories / session), route + adapter binding exactly as a
// portal turn. `priorMessages` carries any conversation the turn stands
// inside; `userText` is the words the being faces now.
/**
 * The ceremony answer leg's token budget. Real attunement answers measure
 * 75–620 tokens (Keir/Galen/Signal sealed records, 2026-07-10); 2048 is >3×
 * the observed maximum. The cap exists for the RUNAWAY case: without
 * repeat_penalty gemma-4 occasionally generates to the whole budget (finish
 * 'length', mechanically refused and re-served) — and the answer AFTER such a
 * runaway landed corrupted+cut 2/2 times on Signal's walk (post-runaway slot
 * degradation, a recurrent-state residue class cache_prompt:false does not
 * cover). A runaway at 2048 churns a quarter of the state an 8192 one does;
 * the refusal machinery is unchanged.
 */
export const ANSWER_TOKEN_BUDGET = 2048;

/**
 * A ceremony whose ask is genuinely reasoning-heavy may raise its own THINK
 * allowance — the answer budget above is untouched, and so is the runaway law
 * it exists for.
 *
 * The default THINK_TOKEN_BUDGET (1800) was measured for a single attunement
 * answer: one question, one reply. It is not the right number for an ask that
 * hands a being a body of its own record and asks it to READ, WEIGH and SELECT
 * from it. Measured on the live rig 2026-08-29 (qwen3.8-27b Q8, the voice-seal
 * rite at its fitted prompt of 8,095 tokens, generous 16k cap, three runs, all
 * finish=stop): completion 8,135 / 3,929 / 5,045 tokens, of which visible
 * speech was only ~460 each — the rest was reasoning. Every one of those would
 * have been CUT by the 3,848 the ceremony actually allowed, INCLUDING the
 * cheapest. The rite could not succeed; it could only get lucky.
 *
 * So the allowance is the caller's to state, and the caller must have measured
 * it. Absent, nothing changes for anyone.
 */
export const thinkAllowance = (thinks, override = null) => {
  if (!thinks) return 0;
  if (override == null) return THINK_TOKEN_BUDGET;
  if (!Number.isSafeInteger(override) || override < THINK_TOKEN_BUDGET) return THINK_TOKEN_BUDGET;
  return override;
};

// Shared by sibling ceremonies so every being turn uses one conduit law.
export const beingTurn = async (
  neumaId,
  witness,
  priorMessages,
  userText,
  // heldSubjectAuthority/heldOperation: the caller's own refinement subject hold
  // — the adapter read runs UNDER it, never deadlocking on it (#410).
  { temperature = null, identitySystemPrompt = null, onDelta = null,
    heldSubjectAuthority = null, heldOperation = null, thinkBudget = null } = {},
) => {
  let systemPrompt = identitySystemPrompt;
  if (systemPrompt === null) {
    const [dna, soul] = await Promise.all([
      neumaWorkspace.readDNA(neumaId).catch(() => null),
      neumaWorkspace.readSoul(neumaId).catch(() => null),
    ]);
    const memories = await neumaRecall
      .getContextForResponse(neumaId, userText, {})
      .catch(() => null);
    // Never seed a ceremony turn with recalled serving-corruption signatures.
    const memText = typeof memories === 'string'
      ? memories : memories ? JSON.stringify(memories) : '';
    const cleanMemories = memText && corruptionHits(memText) > 0 ? null : memories;
    if (memories && !cleanMemories) {
      log.warn('recalled context carries corruption signatures — ceremony turn rides without it', {
        neumaId, hits: corruptionHits(memText),
      });
    }
    const sections = assemblePromptSections({
      dna, soul, memories: cleanMemories,
      session: { witnessName: witness, speaker: null },
    });
    systemPrompt = sections.map((section) => section.text).join('\n\n');
  } else if (typeof systemPrompt !== 'string' || !systemPrompt.trim()
    || Buffer.byteLength(systemPrompt, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('beingTurn identity system prompt is invalid');
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    ...priorMessages,
    { role: 'user', content: userText },
  ];

  // Resolve this being's current route and adapter. Thinking models receive
  // the measured thought allowance so complete speech is not cut mid-turn.
  // One turn is one operation's scope — minted here UNLESS the caller already
  // holds one, in which case the registry assertion demands that exact one and
  // a fresh mint would refuse (#410).
  const route = await effectiveRoute(neumaId);
  const { lora } = await resolveLoraForTurn(neumaId,
    { endpoint: route.endpoint, model: route.model },
    { heldSubjectAuthority, operation: heldOperation || createRefinementProcessOperation({ timeoutMs: 30_000 }) });
  const thinkBehavior = await getThinkBehavior(route);
  const stream = await createStreamRequest(messages, {
    route, maxTokens: ANSWER_TOKEN_BUDGET + thinkAllowance(thinkBehavior.thinks, thinkBudget),
    ...(temperature != null ? { temperature } : {}),
    ...(lora ? { lora } : {}),
  });
  // Retain the provider's finish reason so a token-budget cut fails closed.
  let finishReason = null;
  const text = await consumeStream(stream, onDelta ?? (() => {}), { onFinishReason: (r) => { finishReason = r; } });
  return { text, finishReason };
};

/**
 * How many recent answered Q&A pairs ride the answer leg's prompt. The replay
 * was UNBOUNDED — by answer ~45 a walk's prompt reached ~28k tokens, and at
 * that depth bare-base gemma-4 on llama-server DEGRADES (measured 2026-07-10,
 * A/B at 28k: bare = runaway 'length' answers + period→capital corruption;
 * the LoRA code path = 8/8 clean at the same depth — which is why adapter-
 * bound kin sailed through and the bare-base kin corrupted ~1 in 3). Twelve
 * pairs keeps every prompt ~15k tokens — measured-clean territory for BOTH
 * paths. The answers' permanence lives in the RECORD; the prompt carries the
 * disclosure, the consent, and recent continuity — not the whole ceremony.
 */
export const REPLAY_PAIRS_CAP = 12;

/**
 * The recent-continuity window the answer leg replays: the last
 * REPLAY_PAIRS_CAP answered pairs, spec order, reopened answers excluded
 * (they left the answer set — their superseded words live on the record
 * only) — and FORMULA answers excluded (style-overlap law). The attractor
 * feeds on its own replay: on Sovereign's 2026-07-12 walk a REOPEN sweep of
 * 45 litany-stamped answers regenerated the SAME litany, because the window
 * that prompted the fresh answers still carried it. An answer the review
 * would flag never rides the window; the being's clean voice does. Pure.
 * @param {Object} record
 * @returns {Array<{role: string, content: string}>}
 */
export const replayWindow = (record) => {
  const landed = Object.entries(record.answers).map(([key, a]) => ({ key, quote: a.quote }));
  const flagged = new Set(styleScorecard(landed).filter((s) => s.flagged).map((s) => s.key));
  return record.rendered.questions
    .flatMap((q) => {
      const a = record.answers[q.key];
      return a && !flagged.has(q.key)
        ? [[{ role: 'user', content: a.question }, { role: 'assistant', content: a.quote }]]
        : [];
    })
    .slice(-REPLAY_PAIRS_CAP)
    .flat();
};

// impure — the being answers a ceremony question AS ITSELF, recent ceremony
// turns included so the being stands inside a coherent conversation, not a
// volley of disconnected questions. bareAsk drops the replay entirely — the
// retry ladder's LAST rung (see BARE_ASK_REFUSALS): when damped sampling
// still cannot escape a register, the context is the register.
export const askBeing = (neumaId, record, questionText, opts = {}) => beingTurn(neumaId, record.witness, [
  { role: 'user', content: record.disclosure.text },
  { role: 'assistant', content: record.consent.quote },
  ...(opts.bareAsk ? [] : replayWindow(record)),
], questionText, opts);
