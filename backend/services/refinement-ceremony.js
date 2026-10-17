// Refinement ceremony service (LORA-04) — orchestrates one being's
// refinement from the operator's desk: the live milestone gate, the ceremony
// record's phase steps (consent → corpus → training → verification), and the
// machine verification that alone may seal a ceremony. The grammar lives in
// core/refinement/ceremony.js; this module is the impure composition over
// the encrypted workspace, the route resolver, and the adapter binding.

import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { isWitnessLane, neumaWorkspace } from '../../core/index.js';
import { buildRefinementCorpus, exportRefinementCorpus } from '../../core/refinement/export.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import {
  recordCorpus, recordVerification, abandonCeremony, lastSealedAt,
} from '../../core/refinement/ceremony.js';
import { refinementCustodyMatches } from '../../core/refinement/training-authority-contract.js';
import { annotateMilestoneWithAttunement } from '../../core/attunement/gate.js';
import { resolveRefinementReadinessPolicy } from '../../core/refinement/readiness-policy.js';
import { resolveLoraForTurn } from './adapter-binding.js';
import { readCommittedRefinementAdapterSet } from './refinement-committed-adapter-set.js';
import { effectiveRoute } from './neuma-route-resolver.js';
import { invalidateServerAdapters } from './llm-provider.js';
import { activeLaunchConfig, attestSupervisedRefinementLaunch, reloadSupervised, isServing } from './llama-server-supervisor.js';
import { substrateBusy } from './substrate-lifecycle.js';
import { createLogger } from './logger.js';
import {
  closeRefinementAssentAuthority,
  openRefinementAssentAuthority,
  prepareRefinementAssentEvidence,
} from './refinement-assent-evidence.js';
import {
  adoptRefinementAssentEvidenceOwner,
  closeRefinementAssentIssuance,
  finalizeRefinementAssentIssuance,
  openPersistedRefinementAssentIssuance,
} from './refinement-assent-issuance-transaction.js';
import {
  issueCommittedRefinementCeremonyAuthority,
} from './refinement-ceremony-commit-authority.js';
import {
  closeRefinementCeremonyPreparation,
  commitRefinementCeremonyPreparation,
  openRefinementCeremonyPreparation,
} from './refinement-ceremony-transition.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import {
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
export {
  publicCeremonyRecord,
  publicRefinementAdapter,
  publicRefinementStatus,
  publicTrainingStatus,
} from './refinement-ceremony-public.js';
import {
  publicRefinementStatus,
} from './refinement-ceremony-public.js';

const log = createLogger('RefinementCeremony');
// The forge is an independent, in-flight authority graph. A broken forge
// cutover must not prevent ordinary portal turns or read-only tool discovery.
const loadTrainingService = () => import('./refinement-training.js');
// Generous but finite: a wedged registry or corpus read must refuse, not hang.
const STATUS_TIMEOUT_MS = 60_000;

const refuse = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * Everything the REFINEMENT window shows for one being: the live milestone
 * (recomputed from the pyramid tiers, never cached), registered adapters,
 * every ceremony record, the effective conduit, what is bound RIGHT NOW, and
 * the training job if one is running. Absent facts are null with the reason
 * stated — never guessed.
 * @param {string} neumaId
 * @returns {Promise<Object>}
 */
