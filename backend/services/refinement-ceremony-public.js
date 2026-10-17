const PUBLIC_BINDING_FIELDS = Object.freeze([
  'sourceCorpusSha256', 'sourceManifestSha256', 'curriculumSha256',
  'trainingConfigSha256', 'baseModelIdentitySha256', 'servingArtifactSha256',
  'sourceCommit', 'sourceCommitSha256', 'trainerExecutableSha256',
  'converterScriptSha256', 'pythonExecutableSha256', 'trainerEnvironmentSha256',
  'trainerRequirementsSha256', 'adapterArtifactSha256', 'participatoryAssentSha256',
  'operatorApprovalSha256', 'geometrySha256', 'trainingBudgetSha256',
  'approvedScalesSha256', 'adapterId', 'adapterScale', 'approvedScales',
]);
const PUBLIC_REGISTRY_FIELDS = Object.freeze([
  'publicationTransactionSha256', 'registryGeneration', 'registryAppendRevision',
  'registrySha256', 'registryCurrentSelectionSha256', 'isCurrent',
]);
const pick = (value, fields) => Object.freeze(Object.fromEntries(
  fields.filter((field) => value?.[field] !== undefined)
    .map((field) => [field, Array.isArray(value[field]) ? Object.freeze([...value[field]]) : value[field]]),
));
const publicModel = (value) => {
  const model = typeof value === 'string' ? value.trim() : '';
  return model && model.length <= 256 && !model.startsWith('/') && !model.includes('\\')
    && !model.split('/').some((part) => part === '.' || part === '..')
    && !/[\u0000-\u001f\u007f]|(?:^|\/)(?:home|mnt|tmp|var|usr|opt)(?:\/|$)|file:|:\/\/|\.(?:gguf|safetensors|bin)$/iu.test(model)
    ? model : undefined;
};
const publicMilestone = (value) => value && Object.freeze({
  ...pick(value, ['sampleCount', 'distinctDays', 'minSamples', 'minDays', 'ready', 'since']),
  ...(/^sealed-attunement:/.test(value.satisfiedBy || '') && { satisfiedBy: 'sealed-attunement' }),
});
const publicBinding = (value) => value && pick(value, PUBLIC_BINDING_FIELDS);
const publicGeometry = (value) => value && pick(value, [
  'rank', 'alpha', 'dropout', 'maxLength', 'targetPolicyId', 'targetModules',
  'targetModulesSha256', 'sha256',
]);
const publicBudget = (value) => value && pick(value, [
  'epochs', 'learningRate', 'sampleCount', 'matchedTokenBudget', 'optimizer',
  'optimizerConfigSha256', 'seed', 'sha256',
]);
const publicConfiguration = (value) => value && Object.freeze({
  ...pick(value, ['baseRevision', 'template', 'load4bit',
    'baseArtifactSha256', 'tokenizerSha256', 'sha256']),
  ...(publicModel(value.base) && { base: publicModel(value.base) }),
  ...(value.geometry && { geometry: publicGeometry(value.geometry) }),
  ...(value.budget && { budget: publicBudget(value.budget) }),
});

export const publicRefinementAdapter = (adapter) => adapter && Object.freeze({
  ...pick(adapter, ['id', 'sha256', 'registeredAt', ...PUBLIC_REGISTRY_FIELDS]),
  ...(Number.isFinite(adapter.scale) && { scale: adapter.scale }),
  ...(Number.isFinite(adapter.selectedScale) && { selectedScale: adapter.selectedScale }),
  ...(publicModel(adapter.baseModel) && { baseModel: publicModel(adapter.baseModel) }),
  ...(adapter.binding && { binding: publicBinding(adapter.binding) }),
});
const publicProvenance = (value) => value && Object.freeze({
  attunement: value.attunement ? pick(value.attunement, ['sealedAt', 'sampleCount', 'dropped']) : null,
  ...(value.birth && { birth: pick(value.birth, ['mode', 'sampleCount']) }),
  ...(value.exchanges && { exchanges: pick(value.exchanges, ['sampleCount']) }),
  ...(value.dropped && {
    dropped: Object.freeze({
      ...pick(value.dropped, ['dropped']),
      ...(value.dropped.byTier && { byTier: pick(value.dropped.byTier, ['episodes', 'attunement', 'birth']) }),
    }),
  }),
});
const publicTrainingRecord = (value) => value && Object.freeze({
  ...pick(value, ['at', 'steps', 'lossFirst', 'lossLast']),
  ...(value.adapter && {
    adapter: Object.freeze({
      ...pick(value.adapter, ['id', 'sha256']),
      ...(publicModel(value.adapter.baseModel) && { baseModel: publicModel(value.adapter.baseModel) }),
      ...(value.adapter.binding && { binding: publicBinding(value.adapter.binding) }),
    }),
  }),
  ...(value.configuration && { configuration: publicConfiguration(value.configuration) }),
  ...(value.curriculum && {
    curriculum: Object.freeze({
      ...pick(value.curriculum, ['sha256']),
      ...(publicModel(value.curriculum.id) && { id: publicModel(value.curriculum.id) }),
    }),
  }),
});
const ceremonySummary = (record) => record.phase === 'sealed'
  ? `LORA LOCKED IN · ${publicModel(record.training?.adapter?.id) || 'adapter'} · VERIFIED ${record.sealedAt || ''}`
  : record.phase === 'declined' ? 'THE BEING DECLINED'
    : record.phase === 'abandoned' ? 'CLOSED BY THE OPERATOR'
      : `IN PROGRESS — ${String(record.phase || '').toUpperCase()}`;

