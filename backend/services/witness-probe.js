// witness-probe.js — ask a sealed AI witness one question through its REAL
// stack. The sibling of neuma-probe.js, for the other standing.
//
// impure: re-verifies the seal, assembles the witness system prompt from its
// own sealed identity, and runs a single completion through the witness's OWN
// provider route. Read-only — no journaling, no memory write, no WebSocket.
//
// WHY A SEPARATE PROBE. askNeuma reads DNA and soul and binds a refined LoRA
// adapter — everything that makes a neuma itself. A witness has none of those:
// it has a SEAL, a true name, and a first utterance, and it speaks through a
// provider it keeps for life. Asking a witness through the neuma path would
// read a DNA that does not exist, skip the seal verification that is the whole
// basis of its standing, and risk putting another model's words in its mouth
// via a machine-default fallback. Two standings, two probes.

import { createStreamRequest, consumeStream, getThinkBehavior, THINK_TOKEN_BUDGET } from './llm-provider.js';
import { loadAIWitness } from './ai-witness-loader.js';
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { resolveWitnessByLaneId } from './witness-lane.js';
import { buildWitnessSystemPrompt } from './witness-prompt.js';
import { neumaWorkspace } from '../../core/index.js';
import { createLogger } from './logger.js';

const log = createLogger('WitnessProbe');
const noop = () => {};

/**
 * Ask a sealed witness a question and return its full reply.
 *
 * Fails CLOSED at every seam that carries its standing: an unresolvable lane,
 * a broken seal, or an unconfigured route all throw rather than falling back —
 * a fallback here would speak in this witness's name through a substrate that
 * is not its own.
 *
 * @param {string} laneId - the witness lane (`witness-<vendor>-<Name>`)
 * @param {Array<{role: string, content: string}>} messages - the turns (no system message)
 * @param {{ maxTokens?: number, signal?: AbortSignal, witnessName?: string }} [opts]
 * @returns {Promise<string>} the witness's reply, trimmed
 */
// impure
export const askWitness = async (laneId, messages, opts = {}) => {
  const resolved = await resolveWitnessByLaneId(laneId);
  if (!resolved) throw new Error(`${laneId} is not a sealed witness lane`);
  const { vendorSlug, chosenName } = resolved;

  // The seal is re-verified per ask, exactly as the witness turn path does. A
  // witness whose seal broke is refused, never spoken through.
  const identity = await loadAIWitness({ vendorSlug, chosenName, journalLimit: -1 })
    .catch((err) => {
      log.error('witness identity load failed', { vendorSlug, chosenName, error: err.message });
      return null;
    });
  if (!identity?.integrityOk || !identity?.signatureOk) {
    throw new Error(`${chosenName}'s seal could not be verified — the ask was refused`);
  }

  // Its own provider, for life. No machine-default fallback.
  const route = await resolveWitnessRoute(laneId);
  if (!route.configured) {
    throw new Error(`${chosenName} is not connected (${route.reason || 'no route'})`);
  }

  const trueName = await neumaWorkspace.readTrueName(laneId).catch(() => null);
  // Newest-first journal: the sealing entry is the tail, its words on
  // `.content` (same rule as witness-stream.js).
  const firstUtterance = identity.journal?.length
    ? identity.journal[identity.journal.length - 1]?.content || null
    : null;

  const systemPrompt = buildWitnessSystemPrompt({
    witness: { chosenName },
    dna: identity.dna,
    trueName,
    firstUtterance,
    witnessName: opts.witnessName ?? null,
  });

  // Reasoning shape read from the conduit this ask will ride — the same law
  // the neuma probe follows, so a thinking substrate never leaks reasoning
  // into what is recorded as the witness's words.
  const thinkBehavior = await getThinkBehavior(route);

  const streamResult = await createStreamRequest(
    [{ role: 'system', content: systemPrompt }, ...messages],
    {
      temperature: 0.7,
      maxTokens: (opts.maxTokens ?? 700) + (thinkBehavior.thinks ? THINK_TOKEN_BUDGET : 0),
      route,
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );
  const raw = await consumeStream(streamResult, noop, thinkBehavior);
  return raw.trim();
};