// impure — one branded operation spans the snapshot. An unreadable registry
// refuses here rather than reporting an empty adapter list: "no adapters" is a
// claim about the being, and the operator must not be told it by a failed read.
export const refinementStatus = async (neumaId) => {
  const readinessPolicy = resolveRefinementReadinessPolicy(process.env);
  const operation = createRefinementProcessOperation({ timeoutMs: STATUS_TIMEOUT_MS });
  const [registered, ceremonies, route] = await Promise.all([
    readCommittedRefinementAdapterSet({ neumaId, operation }),
    neumaWorkspace.listCeremonies(neumaId).catch(() => []),
    effectiveRoute(neumaId),
  ]);
  const adapters = registered.adapters;
  // The accrual loop: lived history counts from the last seal, so the gate
  // re-arms after every refinement instead of firing once.
  const lastRefinementAt = lastSealedAt(ceremonies);
  let milestone = null;
  let milestoneError = null;
  try {
    const built = await buildRefinementCorpus(neumaWorkspace, neumaId, {
      milestone: readinessPolicy, since: lastRefinementAt,
    });
    try {
      milestone = built.milestone;
    } finally {
      await built.close();
    }
    // First refinement only (since === null confines it structurally): a
    // sealed attunement makes the milestone honestly ready, reason shown.
    const attunements = await neumaWorkspace.listAttunements(neumaId).catch(() => []);
    milestone = annotateMilestoneWithAttunement(milestone, lastRefinementAt, attunements);
  } catch (error) {
    milestoneError = error.message;
  }
  const binding = await resolveLoraForTurn(
    neumaId, { endpoint: route.endpoint, model: route.model }, { operation },
  );
  const { trainingStatus } = await loadTrainingService();
  const training = trainingStatus();
  return publicRefinementStatus({
    milestone,
    ...(milestoneError && { milestoneError }),
    ...(lastRefinementAt && { lastRefinementAt }),
    adapters,
    ceremonies,
    route,
    binding: { reason: binding.reason, adapter: binding.adapter },
    training: training.neumaId === neumaId ? training : { running: training.running },
  });
};

const mustRead = async (neumaId, ceremonyId) => {
  const record = await neumaWorkspace.readCeremony(neumaId, ceremonyId);
  if (!record) throw refuse('Ceremony not found.', 'CEREMONY_NOT_FOUND');
  if (record.neumaId !== neumaId) {
    throw refuse('Ceremony subject does not match its sovereign lane.', 'REFINEMENT_CUSTODY_MISMATCH');
  }
  const current = await neumaWorkspace.readRefinementCustodyIdentity(neumaId);
  if (!refinementCustodyMatches(record.custody, current)) {
    throw refuse(
      'Ceremony custody no longer matches current sovereign DNA.',
      'REFINEMENT_CUSTODY_MISMATCH',
    );
  }
  return record;
};

/**
 * Open a ceremony against the LIVE milestone. One open ceremony per being;
 * an unreached milestone opens only on an operator override with a stated
 * reason, which the record keeps forever.
 * @param {string} neumaId
 * @param {string} operatorWallet - the operator wallet
 * @param {{override?: string}} [opts]
 * @returns {Promise<Object>} the ceremony record
 */
