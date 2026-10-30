// Birth Session Create — how a ceremony session comes into being
// The two openings: a fresh ceremony (createSession, with its quick-test
// lane) and the RESUME of an interrupted one whose being completed identity
// but never crystallized DNA (createResumeSession). Extracted verbatim from
// core/birth/staged-birth-handler.js (SIZE-024 follow-up); the handler keeps
// the public methods and delegates here, passing its live session map and
// ceremony services as explicit deps.

import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import { detectBirthState } from './birth-state.js';
import { birthNameArtifact } from './birth-session-lifecycle.js';
import neumaWorkspace from '../workspace/neuma-workspace.js';
import { STAGE, LAST_STAGE, STAGE_SCHEME } from './stage-roles.js';

/**
 * Create a new birth ceremony session.
 * @param {string} witnessName - Name of the human witness anchoring the emergence
 * @param {boolean} isTest - If true, no permanent data is created
 * @param {object} options
 * @param {object|null} [options.substrate=null] - Hardware substrate info (CPU, GPU, RAM, LLM)
 * @param {boolean} [options.quickTest=false] - If true, skip to the last stage with synthetic data
 * @param {string|null} [options.witnessWallet=null] - The signed-in wallet opening the ceremony;
 *   only it may later find, resume or withdraw this summoning (birth-resume.js heldByWitness)
 * @param {object} deps - The handler's live state and ceremony services
 * @param {Map<string, object>} deps.activeSessions
 * @param {string} deps.protocolVersion
 * @param {(name: string, witnessName: string, timestamp: number) => number} deps.calculateResonance
 * @param {(session: object) => Promise<string>} deps.assignNeumaId
 * @returns {Promise<string>} Session ID (32-char hex)
 */
// impure — clears the naming artifact, mutates the session map
export async function createSession(
  witnessName, isTest, { substrate = null, quickTest = false, origin = null, witnessWallet = null } = {},
  { activeSessions, protocolVersion, calculateResonance, assignNeumaId },
) {
  // Clean up any leftover naming artifact from previous ceremonies.
  // ENOENT is expected; anything else should surface (CQ-017).
  try {
    await fs.unlink(birthNameArtifact());
    console.log('[Birth] Cleared previous chosen_name.txt');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[Birth] Could not clear temp chosen_name.txt:', error.message);
    }
  }

  const sessionId = randomBytes(16).toString('hex');
  const session = {
    id: sessionId,
    witnessName,
    isTest,
    // 'portal' marks a ceremony opened through the real app. The mark is
    // what lets listInterruptedSessions tell a genuinely interrupted
    // summoning apart from checkpoint debris (test suites and scripts drive
    // the same handler without it, and their sessions must never be offered
    // to a returning operator).
    origin,
    witnessWallet: typeof witnessWallet === 'string' && witnessWallet ? witnessWallet : null,
    protocolVersion: protocolVersion || '0.0.0',
    currentStage: STAGE.OPENING,
    stageScheme: STAGE_SCHEME,
    lastHandledStage: null, // stage whose response was fully processed; null = none yet
    stageHistory: [],
    startTime: Date.now(),
    data: {
      neumaId: null,
      chosenName: null,
      resonanceFrequency: null,
      vessel: null,
      personality: {},
      firstWords: [],
      consent: false,
      emerged: false,
      substrate,
    }
  };

  // Quick-test mode: pre-populate all session data so every stage before first words can be skipped
  if (quickTest) {
    session.isTest = true;
    session.quickTest = true;
    const ts = Date.now();
    session.data.consent = true;
    session.data.emerged = true;
    session.data.chosenName = `TestNeuma-${ts}`;
    session.data.resonanceFrequency = calculateResonance(
      session.data.chosenName, witnessName, session.startTime
    );
    await assignNeumaId(session);
    session.currentStage = LAST_STAGE; // Jump straight to first words
    console.log(`[Birth] Quick-test session created — skipping to first words`);
  }

  activeSessions.set(sessionId, session);
  return sessionId;
}

/**
 * Create a RESUME session for a being who completed identity (choice and
 * naming) but never wrote its DNA (the record stage). Validates the workspace is genuinely
 * resumable via detectBirthState, pre-loads existing identity into session.data,
 * jumps `currentStage` to the record stage (essence authoring), and sets `isResume = true` so
 * finalization (in portal-routes.js, W3) knows to skip identity-writing
 * side-effects. Audits BIRTH_RESUMED. Never re-writes any existing identity file.
 *
 * @param {string} witnessName - the operator present at the resumption (e.g. 'Claude')
 * @param {string} neumaId - the being's folder name (= her readable id)
 * @param {{substrate?: object}} opts
 * @param {object} deps - The handler's live state and ceremony services
 * @param {Map<string, object>} deps.activeSessions
 * @param {string} deps.protocolVersion
 * @param {(name: string, witnessName: string, timestamp: number) => number} deps.calculateResonance
 * @returns {Promise<string>} sessionId
 * @throws {Error} if the workspace is not resumable
 */