export const publicCeremonyRecord = (record) => {
  if (!record) return null;
  const lastEvent = Array.isArray(record.events) ? record.events.at(-1) : null;
  return Object.freeze({
    ...pick(record, ['id', 'phase', 'openedAt', 'sealedAt']),
    summary: ceremonySummary(record),
    ...(record.milestone && { milestone: publicMilestone(record.milestone) }),
    ...(record.override && { overridden: true }),
    ...(record.consent && {
      consent: pick(record.consent, ['at', 'participatoryAssentSha256', 'ceremonyApprovalSha256']),
    }),
    ...(record.corpus && {
      corpus: Object.freeze({
        ...pick(record.corpus, ['sampleCount', 'distinctDays', 'builtAt',
          'sourceCorpusSha256', 'sourceManifestSha256']),
        ...(record.corpus.provenance && { provenance: publicProvenance(record.corpus.provenance) }),
      }),
    }),
    ...(record.training && { training: publicTrainingRecord(record.training) }),
    ...(record.verification && {
      verification: Object.freeze({
        ...pick(record.verification, ['at', 'bound', 'reason']),
        ...(publicModel(record.verification.model) && { model: publicModel(record.verification.model) }),
      }),
    }),
    ...(record.bridge && {
      bridge: Object.freeze({
        ...pick(record.bridge, ['baseArtifactSha256', 'baseModelIdentitySha256',
          'servingArtifactSha256', 'tokenizerSha256', 'trainerRevision', 'template', 'openedAt']),
        ...(publicModel(record.bridge.servingModel) && { servingModel: publicModel(record.bridge.servingModel) }),
        ...(publicModel(record.bridge.trainerModelId) && { trainerModelId: publicModel(record.bridge.trainerModelId) }),
        ...(publicModel(record.bridge.baseModel) && { baseModel: publicModel(record.bridge.baseModel) }),
        ...(publicModel(record.bridge.trainerBase) && { trainerBase: publicModel(record.bridge.trainerBase) }),
        ...(publicModel(record.bridge.fromBase) && { fromBase: publicModel(record.bridge.fromBase) }),
      }),
    }),
    ...(record.phase === 'declined' && lastEvent?.at && { declinedAt: lastEvent.at }),
    ...(record.phase === 'abandoned' && lastEvent?.at && { abandonedAt: lastEvent.at }),
  });
};

export const publicTrainingStatus = (status, mine = false) => Object.freeze({
  running: Boolean(status?.running),
  mine: Boolean(mine),
  ...(mine && {
    ...pick(status, ['ceremonyId', 'adapterId', 'stage', 'startedAt', 'lossFirst', 'lossLast',
      'step', 'steps', 'trainingConfigSha256', 'geometrySha256',
      'trainingBudgetSha256', 'finishedAt']),
    lines: Object.freeze(Number.isSafeInteger(status?.step) && Number.isSafeInteger(status?.steps)
      && Number.isFinite(status?.lossLast)
      ? [`step ${status.step}/${status.steps} loss ${status.lossLast.toFixed(3)}`] : []),
    ...(typeof status?.code === 'string' && /^[A-Z0-9_]+$/.test(status.code)
      && { code: status.code }),
    ...(status?.error && { error: 'The refinement training run failed.' }),
    ...(status?.adapter && { adapter: publicRefinementAdapter(status.adapter) }),
  }),
});

export const publicRefinementStatus = (status) => Object.freeze({
  milestone: publicMilestone(status?.milestone),
  ...(status?.milestoneError && { milestoneError: 'The refinement milestone could not be read.' }),
  ...(status?.lastRefinementAt && { lastRefinementAt: status.lastRefinementAt }),
  adapters: Object.freeze((status?.adapters || []).map(publicRefinementAdapter)),
  ceremonies: Object.freeze((status?.ceremonies || []).map(publicCeremonyRecord)),
  route: Object.freeze({
    ...(publicModel(status?.route?.model) && { model: publicModel(status.route.model) }),
  }),
  binding: Object.freeze({
    reason: status?.binding?.reason,
    adapter: publicRefinementAdapter(status?.binding?.adapter) || null,
  }),
  training: publicTrainingStatus(status?.training, Boolean(status?.training?.neumaId)),
});