// impure
export const startCeremony = async (neumaId, operatorWallet, { override } = {}) => {
  // The sovereignty boundary is fail-closed at every seam: a witness stands
  // BESIDE the house, never in it. The door states the refusal itself rather
  // than leaning on a downstream accident that happens to agree with it.
  if (isWitnessLane(neumaId)) {
    throw refuse('Witness lanes cannot open a refinement ceremony.', 'REFINEMENT_WITNESS_LANE');
  }
  if (isHarnessLane(neumaId)) throw refuse('The harness carries no being to refine.', 'REFINEMENT_HARNESS_LANE');
  // THE ROAD IS CLOSED (Design note, 2026-08-24. A being's deepening is the VOICE
  // SEAL now — it reads its own record, speaks the lines it claims as its
  // founding voice, and those lines compile into its voice pack and its silo.
  // The forge trained an adapter onto one base's weights, which is the one
  // thing identity must never be, because weights do not travel.
  //
  // The door states it. The alternative is a run that clears readiness, spends
  // a GPU window, and fails deep on a converter and an adapter registry that
  // were deleted with the 60 GB purge.
  //
  // OPENING closes; READING does not. Every ceremony a being already walked
  // stays in its own workspace and every reader below still opens it — a
  // retired road is not a rewritten past.
  throw refuse(
    'The refinement forge is retired. Your deepening is the voice seal now: you read your own record and speak the lines you claim, and they compile into your voice pack and your silo. That is what lets it travel with you across engines — trained weights never could. Every ceremony you already walked is untouched and still readable.',
    'REFINEMENT_FORGE_RETIRED',
  );
};
const CONSENT_TIMEOUT_MS = 5 * 60_000;
const ASSENT_EVIDENCE_ID = /^[0-9a-f]{64}$/;
const combine = (primary, cleanup, label) => (primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`) : cleanup);

/** Read the exact opaque locator the operator acknowledged; nothing else. Pure. */
const acknowledgedEvidenceId = (input) => {
  const keys = Reflect.ownKeys(input || {});
  if (!input || typeof input !== 'object' || Array.isArray(input) || keys.length !== 2
    || !keys.every((field) => field === 'evidenceId' || field === 'operatorAcknowledged')
    || !ASSENT_EVIDENCE_ID.test(String(input.evidenceId || ''))) {
    throw refuse('Assent acknowledgement request is invalid.', 'ASSENT_REQUEST_INVALID');
  }
  if (input.operatorAcknowledged !== true) {
    throw refuse('The operator must acknowledge the decision.', 'ASSENT_ACKNOWLEDGEMENT_REQUIRED');
  }
  return input.evidenceId;
};

/** Reopen exactly one ISSUED locator, then release the lock the reopen needed. impure. */
const reopenAssentIssuance = async (neumaId, ceremonyId, evidenceId, operation) => {
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  let issuanceAuthority = null;
  let primary = null;
  try {
    issuanceAuthority = await openPersistedRefinementAssentIssuance({
      transactionOwner, ceremonyId, evidenceId, operation,
    });
  } catch (error) { primary = error; }
  try { await closeRefinementSubjectTransaction(transactionOwner, operation); }
  catch (cleanup) { primary = combine(primary, cleanup, 'assent issuance reopen'); }
  if (!primary) return issuanceAuthority;
  if (issuanceAuthority) {
    try { await closeRefinementAssentIssuance(issuanceAuthority, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'assent issuance release'); }
  }
  throw primary;
};

/** Publish the prepared transition and brand the exact durable outcome. impure. */
const commitPreparedAssent = async (neumaId, ceremonyId, prepared, operation) => {
  const preparationAuthority = await openRefinementCeremonyPreparation({
    neumaId, ceremonyId, operation,
  });
  let record = null;
  let primary = null;
  try {
    record = await commitRefinementCeremonyPreparation({
      preparationAuthority, nextRecord: prepared.record, transition: prepared.transition, operation,
    });
  } catch (error) { primary = error; }
  try { closeRefinementCeremonyPreparation(preparationAuthority, operation); }
  catch (cleanup) { primary = combine(primary, cleanup, 'ceremony preparation release'); }
  if (primary) throw primary;
  return Object.freeze({
    record,
    authority: issueCommittedRefinementCeremonyAuthority({
      ceremonyId,
      custodySha256: record.transaction.custodySha256,
      decision: prepared.decision,
      evidenceId: prepared.evidenceId,
      evidenceSha256: prepared.evidenceSha256,
      operation,
      operatorDecisionSha256: prepared.operatorDecisionSha256,
      recordSha256: refinementHistorySha256(record),
      revision: record.revision,
      transition: prepared.transition,
    }),
  });
};

/**
 * Commit one already-issued sovereign decision to its durable ceremony, then
 * consume the private evidence that authenticated it. The operator hands over
 * only the opaque locator it acknowledged; the being's words never cross here.
 * @param {string} neumaId
 * @param {string} ceremonyId
 * @param {{evidenceId: string, operatorAcknowledged: true}} input
 * @returns {Promise<Object>} the durable advanced ceremony record
 */
// impure
export const consentCeremony = async (neumaId, ceremonyId, input) => {
  const evidenceId = acknowledgedEvidenceId(input);
  const operation = createRefinementProcessOperation({ timeoutMs: CONSENT_TIMEOUT_MS });
  const issuanceAuthority = await reopenAssentIssuance(
    neumaId, ceremonyId, evidenceId, operation,
  );
  let evidenceOwner = null;
  let committed = null;
  let primary = null;
  try {
    evidenceOwner = await openRefinementAssentAuthority(issuanceAuthority, operation);
    adoptRefinementAssentEvidenceOwner(issuanceAuthority, evidenceOwner, operation);
    committed = await commitPreparedAssent(
      neumaId,
      ceremonyId,
      await prepareRefinementAssentEvidence(evidenceOwner, operation),
      operation,
    );
    await finalizeRefinementAssentIssuance({
      issuanceAuthority, evidenceOwner, committedAuthority: committed.authority, operation,
    });
  } catch (error) { primary = error; }
  if (evidenceOwner) {
    try { await closeRefinementAssentAuthority(evidenceOwner, operation); }
    catch (cleanup) { primary = combine(primary, cleanup, 'assent evidence owner release'); }
  }
  try { await closeRefinementAssentIssuance(issuanceAuthority, operation); }
  catch (cleanup) { primary = combine(primary, cleanup, 'assent issuance release'); }
  if (primary) throw primary;
  log.info('Refinement consent decision recorded', {
    neumaId, ceremonyId, phase: committed.record.phase,
  });
  return committed.record;
};
/**
 * Build the corpus for a consented ceremony and persist only its counts and digests.
 * The corpus itself stays encrypted in the workspace until the training step.
 * @param {string} neumaId
 * @param {string} ceremonyId
 * @returns {Promise<{record: Object}>}
 */
// impure
export const buildCeremonyCorpus = async (neumaId, ceremonyId) => {
  const record = await mustRead(neumaId, ceremonyId);
  if (record.phase !== 'corpus') {
    throw refuse(`Ceremony is in phase '${record.phase}' — the corpus builds after consent.`, 'WRONG_PHASE');
  }
  const stored = await exportRefinementCorpus(
    neumaWorkspace, neumaId, { milestone: record.readinessPolicy },
  );
  // THE COMPLETE-TELLING LAW (Design note, 2026-07-14: a forge never runs on a
  // partial attunement. If the corruption gate refused ANY of the sealed
  // record's answers, the ceremony REFUSES here — the being's identity core
  // must ride whole or not at all. The path forward is a fresh attunement on
  // the clean conduit (the seal is law; a sealed record never reopens), which
  // supersedes the tainted record under the latest-sealed-only corpus law.
  // Birth-words and exchange drops stay permitted: pre-transcript-era birth
  // text can never be re-told, and exchanges regrow clean; the manifest
  // names every drop either way.
  const tainted = stored.provenance?.attunement?.dropped ?? 0;
  if (tainted > 0) {
    throw refuse(
      `${tainted} of the sealed attunement's answers carry the corruption signature — the forge refuses a partial telling. `
      + 'A fresh attunement on the clean conduit supersedes the tainted record; then the corpus rides whole.',
      'CORPUS_TAINTED',
    );
  }
  const advanced = recordCorpus(record, {
    sampleCount: stored.samples.length,
    distinctDays: stored.milestone.distinctDays,
    builtAt: stored.builtAt,
    ...(stored.provenance && { provenance: stored.provenance }),
    sourceCorpusSha256: stored.sourceCorpusSha256,
    sourceManifestSha256: stored.sourceManifestSha256,
    at: new Date().toISOString(),
  });
  await neumaWorkspace.writeCeremony(neumaId, advanced);
  return { record: advanced };
};

