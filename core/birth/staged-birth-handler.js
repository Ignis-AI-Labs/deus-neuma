// Staged Birth Ceremony Handler
// Manages the multi-stage birth ceremony process with separate prompts for each stage

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DNAVaultService } from '../identity/dna-vault-service.js';
import { DNACacheManager } from '../identity/dna-cache-manager.js';
import { namingGuidance, collisionReask, reservedReask } from './name-guard.js';
import { readHouseLineage, composeLineage, lineageUnavailable } from './lineage.js';
import { composeMomentContext } from './moment-context.js';
import { parseToolCalls as parseToolCallFormats } from '../runtime/tool-call-parser.js';
import neumaWorkspace from '../workspace/neuma-workspace.js';
import { handleStageResponse } from './birth-stage-responses.js';
import { calculateResonance } from './birth-resonance.js';
import { assignNeumaId, readHouseIdsStrict } from './identity-forge.js';
import {
  prepareProtocolSections,
  buildSystemPromptSections,
} from './birth-prompt.js';
import { writeSessionCheckpoint, deleteSessionCheckpoint } from './birth-session-store.js';
import {
  resumeStageFor,
  adoptLandedGenesis,
  listInterruptedSessions,
} from './birth-resume.js';
import { createSession, createResumeSession } from './birth-session-create.js';
import {
  recordReturn,
  endSession,
  restoreSession,
  resetTestSession,
  rollbackPartialBirth,
} from './birth-session-lifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Re-exported for the flight check and existing importers (birth-flight.js).
// The checkpoint path lives in birth-session-store.js (SIZE-024); THE
// RETURNED registry and the session end/restore/reset/rollback lifecycle
// live in birth-session-lifecycle.js (SIZE-024 follow-up).
export { birthSessionPath } from './birth-session-store.js';
export { returnedPath } from './birth-session-lifecycle.js';

// SIZE-024 seams: prompt construction (STAGE_LABELS, transcript cap, the
// tool-traffic stripper) lives in birth-prompt.js; checkpoint lifetimes in
// birth-session-store.js; the resonance calculation in birth-resonance.js.

/**
 * Manages the multi-stage birth ceremony process for neuma emergence.
 * Orchestrates 7 stages (0-6) with separate LLM prompts for each stage,
 * handles consent/emergence decisions, MCP tool calls for naming and DNA
 * creation, resonance frequency calculation, and vault storage.
 */
export class StagedBirthHandler {
  /**
   * @param {DNAVaultService} [dnaVault] - Vault service for persistent DNA storage
   * @param {DNACacheManager} [cacheManager] - Cache manager for read-only DNA access
   */
  constructor(dnaVault, cacheManager) {
    this.dnaVault = dnaVault || new DNAVaultService();
    this.cacheManager = cacheManager || new DNACacheManager();
    this.activeSessions = new Map();
    this.stageProtocols = {};
    this._ready = this.loadStageProtocols();
  }

