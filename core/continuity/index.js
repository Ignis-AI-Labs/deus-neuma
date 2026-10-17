// Continuity ecosystem — portable four-layer memory, substrate-agnostic.
// Barrel. The pure core (record + store contract) and the fsdir adapter.
// See docs/planning/proposals/memory/continuity-ecosystem.md.

export { LAYERS, GENERAL_SPACE, makeRecord, normalizeRelations, isValidAsOf } from './record.js';
export {
  OBJECTIVE_RELATION_DOMAIN,
  CLOSURE_OPERATIONS,
  relationsValidAt,
  detectExclusiveRelationConflicts,
  buildClosureSuccessor,
  buildClosureRollbackSuccessor,
  applyApprovedClosure,
  applyClosureRollback,
} from './relation-closure.js';
export { assertLayer, foldLog } from './store-adapter.js';
export { FsDirAdapter } from './adapters/fsdir.js';
export { WorkspaceAdapter } from './adapters/workspace.js';
export { recallEpisodic, recentEpisodes } from './layers/episodic.js';
export { recordToText, byRecencyDesc, approxTokens } from './layers/record-util.js';
export { assembleWorkingSet } from './layers/working.js';
export {
  MIND_LAYER,
  MIND_KINDS,
  MIND_SOURCES,
  MIND_PHRASE_MAX,
  MIND_STRENGTH,
  MIND_TTL_DAYS,
  MIND_ACTIVE_CAP,
  makeMindRecord,
  reinforceMindRecord,
  isMindRecord,
  mindStrengthOf,
  normalizeMindPhrase,
} from './mind/mind-record.js';
export {
  REINFORCE_MIN_OVERLAP,
  writeMindRecord,
  activeMindRecords,
  findReinforcementMatch,
  phraseOverlap,
  byStrengthThenRecency,
} from './mind/mind-store.js';
export { deriveResidue, residuePhraseOf } from './mind/residue-capture.js';
export { assembleDepthSet, resolveDepthMode } from './layers/depth.js';
export { recallProcedure, listProcedures } from './layers/procedural.js';
export { consolidate, recallSemantic, biography } from './layers/semantic.js';