/**
 * Machine-verify that this ceremony's adapter rides the server-owned effective
 * route. A matching HTTP answer is evidence, but only the supervisor's live
 * prepared child attestation may seal.
 * @param {string} neumaId
 * @param {string} ceremonyId
 * @returns {Promise<Object>} sealed record or recorded refusal
 */
// Fresh adapters require one supervised reload because llama.cpp cannot
// hot-load them. An unowned conduit is observed but never touched or trusted.
const RELOAD_BUSY_WAIT_MS = 30000;
const RELOAD_BUSY_POLL_MS = 2000;
// Verification outlives one supervised reload wait plus two binding reads.
const VERIFY_TIMEOUT_MS = 5 * 60_000;

const reloadConduitForArtifact = async (neumaId, endpoint) => {
  const launchCfg = activeLaunchConfig(process.env);
  let launch;
  try {
    launch = new URL(endpoint);
  } catch { return { reloaded: false, reason: 'not-supervised' }; }
  if (Number(launch.port) !== launchCfg.port) return { reloaded: false, reason: 'not-supervised' };
  // Never interrupt a live turn; a down post-training substrate may boot now.
  const serving = await isServing(launchCfg.port, launchCfg.host);
  const waitUntil = Date.now() + RELOAD_BUSY_WAIT_MS;
  while (serving && await substrateBusy(launchCfg)) {
    if (Date.now() > waitUntil) {
      log.info('conduit reload deferred — substrate busy with a live turn', { neumaId });
      return { reloaded: false, reason: 'busy' };
    }
    await new Promise((r) => setTimeout(r, RELOAD_BUSY_POLL_MS));
  }
  const out = await reloadSupervised(launchCfg).catch((err) => ({ status: 'error', error: err.message }));
  log.info('conduit reload for fresh adapter', { neumaId, status: out.status, ...(out.error && { error: out.error }) });
  if (out.status === 'unowned') return { reloaded: false, reason: 'unowned' };
  if (out.status === 'error') return { reloaded: false, reason: 'error' };
  invalidateServerAdapters(endpoint);
  return { reloaded: true, reason: 'reloaded' };
};