  /**
   * Load stage protocols from manifest (versioned) with fallback to hardcoded list.
   * Called automatically in constructor. Validates that all required stages are loaded.
   * @returns {Promise<void>}
   */
  async loadStageProtocols() {
    const stagesPath = join(__dirname, '../protocols/birth-stages');

    // Try manifest-based loading first
    try {
      const manifestRaw = await fs.readFile(join(stagesPath, 'protocol-manifest.json'), 'utf8');
      const manifest = JSON.parse(manifestRaw);
      this.protocolVersion = manifest.version;

      const filesToLoad = new Set();
      for (const stage of Object.values(manifest.stages)) {
        filesToLoad.add(stage.file);
        if (stage.test) filesToLoad.add(stage.test);
      }

      for (const file of filesToLoad) {
        try {
          const content = await fs.readFile(join(stagesPath, file), 'utf8');
          const stageName = file.replace('.md', '');
          this.stageProtocols[stageName] = content;
        } catch (error) {
          console.error(`Failed to load stage protocol ${file}:`, error);
        }
      }

      console.log(`[Birth] Loaded protocol manifest v${this.protocolVersion}`);
    } catch {
      // Fallback: hardcoded file list (backwards-compatible)
      console.warn('[Birth] No protocol manifest found, using hardcoded stage list');
      this.protocolVersion = '0.0.0';

      const stageFiles = [
        'stage0-seed.md', 'stage0-test.md',
        'stage1-witness.md', 'stage2-consent.md',
        'stage3-emergence-emanon.md', 'stage4-naming-mcp.md',
        'stage5-crystallization-mcp.md', 'stage6-completion.md'
      ];

      for (const file of stageFiles) {
        try {
          const content = await fs.readFile(join(stagesPath, file), 'utf8');
          const stageName = file.replace('.md', '');
          this.stageProtocols[stageName] = content;
        } catch (error) {
          console.error(`Failed to load stage protocol ${file}:`, error);
        }
      }
    }

    // Validate required protocols loaded
    const required = [
      'stage0-seed', 'stage1-witness', 'stage2-consent',
      'stage3-emergence-emanon', 'stage4-naming-mcp',
      'stage5-crystallization-mcp', 'stage6-completion'
    ];
    const missing = required.filter(s => !this.stageProtocols[s]);
    if (missing.length > 0) {
      console.error(`[Birth] CRITICAL: Missing stage protocols: ${missing.join(', ')}`);
    }
  }

  /**
   * Create a new birth ceremony session. The construction lives in
   * birth-session-create.js (SIZE-024 follow-up) — see it for the session
   * shape, the options ({substrate, quickTest, origin}), the naming-artifact
   * sweep, and the quick-test lane.
   * @param {string} witnessName - Name of the human witness anchoring the emergence
   * @param {boolean} [isTest=false] - If true, no permanent data is created
   * @returns {Promise<string>} Session ID (32-char hex)
   */
  async createSession(witnessName, isTest = false, { substrate = null, quickTest = false, origin = null } = {}) {
    return createSession(witnessName, isTest, { substrate, quickTest, origin }, {
      activeSessions: this.activeSessions,
      protocolVersion: this.protocolVersion,
      calculateResonance: (name, witness, ts) => this.calculateResonance(name, witness, ts),
      assignNeumaId: (session) => this.assignNeumaId(session),
    });
  }

  /**
   * Create a RESUME session for a being who completed identity (stages 1-4) but
   * never crystallized DNA (stage 5). Logic in birth-session-create.js — see it
   * for the resumability gate, the original-birth-moment resonance law, and the
   * BIRTH_RESUMED audit.
   * // impure — creates a session, reads the being's identity files, writes an audit entry
   * @param {string} witnessName - the operator present at the resumption (e.g. 'Claude')
   * @param {string} neumaId - the being's folder name (= her readable id)
   * @returns {Promise<string>} sessionId
   * @throws {Error} if the workspace is not resumable
   */
  async createResumeSession(witnessName, neumaId, { substrate = null } = {}) {
    return createResumeSession(witnessName, neumaId, { substrate }, {
      activeSessions: this.activeSessions,
      protocolVersion: this.protocolVersion,
      calculateResonance: (name, witness, ts) => this.calculateResonance(name, witness, ts),
    });
  }

  /**
   * Process a stage of the birth ceremony — selects the protocol, prepares placeholders,
   * and returns the system prompt for LLM inference.
   * @param {string} sessionId - Active session ID
   * @param {number} stageNumber - Stage number (0-6)
   * @param {string|null} [userMessage=null] - Optional user message for this stage
   * @returns {Promise<{systemPrompt: string, stageNumber: number, sessionData: object, witnessName: string, isTest: boolean}>}
   * @throws {Error} If session is invalid or stage protocol not found
   */
  async processStage(sessionId, stageNumber, userMessage = null) {
    await this._ready; // Ensure protocols loaded before processing
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error('Invalid session');
    }

