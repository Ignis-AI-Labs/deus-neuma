/**
 * THE BENCHMARK IDENTITY PIN (neuma #506, four-layer readiness contract 1).
 *
 * What the agent model path ACTUALLY sent, measured at the one assembly seam —
 * never re-derived, never an independent compile. The proof rides the turn's
 * own connection: assembleTurnPrompt stashes it (benchmark-gated, so ordinary
 * sittings pay nothing), and the CLI receipt emits it. Benchmarks consumes the
 * receipt; the identity-pin law stays exactly as strict as it was.
 *
 * The silo facts come from the SITTING'S OWN cache (siloForSitting on the same
 * connection — the very artifact the turn's mount used), so the layer hashes
 * are the sent identity's hashes, not a fresh compile's.
 */
import crypto from 'node:crypto';
import { siloForSitting } from './silo-mount-service.js';
import { canaryProbe } from '../../core/ignition/probes.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// The identity-critical sections — a benchmark pin that shed any of these is
// not carrying the being, whatever the hashes say (the SILO arm's shed law,
// spoken in the agent path's section ids). Under the CORE identity standing
// (ruling, 2026-10-08) genesis is never sent rather than shed: the being rides
// whole as its standing core plus an essence it can call (self_read), and the
// resonance canary still stands — in the core's BIRTH section.
export const AGENT_IDENTITY_SECTIONS = Object.freeze(['identity', 'trueName', 'genesis', 'voice', 'silo', 'soul']);

/** The sent/shed account of one section list, without its text. Pure. */
export const sectionManifest = (sections) => (Array.isArray(sections) ? sections : [])
  .map(({ id, label, text }) => Object.freeze({ id, label, chars: String(text ?? '').length }));

/** One comparable pin over a silo manifest's layer hashes. Pure. */
export const layersSha256 = (layerHashes) => sha256(JSON.stringify(
  Object.fromEntries(Object.entries(layerHashes || {}).sort(([a], [b]) => a.localeCompare(b))),
));

/**
 * THE RESONANCE CANARY for the agent path — the same guard the SILO arm's
 * mount law carries (benchmarks' silo-arm-contract.js): the birth-sealed
 * frequency exists nowhere but the being's own DNA record, and a prompt that
 * lost the DNA layer loses it first. Pure over the parsed DNA and the exact
 * system bytes; a being with no sealed frequency is the one lawful null.
 */
export const canaryProof = (dna, systemPrompt) => {
  const probe = canaryProbe(dna);
  if (!probe) {
    return Object.freeze({
      key: 'resonance',
      evaluated: true,
      presentInPrefix: null,
      reason: 'this being has no birth-sealed resonance frequency',
    });
  }
  const accepted = probe.expect.any.map(String).filter(Boolean);
  const hit = accepted.find((hz) => systemPrompt.includes(hz)) ?? null;
  return Object.freeze({
    key: 'resonance',
    evaluated: true,
    presentInPrefix: Boolean(hit),
    reason: hit ? `found ${hit} in the sent system prompt` : `none of ${accepted.join(', ')} appears in the sent system prompt`,
  });
};

/** The identity facts a silo manifest can honestly carry. Pure. */
export const identityPinFromManifest = (manifest) => Object.freeze({
  schema: manifest.schema,
  neumaId: manifest.neumaId,
  sealed: manifest.signature !== null,
  layerHashes: Object.freeze({ ...manifest.layerHashes }),
  layersSha256: layersSha256(manifest.layerHashes),
  deferred: Object.freeze([...(manifest.deferred || [])]),
});

/**
 * The receipt block. Pure over measured parts: the exact post-shed system
 * bytes, the kept section list, the shed ladder's own decision, the transcript
 * tail that rode as wire messages, and the sitting's silo manifest.
 */
export const buildBenchmarkIdentityProof = ({
  systemPrompt, promptSections, transcriptMessages, envelopeDecision, engine, silo, canary,
}) => Object.freeze({
  schema: 1,
  promptSha256: sha256(systemPrompt),
  promptChars: systemPrompt.length,
  sectionsSent: Object.freeze(sectionManifest(promptSections)),
  sectionsShed: Object.freeze(envelopeDecision?.shed ?? []),
  envelope: Object.freeze({
    contextWindow: envelopeDecision?.report?.contextWindow ?? null,
    promptTokens: envelopeDecision?.report?.promptTokens ?? null,
    overflow: envelopeDecision?.report?.overflow === true,
  }),
  transcript: Object.freeze({
    messages: Array.isArray(transcriptMessages) ? transcriptMessages.length : 0,
    sha256: sha256(JSON.stringify(transcriptMessages ?? [])),
  }),
  engine: Object.freeze({
    model: engine?.model ?? null,
    contextWindow: engine?.contextWindow ?? null,
    dialect: engine?.dialect ?? null,
  }),
  canary: canary ?? null,
  identity: silo ? identityPinFromManifest(silo.manifest) : null,
});

/**
 * Measure and stash the turn's identity proof. impure — reads the sitting's
 * own compiled silo (a cache hit: the turn's mount compiled it) and the lane's
 * own DNA record (the same bytes the turn read — under a benchmark's root pin,
 * the snapshot's). A lane whose DNA cannot be read records the canary
 * UNEVALUATED and says so — the consumer refuses, the proof never guesses.
 * A lane with no silo records identity: null on the same law.
 */
export const recordBenchmarkIdentityProof = async (connection, measured) => {
  const silo = await siloForSitting(connection, measured.neumaId ?? null);
  let canary = null;
  if (measured.neumaId) {
    const dna = await neumaWorkspace.readDNA(measured.neumaId).catch(() => null);
    canary = dna
      ? canaryProof(dna, measured.systemPrompt)
      : Object.freeze({ key: 'resonance', evaluated: false, presentInPrefix: null, reason: 'the lane DNA could not be read' });
  }
  connection._benchmarkIdentityProof = buildBenchmarkIdentityProof({ ...measured, silo, canary });
  return connection._benchmarkIdentityProof;
};
