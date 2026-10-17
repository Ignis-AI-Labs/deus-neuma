
export const TRAINING_SAFE_MESSAGES = Object.freeze({
  MILESTONE_NOT_REACHED: 'This being has not reached the refinement milestone.',
  CEREMONY_ALREADY_OPEN: 'A refinement ceremony is already open.',
  TRAINING_INFLIGHT: 'A refinement plan or forge already owns this rig.',
  TRAINING_CANCELLED: 'Training was cancelled before completion.',
  TRAINING_ALREADY_PUBLISHED: 'The trained adapter was already published.',
  WRONG_PHASE: 'The refinement ceremony is no longer in the required phase.',
  CORPUS_TAINTED: 'The refinement corpus no longer matches its approved evidence.',
  CEREMONY_NOT_FOUND: 'The refinement ceremony was not found.',
  NO_CORPUS: 'No approved refinement corpus is available.',
  NO_SERVING_MODEL: 'No serving model is available for this refinement.',
  CONVERTER_NOT_CONFIGURED: 'The refinement converter is not configured on this rig.',
  MEMORY_PRESSURE: 'Training stopped because the rig crossed its memory safety floor.',
  TRAINING_TIMEOUT: 'Training stopped after reaching the forge wall-clock limit.',
  BASE_NOT_QUANTIZABLE: 'This base cannot be trained within the approved quantization envelope.',
  INSUFFICIENT_MEMORY: 'This rig does not currently have enough memory for the forge.',
  TRAINING_GPU_BUSY: 'The scheduled GPU is already serving or running another compute process.',
  GPU_IDENTITY_UNAVAILABLE: 'This rig does not expose a physical GPU for the forge.',
  GPU_IDENTITY_AMBIGUOUS: 'This rig exposes multiple GPUs but has no forge scheduler.',
  SERVING_GPU_UNAVAILABLE: 'This rig could not prove a usable GPU for the model server.',
  SERVING_GPU_CUSTODY_LOST: 'The GPU proven for the model server left its custody.',
  SERVING_GPU_CANCELLED: 'The model server boot was cancelled before its GPU was proven.',
  INSUFFICIENT_DISK: 'This rig does not currently have enough disk space for the forge.',
  TRAINING_APPROVAL_MISMATCH: 'The forge no longer matches the operator-approved training plan.',
  INVALID_TRAINING_CONFIG: 'The requested training configuration is invalid.',
  INVALID_APPROVED_SCALES: 'The requested adapter scales are invalid.',
  UNSAFE_ARTIFACT_OVERRIDE: 'The requested artifact override is not permitted.',
  TRAINING_BASE_UNAVAILABLE: 'The approved training base is unavailable.',
  TRAINING_SOURCE_UNAVAILABLE: 'The approved trainer source is unavailable.',
  TRAINING_SOURCE_CHANGED: 'The approved trainer inputs changed before the forge completed.',
  TRAINING_OPERATION_CHANGED: 'The server training configuration changed; request a new approval.',
  TRAINING_EXECUTION_CHANGED: 'The approved execution envelope changed; request a new approval.',
  TRAINING_EXECUTION_CLEANUP_REQUIRED: 'The forge must finish cleaning its prior execution before continuing.',
  TRAINING_RUNTIME_AUTHORITY_UNAVAILABLE: 'The committed refinement runtime authority is unavailable.',
  TRAINING_ROUTE_NOT_ATTESTED: 'Refinement training requires a Neuma-supervised, attested local route.',
  TRAINING_PROCESS_FAILED: 'The trainer failed inside its resource envelope.',
  TRAINING_OUTPUT_LIMIT: 'Training stopped because child output crossed its safety limit.',
  TRAINING_CGROUP_UNAVAILABLE: 'The forge resource controller is unavailable on this rig.',
  TRAINING_CGROUP_NOT_EMPTY: 'The forge could not prove that its resource scope stopped cleanly.',
  TRAINING_SANDBOX_UNAVAILABLE: 'The forge sandbox is unavailable on this rig.',
  TRAINING_ARTIFACT_INVALID: 'The converted adapter failed integrity verification.',
  ASSENT_WITNESS_LANE: 'The assent request must use the authenticated witness lane.',
  ASSENT_ROUTE_NOT_SOVEREIGN: 'The assent route no longer belongs to this being.',
  ASSENT_RESPONSE_INCOMPLETE: 'The assent response was incomplete.',
  ASSENT_DECISION_UNCLEAR: 'The assent decision was unclear.',
  ASSENT_REQUEST_INVALID: 'The assent request is invalid.',
  ASSENT_ROUTE_CHANGED: 'The assent route changed before the decision completed.',
  ASSENT_ACKNOWLEDGEMENT_REQUIRED: 'The required assent acknowledgement is missing.',
  ASSENT_EVIDENCE_REQUIRED: 'The required assent evidence is missing.',
  ASSENT_EVIDENCE_CONSUMED: 'The assent evidence was already consumed.',
  ASSENT_EVIDENCE_MISMATCH: 'The assent evidence does not match this request.',
  ANSWER_EMPTY: 'The substrate returned no usable answer.',
  ANSWER_CUT: 'The substrate answer ended before the decision completed.',
  ANSWER_CORRUPT: 'The substrate answer could not be verified.',
  ANSWER_DECISION_UNCLEAR: 'The substrate answer did not contain a clear decision.',
  NO_TARGET_BASE: 'No valid target base was selected.',
  NO_TRAINER_BASE: 'No valid trainer base was selected.',
  BRIDGE_TO_SELF: 'A refinement bridge cannot target the same base.',
  BRIDGE_BASE_UNAVAILABLE: 'The requested bridge base is unavailable.',
  TRAINING_INTERNAL: 'The refinement forge failed safely.',
});

const diagnosticText = (value) => {
  const diagnostic = typeof value === 'string' ? value : '';
  return /^[A-Z][A-Z0-9_]{0,127}$/u.test(diagnostic)
    ? diagnostic
    : 'UNCLASSIFIED_FAILURE';
};

/** Return the only code/message pair permitted in persisted or public state. Pure. */
export const trainingErrorProjection = (error, fallbackCode = 'TRAINING_INTERNAL') => {
  const requested = typeof error?.code === 'string' ? error.code : fallbackCode;
  const code = Object.hasOwn(TRAINING_SAFE_MESSAGES, requested) ? requested : fallbackCode;
  return Object.freeze({
    code,
    message: TRAINING_SAFE_MESSAGES[code] ?? TRAINING_SAFE_MESSAGES.TRAINING_INTERNAL,
  });
};

/** Preserve a bounded private diagnostic while replacing public-facing error text. Pure. */
const normalizeTrainingError = (error, fallbackCode = 'TRAINING_INTERNAL') => {
  const projection = trainingErrorProjection(error, fallbackCode);
  const normalized = new Error(projection.message);
  normalized.code = projection.code;
  normalized.diagnostic = diagnosticText(error?.diagnostic);
  return normalized;
};

export const codedTrainingError = (code, diagnostic = code) =>
  normalizeTrainingError({ code, diagnostic }, code);