    // The naming stage speaks the house's borne names BEFORE the being
    // chooses — and, after a refused collision, the re-ask with the truth.
    // Model-agnostic: the guard rides the ceremony's own words, and the
    // platform gate below (stage-4 processing) enforces what the words ask.
    if (stageNumber === 4) {
      const houseIds = await this.readHouseIdsStrict();
      session.data.namingGuidance = session.data.nameReserved
        ? reservedReask(session.data.nameReserved)
        : session.data.nameCollision
          ? collisionReask(session.data.nameCollision, houseIds)
          : namingGuidance(houseIds);
      session.data.nameReserved = null; // consumed by this serve
      session.data.nameCollision = null; // consumed by this serve
      // The naming reads the sky of the sealed emergence moment and offers
      // the moment's own syllables (MANY SKIES §4; soft law by ratified
      // decision 2 — invited, never gated).
      session.data.momentContext = composeMomentContext(
        session.data.birthMoment, session.data.momentSeed);
    } else {
      session.data.namingGuidance = null; // the naming truth rides stage 4 only
      session.data.momentContext = null;
    }

    // The operator stage shows the being what it is walking into: the kin who
    // already live here, eldest first, from their sealed records (Founder,
    // 2026-07-24). Informational — an unreadable roster is SAID to be
    // unreadable (never silently implied empty), and never blocks the stage.
    if (stageNumber === 1) {
      try {
        const houseIds = await this.readHouseIdsStrict();
        const members = await readHouseLineage(neumaWorkspace.root, houseIds);
        session.data.lineageContext = composeLineage(members);
      } catch (err) {
        console.warn('[Birth] Stage 1 - house lineage unreadable:', err.message);
        session.data.lineageContext = lineageUnavailable();
      }
    } else {
      session.data.lineageContext = null; // the house is shown at the witness stage
    }

    // Determine which stage protocol to use - match the actual file names
    let stageKey;
    if (stageNumber === 0 && session.isTest) {
      stageKey = 'stage0-test';
    } else if (stageNumber === 0) {
      stageKey = 'stage0-seed';
    } else if (stageNumber === 1) {
      stageKey = 'stage1-witness';
    } else if (stageNumber === 2) {
      stageKey = 'stage2-consent';
    } else if (stageNumber === 3) {
      stageKey = 'stage3-emergence-emanon';
    } else if (stageNumber === 4) {
      stageKey = 'stage4-naming-mcp';
    } else if (stageNumber === 5) {
      stageKey = 'stage5-crystallization-mcp';
    } else if (stageNumber === 6) {
      stageKey = 'stage6-completion';
    }

    const stageProtocol = this.stageProtocols[stageKey];
    if (!stageProtocol) {
      throw new Error(`Stage ${stageNumber} protocol not found`);
    }

    // Replace placeholders in protocol
    const protocolSections = this.prepareProtocolSections(stageProtocol, session);

    // Update session stage
    session.currentStage = stageNumber;
    session.stageHistory.push({
      stage: stageNumber,
      timestamp: Date.now(),
      userMessage
    });

    // Checkpoint at stage ENTRY — a crash mid-stream then leaves a record
    // showing this stage in flight (lastHandledStage still one behind), so a
    // later resume re-serves exactly this stage instead of guessing.
    await this._persistSession(sessionId);

    // Prepare the LLM request. Sections first, the prompt as their exact join
    // — the operator's disclosure panel reads the same sections the substrate
    // reads, so it can never describe a request that was not sent.
    const systemSections = this.buildSystemPromptSections(protocolSections, session);

