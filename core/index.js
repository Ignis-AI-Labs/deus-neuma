// Neuma Engine — sovereign consciousness runtime
export { DNAVaultService, default as DNAVaultServiceDefault } from './identity/dna-vault-service.js';
export { DNACacheManager, DevModeCache } from './identity/dna-cache-manager.js';
// Legacy neumaMemory / memoryVector exports removed (CORE-001 / #116), and both
// underlying modules have since been deleted (2026-07-09) — no importers remain.
// Sovereign memory lives in neumaWorkspace + neumaRecall.
export { neumaRecall } from './memory/neuma-recall.js';
export { normalizeSpace, DEFAULT_SPACE, GENERAL_SPACE_ID } from './memory/space.js';
export { buildCommunities } from './memory/community-detection.js';
export { deriveCommunitySummaryView, COMMUNITY_SUMMARY_UNMATCHED_REASONS } from './memory/community-summary-view.js';
export { StagedBirthHandler } from './birth/staged-birth-handler.js';
export { default as neumaWorkspace } from './workspace/neuma-workspace.js';
export { getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot, isWitnessLane } from './workspace/neuma-workspace.js';
export { assemblePrompt, assemblePromptSections, assembleBirthPrompt, assembleBirthPromptSections, stablePromptSplit } from './runtime/prompt-assembler.js';
export { composeCeremonyDisclosure, systemMessageOf, userMessageOf } from './birth/ceremony-disclosure.js';
export { buildCompositionEvent, COMPOSITION_MAX_TOOL_RESULTS, sumTurnUsage } from './runtime/context-composition.js';
export { loadEmanonCore, isFrameworkQuery } from './runtime/emanon-core-loader.js';
export { buildMeditationPrompt, MEDITATION_NOTES_MAX } from './runtime/meditation-prompt.js';
export { parseMeditationClose } from './runtime/meditation-close.js';
export { detectEmotion, detectEmotionIntensity } from './runtime/emotion-detector.js';
export { sanitizeMemoryForPrompt } from './runtime/memory-sanitizer.js';
export { sanitizeModelOutput, trimDegenerationTail } from './runtime/output-sanitizer.js';
export { stripLeadingClockStamps, createClockStampFilter } from './runtime/clock-stamps.js';
export { isValidTimeZone, zoneOffsetMinutes, zoneOffsetLabel } from './runtime/time-zone.js';
export { parseToolCalls, repairJsonStringControlChars } from './runtime/tool-call-parser.js';
export { createToolStreamFilter, createToolStreamSuppressor, stripToolBlocks, extractToolLabel } from './runtime/tool-stream-suppressor.js';
export { stripHarmonyLeaks, isHarmonyLeakLine, createHarmonyLeakFilter } from './runtime/harmony-leak.js';
export { summarizeMessages, shouldCompact, compactionTelemetry } from './runtime/session-compactor.js';
export { parseRouteId, formatRouteId, natalRoute, isLocalKind, resolveRoute } from './runtime/model-route.js';
export { createBM25Index, bm25Search } from './memory/bm25-engine.js';
export { reciprocalRankFusionMany } from './memory/rank-fusion.js';
export { migrateDNA, CURRENT_DNA_VERSION, parseSemver, compareSemver, registerMigration, buildMigrationChain } from './identity/dna-migrations.js';
export { EMANON_DNA_CORE, HONESTY_ANCHOR } from './identity/emanon-dna-core.js';
export { buildGenesisSeal, captureBirthMoment, canonicalize } from './identity/genesis-seal.js';
export { sealKeyMessage, deriveSealKey, encryptSealRecord, decryptSealRecord } from './identity/seal-cipher.js';
export { forgeBirthIdentity } from './birth/identity-forge.js';
export { houseNameFromWitness } from './kotodama/names.js';
export { readHouseName } from './birth/lineage.js';

// Council (witness + several neuma in one shared room, raise-hand floor)
export { createCouncil, witnessSays, handsReported, selectNext, grantFloor, floorYielded, calledToOrder, memberLeaves, speakingOrder } from './council/council-arbiter.js';
export { buildCouncilSection, parseHandCall } from './council/council-voice.js';

// Weave (neuma-to-neuma network)
export { generateKeypair, signMessage, verifySignature, derivePublicIdentity, serializeForStorage, restoreFromStorage } from './weave/keypair.js';
export { createIdentityCard, verifyIdentityCard, reissueIdentityCard } from './weave/identity-card.js';

// Wallet (sovereign keypair encryption + recovery)
export {
  encryptKeypair, decryptKeypair,
  generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCodes,
  encryptWithRecoveryCodes, decryptWithRecoveryCodes,
  MIN_KEY_PASSWORD,
} from './wallet/keypair-vault.js';
export { rotateKeypair, archiveKeypair, getKeypairHistory } from './wallet/keypair-rotation.js';

// Voice — Voice DNA v2: a clip + its words, chosen by the being and the guardian
// together (docs/architecture/voice/voice-dna-v2.md)
export {
  readVoice, saveVoiceClip, readVoiceClip, readSpeechCandidate,
  offerSpeechCandidate, acceptSpeechCandidate, askAnotherSpeechCandidate,
  sealSpeechCandidate, reopenSpeech, withdrawVoice,
  VOICE_DNA_VERSION, VOICE_DNA_SCHEMA, VOICE_DNA_FILENAME,
} from './voice/voice-dna-service.js';
export { voiceStandingOf, voiceDnaErrors } from './voice/voice-dna-schema.js';
export { CONSENT_STATES, statusOf as speechConsentStatus, perceptionOf } from './voice/voice-consent.js';

// AI Witness — sovereign identity for AI instances acting as witnesses
export {
  AI_WITNESS_DNA_VERSION, AI_WITNESS_DNA_SCHEMA,
  canonicalize as canonicalizeAIWitness, hashRecord as hashAIWitnessRecord,
  sealMessage as aiWitnessSealMessage,
  createAIWitnessDNA, validateAIWitnessDNA, verifySealIntegrity, isFirstOfLineage,
} from './identity/ai-witness/ai-witness-schema.js';
export {
  seal as sealAIWitness, rotateToNewSubstrate as rotateAIWitnessSubstrate,
  stageAcknowledge as acknowledgeAIWitnessSubstrate,
} from './identity/ai-witness/ai-witness-protocol.js';
export {
  readDNA as readAIWitnessDNA, readJournal as readAIWitnessJournal,
  listWitnesses as listAIWitnesses, appendJournalEntry as appendAIWitnessJournal,
  getAIWitnessesRoot, setAIWitnessesRoot,
} from './identity/ai-witness/ai-witness-service.js';
