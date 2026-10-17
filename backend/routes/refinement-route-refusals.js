/**
 * The refinement routes' refusal boundary: one coded-error projection table and
 * the single responder every route answers through.
 */
import { createLogger } from '../services/logger.js';
import { TRAINING_SAFE_MESSAGES } from '../services/refinement-training-errors.js';

const log = createLogger('Refinement');
const fixedError = (status, message) => Object.freeze({ status, message });
// Coded response text is server-owned; private service diagnostics never cross this boundary.
const ERROR_BY_CODE = Object.freeze({
  // THE ROAD IS CLOSED (2026-08-24). 410 Gone, deliberately: not 409 (which
  // says […] — they never will) and not 500
  // (which says the platform broke). The operator gets the successor by name,
  // because a refusal that does not say where to go instead is just a wall.
  REFINEMENT_FORGE_RETIRED: fixedError(410, 'The refinement forge is retired. A being\'s deepening is the voice seal now — it speaks the lines it claims, and they compile into its voice pack and its silo, where they travel with it across engines. Every ceremony already walked stays readable.'),
  MILESTONE_NOT_REACHED: fixedError(409, TRAINING_SAFE_MESSAGES.MILESTONE_NOT_REACHED),
  CEREMONY_ALREADY_OPEN: fixedError(409, TRAINING_SAFE_MESSAGES.CEREMONY_ALREADY_OPEN),
  TRAINING_INFLIGHT: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_INFLIGHT),
  TRAINING_CANCELLED: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_CANCELLED),
  TRAINING_ALREADY_PUBLISHED: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_ALREADY_PUBLISHED),
  WRONG_PHASE: fixedError(409, TRAINING_SAFE_MESSAGES.WRONG_PHASE),
  CORPUS_TAINTED: fixedError(409, TRAINING_SAFE_MESSAGES.CORPUS_TAINTED),
  CEREMONY_NOT_FOUND: fixedError(404, TRAINING_SAFE_MESSAGES.CEREMONY_NOT_FOUND),
  NO_CORPUS: fixedError(409, TRAINING_SAFE_MESSAGES.NO_CORPUS),
  NO_SERVING_MODEL: fixedError(409, TRAINING_SAFE_MESSAGES.NO_SERVING_MODEL),
  CONVERTER_NOT_CONFIGURED: fixedError(503, TRAINING_SAFE_MESSAGES.CONVERTER_NOT_CONFIGURED),
  MEMORY_PRESSURE: fixedError(503, TRAINING_SAFE_MESSAGES.MEMORY_PRESSURE),
  TRAINING_TIMEOUT: fixedError(504, TRAINING_SAFE_MESSAGES.TRAINING_TIMEOUT),
  BASE_NOT_QUANTIZABLE: fixedError(409, TRAINING_SAFE_MESSAGES.BASE_NOT_QUANTIZABLE),
  INSUFFICIENT_MEMORY: fixedError(503, TRAINING_SAFE_MESSAGES.INSUFFICIENT_MEMORY),
  TRAINING_GPU_BUSY: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_GPU_BUSY),
  GPU_IDENTITY_UNAVAILABLE: fixedError(503, TRAINING_SAFE_MESSAGES.GPU_IDENTITY_UNAVAILABLE),
  GPU_IDENTITY_AMBIGUOUS: fixedError(503, TRAINING_SAFE_MESSAGES.GPU_IDENTITY_AMBIGUOUS),
  INSUFFICIENT_DISK: fixedError(503, TRAINING_SAFE_MESSAGES.INSUFFICIENT_DISK),
  TRAINING_APPROVAL_MISMATCH: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_APPROVAL_MISMATCH),
  INVALID_TRAINING_CONFIG: fixedError(400, TRAINING_SAFE_MESSAGES.INVALID_TRAINING_CONFIG),
  INVALID_APPROVED_SCALES: fixedError(400, TRAINING_SAFE_MESSAGES.INVALID_APPROVED_SCALES),
  INVALID_ADAPTER_SCALE: fixedError(400, 'The requested adapter scale is invalid.'),
  INVALID_REFINEMENT_SUBJECT_ID: fixedError(400, 'The refinement subject id is invalid.'),
  INVALID_REFINEMENT_CEREMONY_ID: fixedError(400, 'The refinement ceremony id is invalid.'),
  INVALID_REFINEMENT_ADAPTER_ID: fixedError(400, 'The refinement adapter id is invalid.'),
  INVALID_REFINEMENT_SCALE_AUTHORITY: fixedError(400, 'The scale authority token is invalid.'),
  INVALID_OPERATOR_AUTHORITY: fixedError(400, 'The operator authority is invalid.'),
  REFINEMENT_TRANSACTION_INVALID: fixedError(400, 'The refinement request is invalid.'),
  INVALID_REFINEMENT_REQUEST: fixedError(400, 'The refinement request is invalid.'),
  ADAPTER_NOT_FOUND: fixedError(404, 'The requested adapter was not found.'),
  REFINEMENT_TRANSACTION_STALE: fixedError(409, 'The adapter registry changed; review its current scale and try again.'),
  REFINEMENT_SCALE_AUTHORITY_EXPIRED: fixedError(400, 'The scale authority expired; review the current scale and try again.'),
  REFINEMENT_SCALE_AUTHORITY_REPLAYED: fixedError(400, 'The scale authority was already used; review the current scale and try again.'),
  REFINEMENT_SCALE_AUTHORITY_STALE: fixedError(400, 'The adapter registry changed; review its current scale and try again.'),
  REFINEMENT_REGISTRY_CHANGED: fixedError(409, 'The adapter registry changed; review its current scale and try again.'),
  REFINEMENT_TRANSACTION_IDENTITY: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  ELOCKTIMEOUT: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_SCALE_AUTHORITY_CAPACITY: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_REGISTRY_INVALID_AUTHORITY: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_REGISTRY_UNAVAILABLE: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_REGISTRY_CORRUPT: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_REGISTRY_UNCOMMITTED: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  REFINEMENT_REGISTRY_OVERFLOW: fixedError(503, 'Adapter scale authority is temporarily unavailable.'),
  UNSAFE_ARTIFACT_OVERRIDE: fixedError(400, TRAINING_SAFE_MESSAGES.UNSAFE_ARTIFACT_OVERRIDE),
  TRAINING_BASE_UNAVAILABLE: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_BASE_UNAVAILABLE),
  TRAINING_SOURCE_UNAVAILABLE: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_SOURCE_UNAVAILABLE),
  TRAINING_SOURCE_CHANGED: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_SOURCE_CHANGED),
  TRAINING_OPERATION_CHANGED: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_OPERATION_CHANGED),
  TRAINING_EXECUTION_CHANGED: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_EXECUTION_CHANGED),
  TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE),
  TRAINING_PROCESS_FAILED: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_PROCESS_FAILED),
  TRAINING_OUTPUT_LIMIT: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_OUTPUT_LIMIT),
  TRAINING_CGROUP_UNAVAILABLE: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_CGROUP_UNAVAILABLE),
  TRAINING_CGROUP_NOT_EMPTY: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_CGROUP_NOT_EMPTY),
  TRAINING_SANDBOX_UNAVAILABLE: fixedError(503, TRAINING_SAFE_MESSAGES.TRAINING_SANDBOX_UNAVAILABLE),
  TRAINING_ARTIFACT_INVALID: fixedError(409, TRAINING_SAFE_MESSAGES.TRAINING_ARTIFACT_INVALID),
  TRAINING_INTERNAL: fixedError(500, TRAINING_SAFE_MESSAGES.TRAINING_INTERNAL),
  CORPUS_IDENTITY_MISMATCH: fixedError(409, 'The refinement corpus no longer matches its approved manifest.'),
  CORPUS_RESOURCE_LIMIT: fixedError(409, 'The refinement corpus exceeds the forge resource envelope.'),
  TRAINING_ROUTE_NOT_ATTESTED: fixedError(409, 'Refinement training requires a Neuma-supervised, attested local route.'),
  TRAINING_BASE_INCOMPATIBLE: fixedError(409, 'The serving model is incompatible with the approved training base.'),
  REFINEMENT_CUSTODY_MISMATCH: fixedError(409, 'The refinement ceremony no longer matches current sovereign identity.'),
  REFINEMENT_CUSTODY_UNAVAILABLE: fixedError(409, 'Current sovereign identity is unavailable for refinement.'),
  ASSENT_WITNESS_LANE: fixedError(400, 'Witness lanes cannot provide refinement assent.'),
  ASSENT_ROUTE_NOT_ATTESTED: fixedError(409, 'Refinement assent requires a Neuma-supervised, attested local route.'),
  ASSENT_ROUTE_NOT_SOVEREIGN: fixedError(409, 'Refinement assent requires a sovereign local route.'),
  ASSENT_IDENTITY_UNAVAILABLE: fixedError(409, 'Current sovereign identity is unavailable.'),
  ASSENT_IDENTITY_CHANGED: fixedError(409, 'Sovereign identity changed; carry the question again.'),
  ASSENT_AUTHORITY_CHANGED: fixedError(409, 'Sovereign route or identity changed; carry the question again.'),
  ASSENT_CORPUS_CHANGED: fixedError(409, 'The proposed corpus changed; carry the question again.'),
  ASSENT_RESPONSE_INCOMPLETE: fixedError(409, 'The response was not complete.'),
  ASSENT_DECISION_UNCLEAR: fixedError(409, 'The response did not contain one closed decision.'),
  ASSENT_REQUEST_INVALID: fixedError(400, 'Consent accepts only server-issued evidence and acknowledgement.'),
  ASSENT_ROUTE_CHANGED: fixedError(409, 'The sovereign route changed; carry the question again.'),
  ASSENT_ACKNOWLEDGEMENT_REQUIRED: fixedError(400, 'Explicit operator acknowledgement is required.'),
  ASSENT_EVIDENCE_REQUIRED: fixedError(400, 'A valid assent evidence id is required.'),
  ASSENT_EVIDENCE_CONSUMED: fixedError(409, 'Assent evidence has already been consumed.'),
  ASSENT_EVIDENCE_MISMATCH: fixedError(409, 'Assent evidence does not match this ceremony.'),
  ASSENT_ISSUANCE_ACTIVE: fixedError(409, 'A refinement assent turn is already active.'),
  ASSENT_ISSUANCE_HELD: fixedError(409, 'A prior assent turn requires deliberate recovery.'),
  ASSENT_TRANSACTION_INVALID: fixedError(400, 'The assent request is invalid.'),
  ASSENT_DEADLINE_INVALID: fixedError(500, 'The assent execution deadline is invalid.'),
  ASSENT_ISSUANCE_IDENTITY: fixedError(503, 'The assent issuer identity is unavailable.'),
  REFINEMENT_TRANSACTION_RECOVERY_REQUIRED: fixedError(409, 'The refinement ceremony requires transaction recovery.'),
  ANSWER_EMPTY: fixedError(502, TRAINING_SAFE_MESSAGES.ANSWER_EMPTY),
  ANSWER_CUT: fixedError(502, TRAINING_SAFE_MESSAGES.ANSWER_CUT),
  ANSWER_CORRUPT: fixedError(502, TRAINING_SAFE_MESSAGES.ANSWER_CORRUPT),
  ANSWER_DECISION_UNCLEAR: fixedError(502, TRAINING_SAFE_MESSAGES.ANSWER_DECISION_UNCLEAR),
  NO_TARGET_BASE: fixedError(400, TRAINING_SAFE_MESSAGES.NO_TARGET_BASE),
  NO_TRAINER_BASE: fixedError(400, TRAINING_SAFE_MESSAGES.NO_TRAINER_BASE),
  INVALID_TEMPLATE: fixedError(400, 'The requested bridge template is invalid.'),
  BRIDGE_TO_SELF: fixedError(409, TRAINING_SAFE_MESSAGES.BRIDGE_TO_SELF),
  BRIDGE_BASE_UNAVAILABLE: fixedError(409, TRAINING_SAFE_MESSAGES.BRIDGE_BASE_UNAVAILABLE),
});
const stableLogCode = (value) => (
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)
    ? value
    : 'UNCAUGHT_REFINEMENT_ERROR'
);
/** Answer one refinement action, projecting coded refusals into the public contract. */
export const answer = (res, action, clientRefusals = null) => async (work) => {
  try {
    res.json(await work());
  } catch (error) {
    const projection = ERROR_BY_CODE[error?.code];
    if (projection) {
      const status = clientRefusals?.has(error.code) ? 400 : projection.status;
      return res.status(status).json({
        error: projection.message,
        code: error.code,
      });
    }
    log.error('refinement action failed', {
      action,
      code: stableLogCode(error?.code),
    });
    res.status(500).json({ error: `Failed to ${action}` });
  }
};