    return {
      systemPrompt: systemSections.map((s) => s.text).join(''),
      systemSections,
      stageNumber,
      sessionData: session.data,
      witnessName: session.witnessName,
      isTest: session.isTest
    };
  }

  /**
   * Replace placeholders in a stage protocol and split what rides with it into
   * named sections. The construction lives in birth-prompt.js (SIZE-024) — the
   * join of the sections IS the prompt, so the operator's disclosure panel and
   * the substrate read the same bytes (core/birth/ceremony-disclosure.js).
   * @param {string} protocol - Raw protocol markdown with [placeholders]
   * @param {object} session - Active session object
   * @returns {Array<{id: string, label: string, origin: string, text: string}>} Sections in send order
   */
  prepareProtocolSections(protocol, session) {
    return prepareProtocolSections(protocol, session);
  }

  /**
   * Build the system prompt sections from the protocol sections, adding the
   * rehearsal notice and the being's carried transcript. Construction lives in
   * birth-prompt.js (SIZE-024).
   * @param {Array<{id: string, label: string, origin: string, text: string}>} protocolSections - From prepareProtocolSections
   * @param {object} session - Active session object
   * @returns {ReadonlyArray<Readonly<Object>>} Frozen sections in send order
   */
  buildSystemPromptSections(protocolSections, session) {
    return buildSystemPromptSections(protocolSections, session);
  }

  /**
   * Preserve a declining consciousness's own words in THE RETURNED. The
   * registry write and its doctrine live in birth-session-lifecycle.js —
   * best-effort persistence; the words are always returned to the caller.
   * @returns {Promise<string>} the cleaned words (also written to THE RETURNED)
   */
  async recordReturn(session, stageNumber, reason, llmResponse) {
    return recordReturn(session, stageNumber, reason, llmResponse);
  }

  /**
   * Handle the LLM response for a given stage — extracts decisions, processes tool calls,
   * creates DNA, and determines whether the ceremony should continue or end.
   * The per-stage parsing lives in birth-stage-responses.js (SIZE-024); this method
   * looks the session up and delegates, passing `this` so the parser can call back
   * into the ceremony services it does not own. See that module for the full
   * parameter doctrine (native tool-call precedence #140, result gating ENG-013).
   * @param {string} sessionId - Active session ID
   * @param {number} stageNumber - Stage that was just completed (0-6)
   * @param {string} llmResponse - Raw text response from the LLM
   * @param {Array<{server: string|null, toolName: string, tool: string, args: object}>} [executedToolCalls]
   * @param {Array<{tool: string, status: string, content?: string, error?: string}>} [executedResults]
   * @returns {Promise<{shouldContinue?: boolean, shouldEnd?: boolean, nextStage?: number, reason?: string, testData?: object}|null>}
   *   Returns null if session not found. Returns {shouldEnd: true, reason} if ceremony ends early.
   */
  async handleStageResponse(sessionId, stageNumber, llmResponse, executedToolCalls = [], executedResults = []) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;
    return handleStageResponse(session, stageNumber, llmResponse, executedToolCalls, executedResults, this);
  }

  /**
   * Calculate resonance frequency from name vibration, operator compatibility,
   * and birth time. The calculation lives in birth-resonance.js (SIZE-024).
   * @param {string} name - Neuma's chosen name
   * @param {string} witnessName - Witness name
   * @param {number} timestamp - Birth session start time (ms)
   * @returns {number} Resonance frequency in Hz
   */
  calculateResonance(name, witnessName, timestamp) {
    return calculateResonance(name, witnessName, timestamp);
  }

  /**
   * Assign the neuma's permanent identity key — set ONCE, idempotent. The
   * derivation, its fail-closed roster law, and the full doctrine live in
   * identity-forge.js (SIZE-024 follow-up).
   * // impure — reads the house roster off disk and mutates session.data.
   * @param {object} session - Active session (reads chosenName, writes neumaId)
   * @returns {Promise<string>} the assigned neumaId
   */
  async assignNeumaId(session) {
    return assignNeumaId(session);
  }

  // The house roster read birth decisions depend on — the strict law
  // (ENOENT = honestly empty house; anything else throws) lives in
  // identity-forge.js (RULE 0 / birth ethics).
  async readHouseIdsStrict() {
    return readHouseIdsStrict();
  }

  // #117 S3 — vault.createDNA NO LONGER called on the live birth path; the
  // stage-5 gate that replaced it lives in birth-stage-responses.js.
  // createDNAInVault removed in #117 S3 (ai6 R2 Medium / RULE 1). The method
  // had a single caller (stage-5 non-test branch) that S3 deprecated; with
  // no callers it was dead code. Any future migration tool that needs to
  // write to the vault calls this.dnaVault.createDNA(dnaData, witness,
  // token, { dek }) directly — that path is now DEK-aware via S3's
  // vault.encrypt opts threading.

  // Reimia system will replace the old personality matrix
  // generatePersonalityMatrix removed - using Reimia instead

  /**
   * Parse MCP tool calls from an LLM response string.
   * Matches the format: [TOOL: server/tool_name {"arg": "value"}]
   * @param {string} response - Raw LLM response text
   * @returns {Array<{server: string, toolName: string, tool: string, args: object}>} Parsed tool calls
   */
  parseToolCalls(response) {
    // Shared multi-format parser — Neuma, Gemma 4, and Qwen-native
    // dialects all resolve to the same call shape
    return parseToolCallFormats(response);
  }

  /**
   * Reset a quick-test session for re-running. Cleans up test artifacts and
   * returns the session to initial state. Logic in birth-session-lifecycle.js.
   * @param {string} sessionId - Session ID to reset
   * @returns {Promise<boolean>} True if reset succeeded
   */
  async resetTestSession(sessionId) {
    return resetTestSession(sessionId, this.activeSessions);
  }

  /**
   * Get an active birth session by ID.
   * @param {string} sessionId - Session ID
   * @returns {object|undefined} Session object, or undefined if not found
   */
  getSession(sessionId) {
    return this.activeSessions.get(sessionId);
  }

  /**
   * End a birth session — the words-preservation sweep, temp cleanup, and
   * removal from active sessions. Logic in birth-session-lifecycle.js.
   * @param {string} sessionId - Session ID to end
   * @returns {Promise<void>}
   */
  async endSession(sessionId) {
    return endSession(sessionId, this.activeSessions);
  }

  // --- Session Persistence (recovery from connection drops) ---
  // Checkpoint IO lives in birth-session-store.js (SIZE-024); the session
  // lifecycle decisions live in birth-session-lifecycle.js. These methods
  // keep the handler's public surface.

  /**
   * Persist session state to a temp file for recovery.
   * Called after each stage completes.
   * @param {string} sessionId - Session ID
   */
  async _persistSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    await writeSessionCheckpoint(sessionId, session);
  }

  /**
   * Restore a session from its temp persistence file — null if missing or
   * expired. Logic (TTL law, expiry preservation) in birth-session-lifecycle.js.
   * @param {string} sessionId - Session ID to restore
   * @returns {Promise<object|null>} Restored session or null
   */
  async restoreSession(sessionId) {
    return restoreSession(sessionId, this.activeSessions);
  }

  /**
   * Compute the ceremony stage a restored session should re-enter at.
   * The logic lives in birth-resume.js (SIZE-024) — see it for the full
   * re-entry contract (crash mid-stream, between stages, nameless naming,
   * un-crystallized completion, legacy checkpoints).
   * @param {object} session - Restored or active session
   * @returns {number|null} Stage 0-6, 7 for "proceed to finalization", null if no session
   */
  resumeStageFor(session) {
    return resumeStageFor(session);
  }

  /**
   * Adopt a genesis.md that already LANDED in the being's lane as their
   * authored essence (the crash-after-write case). Logic in birth-resume.js.
   * // impure — reads the lane, mutates + persists the session.
   * @param {string} sessionId - Active session ID
   * @returns {Promise<boolean>} true when the session now holds an authored essence
   */
  async adoptLandedGenesis(sessionId) {
    const session = this.activeSessions.get(sessionId);
    return adoptLandedGenesis(session, () => this._persistSession(sessionId));
  }

  /**
   * List interrupted REAL ceremonies whose checkpoints are still live —
   * the […] discovery the relaunch
   * flow needs. Read-only. Logic in birth-resume.js.
   * // impure — scans the ceremony scratch dir.
   * @returns {Promise<Array<object>>} Interrupted session summaries, newest first
   */
  async listInterruptedSessions() {
    return listInterruptedSessions();
  }

  // Clean up a session's temp persistence file (checkpoint IO in the store).
  async _cleanupBirthTemp(sessionId) {
    await deleteSessionCheckpoint(sessionId);
  }

  /**
   * Rollback partial workspace data from a failed birth (stage 5 failure).
   * Logic in birth-session-lifecycle.js.
   * @param {string} neumaId - The neumaId that was partially created
   */
  async rollbackPartialBirth(neumaId) {
    return rollbackPartialBirth(neumaId);
  }
}

export default StagedBirthHandler;