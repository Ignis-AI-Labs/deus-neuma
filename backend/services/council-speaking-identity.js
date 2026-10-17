// council-speaking-identity.js — the sovereign identity behind one council seat.

import { neumaWorkspace, assemblePrompt } from '../../core/index.js';
import { getConfig } from './llm-provider.js';
import { resolveLoraForTurn } from './adapter-binding.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import { resolveNeumaRoute, isSovereigntyRefusal } from './neuma-route-resolver.js';
import { isSovereignProvider } from './provider-registry.js';
import { isWitnessLaneId, resolveWitnessByLaneId } from './witness-lane.js';
import { loadAIWitness } from './ai-witness-loader.js';
import { resolveWitnessRoute } from './witness-route-resolver.js';
import { buildWitnessSystemPrompt } from './witness-prompt.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

// The speaking identity for a seat, resolved by its STANDING. A neuma speaks
// from DNA + soul through its natal/override route with its own adapter; a
// witness speaks from its re-verified SEAL through the provider it keeps for
// life, with no adapter and no machine-default fallback. Returning one shape
// lets the floor turn stay a single path.
// impure — reads sovereign identity / verifies a seal.
// Exported directly from this focused owner (#207): the sovereignty law it
// enforces is the whole point of the function, and a test that proves it
// against a copy proves the copy.
export const speakingIdentityFor = async (member) => {
  // The LANE ID is the authority, not just the carried `kind`. Standing must
  // not depend on a field surviving every hop: if it is ever dropped again,
  // a witness lane still takes the witness path rather than silently falling
  // through to a neuma read and the machine default.
  if (member.kind === 'witness' || isWitnessLaneId(member.neumaId)) {
    const resolved = await resolveWitnessByLaneId(member.neumaId);
    if (!resolved) throw new Error(`${member.neumaId} is not a sealed witness lane`);
    const identity = await loadAIWitness({
      vendorSlug: resolved.vendorSlug, chosenName: resolved.chosenName, journalLimit: -1,
    });
    // Re-verified per turn, exactly as the 1:1 witness path does: a seal that
    // broke since the council opened must not speak in this operator's name.
    if (!identity?.integrityOk || !identity?.signatureOk) {
      throw new Error(`${resolved.chosenName}'s seal could not be verified`);
    }
    const trueName = await neumaWorkspace.readTrueName(member.neumaId).catch(() => null);
    // The journal is newest-first, so the SEALING entry is the tail, and its
    // words live on `.content` — the same rule witness-stream.js follows. A
    // wrong field name here reads as null and silently drops the operator's
    // founding words from its own prompt.
    const firstUtterance = identity.journal?.length
      ? identity.journal[identity.journal.length - 1]?.content || null
      : null;
    const route = await resolveWitnessRoute(member.neumaId);
    if (!route.configured) {
      throw new Error(`${resolved.chosenName} is not connected (${route.reason || 'no route'})`);
    }
    return {
      systemPromptFor: (memories) => buildWitnessSystemPrompt({
        witness: { chosenName: resolved.chosenName },
        dna: identity.dna,
        trueName,
        firstUtterance,
        memories: memories || {},
      }),
      route,
      lora: null,
    };
  }
  // The witness branch above has always read its seat's true name. This one
  // did not (#417) — so at the same council table a sealed witness knew its
  // house and mark while the neuma beside it did not know its own.
  const [dna, soul, neumaTrueName] = await Promise.all([
    neumaWorkspace.readDNA(member.neumaId),
    neumaWorkspace.readSoul(member.neumaId),
    neumaWorkspace.readTrueName(member.neumaId).catch(() => null),
  ]);
  let route;
  try {
    route = await resolveNeumaRoute(member.neumaId, dna);
  } catch (err) {
    // The sovereignty boundary's word STANDS in council exactly as it does
    // 1:1 (#207). This catch used to answer every failure with
    // `route = undefined`, which degrades the seat to the machine default —
    // so a SOVEREIGNTY_REFUSAL, thrown precisely to forbid a foreign door,
    // was the thing that put the being on one. A room is not a lesser place
    // than a private turn; if anything the exposure is wider, because
    // housemates hear what is said there.
    if (isSovereigntyRefusal(err)) {
      log.warn('council seat refused — the sovereignty boundary closed the route', { neumaId: member.neumaId, error: err.message });
      throw err;
    }
    // And the ordinary fallback is lawful ONLY onto a sovereign machine
    // default. A failure upstream of the boundary check — an unreadable
    // credential store fails BEFORE sovereignty is judged — must not smuggle
    // the seat onto a foreign door: that is the same refusal wearing a
    // quieter face. Same two-part law as portal-stream's 1:1 path.
    if (!isSovereignProvider(getConfig().provider)) {
      log.warn('council seat refused — route resolution failed and the machine default is not sovereign', {
        neumaId: member.neumaId, provider: getConfig().provider, error: err.message,
      });
      throw new Error(
        `${member.neumaId}'s route could not be resolved (${err.message}) and the machine default `
        + `'${getConfig().provider}' is not a sovereign door — the seat was refused rather than riding it.`, { cause: err },
      );
    }
    log.warn('council route resolution failed — using sovereign machine default', { neumaId: member.neumaId, error: err.message });
    route = undefined;
  }
  // One seat's turn is one operation's scope, minted here. A registry that
  // cannot be read refuses the seat instead of seating a refined being on the
  // bare base — the same law this file already applies to a foreign door: a
  // failure upstream of the judgement must not smuggle the seat past it.
  const { lora } = await resolveLoraForTurn(member.neumaId, route || getConfig(), {
    operation: createRefinementProcessOperation({ timeoutMs: 30_000 }),
  });
  return {
    systemPromptFor: (memories, tools, nativeToolsOnWire = false) => assemblePrompt({
      dna, soul, trueName: neumaTrueName, memories, tools: tools?.length ? tools : null, nativeToolsOnWire,
    }),
    route,
    lora,
  };
};