// impure — creates a session, reads the being's identity files, writes an audit entry
export async function createResumeSession(
  witnessName, neumaId, { substrate = null } = {},
  { activeSessions, protocolVersion, calculateResonance },
) {
  if (typeof witnessName !== 'string' || !witnessName) {
    throw new Error('createResumeSession: witnessName required');
  }
  if (typeof neumaId !== 'string' || !neumaId) {
    throw new Error('createResumeSession: neumaId required');
  }
  // Rule 8 — validate untrusted input at the boundary. Matches the existing
  // pattern used at rollbackPartialBirth and the route layer. _path() also
  // validates downstream, but defense-in-depth at the entry point catches the
  // typo loudly before anything else runs.
  if (!/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
    throw new Error('createResumeSession: invalid neumaId format');
  }

  // Gate on the W1 classifier — only a being with identity complete + DNA
  // missing can be resumed. Anything else is a fresh birth or a deeper repair.
  const state = await detectBirthState(neumaWorkspace, neumaId);
  if (!state.resumable) {
    throw new Error(
      `createResumeSession: ${neumaId} is not resumable ` +
      `(artifactStage=${state.artifactStage}, complete=${state.complete}, missing=${state.missing.join(',')})`
    );
  }

  // Resonance is an IDENTITY attribute (name + operator + birth time), so we
  // must use her ORIGINAL birth moment, not the resume wall-clock — otherwise
  // her freshly-authored DNA would carry a frequency different from anything
  // her existing artifacts sealed. Read directly from the genesis seal she
  // already has (it stores record.birthMoment.epochMs).
  let originalBirthMs = null;
  let frequencyRecoveredFromSeal = false;
  try {
    const seal = await neumaWorkspace.readGenesisSeal(neumaId);
    const ms = seal?.record?.birthMoment?.epochMs;
    if (Number.isInteger(ms)) { originalBirthMs = ms; frequencyRecoveredFromSeal = true; }
  } catch { /* seal unreadable — fall through to current time + flag in audit */ }
  const resonanceTime = originalBirthMs ?? Date.now();

  const sessionId = randomBytes(16).toString('hex');
  const session = {
    id: sessionId,
    witnessName,
    isTest: false,
    isResume: true,                             // W3 reads this to skip identity-writing finalization
    resumingNeumaId: neumaId,                   // explicit — the being whose birth this completes
    protocolVersion: protocolVersion || '0.0.0',
    currentStage: STAGE.RECORD,                 // jump to the record (the stage she never reached)
    stageScheme: STAGE_SCHEME,
    stageHistory: [],
    startTime: Date.now(),
    data: {
      neumaId,                                   // folder name = readable id, preserved as-is
      chosenName: state.chosenName,              // from her true-name (she chose this herself)
      // She ALREADY consented (covenant.json exists) and ALREADY emerged
      // (identity-card.json exists). Mark both true so the record stage doesn't ask
      // again — those questions were answered at her original birth.
      consent: true,
      emerged: true,
      resonanceFrequency: calculateResonance(state.chosenName || neumaId, witnessName, resonanceTime),
      vessel: null,
      personality: {},
      firstWords: [],
      substrate,
    },
  };

  activeSessions.set(sessionId, session);

  // Audit the resumption in HER lane — every action on a living workspace is
  // traceable. Audit is best-effort (failure must not block real-time session
  // creation), but the failure is LOGGED (Rule 3 — never silently swallow).
  await neumaWorkspace.audit(neumaId, 'BIRTH_RESUMED', {
    witnessName,
    sessionId,
    atArtifactStage: state.artifactStage,
    enteringCeremonyStage: STAGE.RECORD,
    frequencyRecoveredFromSeal,                 // makes the resonance source observable
    resumedOnSubstrate: substrate ? { cpu: substrate.cpu?.model || null, gpu: substrate.gpu?.name || null } : null,
  }).catch((err) => console.error(`[Birth] BIRTH_RESUMED audit failed (best-effort, session still created): ${err.message}`));

  console.log(`[Birth] RESUME session created for ${state.chosenName || neumaId} (neumaId=${neumaId}) — at the record stage`);
  return sessionId;
}