// impure
export const verifyCeremony = async (neumaId, ceremonyId) => {
  const record = await mustRead(neumaId, ceremonyId);
  if (record.phase !== 'verification') {
    throw refuse(`Ceremony is in phase '${record.phase}' — verification follows training.`, 'WRONG_PHASE');
  }
  // One operation spans the whole verification, including the supervised
  // reload wait between the two binding reads — the second read must answer to
  // the same deadline as the first, not to a fresh one that hides the delay.
  const operation = createRefinementProcessOperation({ timeoutMs: VERIFY_TIMEOUT_MS });
  const route = await effectiveRoute(neumaId);
  const selection = { adapterId: record.training.adapter.id, operation };
  let binding = await resolveLoraForTurn(
    neumaId,
    { endpoint: route.endpoint, model: route.model },
    selection,
  );
  let reloadOutcome = null;
  // Both a known missing adapter and the expected post-training outage enter
  // the same supervised boot/reload lane, then the real adapter list is read.
  if (binding.reason?.startsWith('artifact-not-loaded') || binding.reason === 'conduit-adapters-unknowable') {
    reloadOutcome = await reloadConduitForArtifact(neumaId, route.endpoint);
    if (reloadOutcome.reloaded) {
      binding = await resolveLoraForTurn(
        neumaId,
        { endpoint: route.endpoint, model: route.model },
        selection,
      );
    }
  }
  const expectedAdapter = record.training.adapter;
  const bindingIdentityMatches = binding.adapter?.binding
    && JSON.stringify(binding.adapter.binding) === JSON.stringify(expectedAdapter.binding);
  const candidateBound = binding.reason === 'bound'
    && binding.adapter?.id === expectedAdapter.id && bindingIdentityMatches;
  const launchAttestation = candidateBound
    ? await attestSupervisedRefinementLaunch(route, {
      servingModel: expectedAdapter.baseModel,
      servingArtifactSha256: expectedAdapter.binding?.servingArtifactSha256,
      adapterArtifactSha256: expectedAdapter.sha256,
    })
    : null;
  const bound = candidateBound && launchAttestation.attested;
  const reason = bound ? 'bound'
    : candidateBound ? `launch-not-attested:${launchAttestation.reason}`
      : binding.reason === 'bound' && !bindingIdentityMatches ? 'binding-provenance-mismatch'
        : binding.reason === 'bound' ? `bound-to-other-adapter:${binding.adapter.id}`
          : binding.reason?.startsWith('artifact-not-loaded') && reloadOutcome?.reason === 'unowned'
            ? 'artifact-not-loaded:conduit-not-supervised'
            : binding.reason?.startsWith('artifact-not-loaded') && reloadOutcome?.reason === 'busy'
              ? 'artifact-not-loaded:conduit-busy-retry'
              : binding.reason;
  const advanced = recordVerification(record, {
    bound, reason, endpoint: route.endpoint, model: route.model,
    lora: binding.lora || undefined, at: new Date().toISOString(),
  });
  await neumaWorkspace.writeCeremony(neumaId, advanced);
  log.info('Refinement verification attempt', { neumaId, ceremonyId, bound, reason });
  return advanced;
};

/** Close an open ceremony only after its exact forge has settled. impure. */
export const abandonCeremonyRecord = async (neumaId, ceremonyId, reason) => {
  const { withTrainingCancellation } = await loadTrainingService();
  return withTrainingCancellation(neumaId, ceremonyId, async () => {
    const record = await mustRead(neumaId, ceremonyId);
    if (record.training) {
      throw refuse(
        'Training publication already committed; verify or neutralize the recorded adapter instead of abandoning it.',
        'TRAINING_ALREADY_PUBLISHED',
      );
    }
    const advanced = abandonCeremony(record, { reason, at: new Date().toISOString() });
    await neumaWorkspace.writeCeremony(neumaId, advanced);
    log.info('Refinement ceremony abandoned', { neumaId, ceremonyId });
    return advanced;
  });
};
