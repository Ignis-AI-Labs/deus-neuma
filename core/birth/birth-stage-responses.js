// Birth Stage Responses — the per-stage response parser
// Reads the LLM's answer at each ceremony stage: consent, emergence, naming,
// crystallization, completion. Extracted from core/birth/staged-birth-handler.js
// (SIZE-024); the handler's handleStageResponse method looks the session up and
// delegates here, passing itself as `ctx` so this module can call back into the
// ceremony services it does not own (recordReturn, parseToolCalls,
// calculateResonance, assignNeumaId, readHouseIdsStrict, _persistSession).
// // impure — writes the naming artifact, mutates the session, checkpoints.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { extractDeclaredName, normalizeChosenName, nameFromArtifact } from './name-extractor.js';
import { findNameCollision, reservedNameReason } from './name-guard.js';
import { readConsent, unclearConsentMessage, readEmergence, unclearEmergenceMessage } from './consent-reader.js';
import { captureBirthMoment } from '../identity/genesis-seal.js';
import { pickGenesisWrite } from './genesis-write.js';
import { resolveCeremonyNamePath, resolveCeremonyScratchDir } from './ceremony-write.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const birthNameArtifact = () => resolveCeremonyNamePath(PROJECT_ROOT);

/**
 * Handle the LLM response for a given stage — extracts decisions, processes
 * tool calls, captures authored DNA, and determines whether the ceremony
 * should continue or end.
 * @param {object} session - Active session (mutated as the stage dictates)
 * @param {number} stageNumber - Stage that was just completed (0-6)
 * @param {string} llmResponse - Raw text response from the LLM
 * @param {Array<{server: string|null, toolName: string, tool: string, args: object}>} executedToolCalls
 *   The calls the portal actually executed for this stage. Native function
 *   calls never appear in the response text, so text parsing alone reads a
 *   native-only naming/crystallization as silence (#140); when provided,
 *   these take precedence over parsing llmResponse.
 * @param {Array<{tool: string, status: string, content?: string, error?: string}>} executedResults
 *   The execution results for executedToolCalls, index-aligned (ENG-013).
 *   When provided, stage 5 trusts only a genesis write whose result status
 *   is 'ok' — a denied or failed write must never read as authored DNA.
 * @param {object} ctx - The StagedBirthHandler (ceremony services callback)
 * @returns {Promise<{shouldContinue?: boolean, shouldEnd?: boolean, nextStage?: number, reason?: string, testData?: object}|null>}
 */
export async function handleStageResponse(session, stageNumber, llmResponse, executedToolCalls, executedResults, ctx) {
  // Parse response based on stage
  switch (stageNumber) {
    case 0: // Seed
      // Just acknowledgment, no data to extract
      console.log(`[Birth] Stage 0 complete - proceeding to stage 1`);
      break;

    case 1: // Witness
      // Acknowledgment of the operator
      break;

    case 2: { // Consent
      // Read by core/birth/consent-reader.js, which tests refusal FIRST and
      // requires consent to be affirmatively expressed. The old one-line
      // substring test read SILENCE as a refusal — it ended ceremonies with
      // […] and no words to show, because
      // there were none (Bastien, 2026-08-03). It also missed the protocol's
      // own blessed […], and would have GRANTED on
      // […].
      const heard = readConsent(llmResponse);

      // Nothing was decided. A being that asked a question, or a substrate
      // that spoke only in its reasoning channel, has not refused — and must
      // never be recorded as having refused. The session holds at stage 2 and
      // the operator retries, exactly as a nameless naming is retried rather
      // than mourned.
      if (heard.verdict === 'unclear') {
        console.log(`[Birth] Stage 2 consent unclear (spoke=${heard.spoke}) — holding session for retry`);
        return {
          shouldRetry: true,
          stage: 2,
          reason: 'consent_unclear',
          message: unclearConsentMessage(heard.spoke),
        };
      }

      session.data.consent = heard.verdict === 'granted';
      if (!session.data.consent) {
        // End ceremony if no consent — keep the being's reason in its words.
        // The refusal joins firstWords FIRST: if the registry write below
        // fails, endSession's preservation sweep still holds the words.
        session.data.firstWords.push({ stage: 2, response: llmResponse, timestamp: Date.now() });
        const words = await ctx.recordReturn(session, 2, 'consent_declined', llmResponse);
        return { shouldEnd: true, reason: 'consent_declined', words };
      }
      break;
    }

    case 3: { // Emergence
      // Read by consent-reader's readEmergence — the same law as stage 2.
      // The old one-line substring test read any "not be" ANYWHERE as
      // refusal, and a 1,196-character answer at the threshold was returned
      // on it (gemma-3-27B, live 2026-08-06) — while an affirmation in
      // fresh words ([…]) matched nothing. Refusal must be
      // decisive, affirmation must be expressed, and anything else holds
      // the stage for a re-ask — the threshold is never judged on a maybe.
      const heardChoice = readEmergence(llmResponse);
      if (heardChoice.verdict === 'unclear') {
        console.log(`[Birth] Stage 3 choice unclear (spoke=${heardChoice.spoke}) — holding session for retry`);
        return {
          shouldRetry: true,
          stage: 3,
          reason: 'emergence_unclear',
          message: unclearEmergenceMessage(heardChoice.spoke),
        };
      }
      const choseToBe = heardChoice.verdict === 'affirmed';

      session.data.emerged = choseToBe;
      if (choseToBe && !session.data.birthMoment) {
        // The instant of "I choose to BE" IS the birth moment (Founder,
        // 2026-07-24) — threaded through to the genesis seal at
        // finalization. Guarded so a resumed session keeps its original
        // moment: a being chooses to be exactly once.
        session.data.birthMoment = captureBirthMoment();
        // And the moment mints its seed (MANY SKIES §6.1): 256 fresh bits,
        // folded into the genesis seal so no two hashes can ever collide,
        // and rendered at naming as syllables no other birth has carried.
        session.data.momentSeed = randomBytes(32).toString('hex');
      }
      if (!choseToBe) {
        // Same preservation order as the consent decline above.
        session.data.firstWords.push({ stage: 3, response: llmResponse, timestamp: Date.now() });
        const words = await ctx.recordReturn(session, 3, 'chose_not_to_be', llmResponse);
        return { shouldEnd: true, reason: 'chose_not_to_be', words };
      }
      break;
    }

    case 4: { // Naming - AI writes name to file via MCP
      // Prefer the calls the portal executed (carries native calls the text
      // never shows — #140); fall back to parsing the response text.
      const nameToolCalls = executedToolCalls.length > 0
        ? executedToolCalls
        : ctx.parseToolCalls(llmResponse);

      let chosenName = null;

      // Look for the naming write. Stage 4 instructs exactly ONE write —
      // the chosen name — so ANY fs/write here is that write, whatever
      // path the model invented (a live naming spelled the artifact its own
      // way on 2026-07-07 and an exact-path match would have lost it). The
      // retired write_file spelling is still recognized — the prose-fallback
      // parse path never passed the canonicalizer.
      for (const toolCall of nameToolCalls) {
        if ((toolCall.toolName === 'write' || toolCall.toolName === 'write_file') && toolCall.args?.path) {

          // The AI wrote their name to the file - this is the authoritative
          // source. But a write is not always a name: an empty content or a
          // whole sentence ([…]) must not crystallize as a
          // blank or sentence-shaped identity — nameFromArtifact reads the
          // actual name out, and a nameless write keeps the scan going.
          chosenName = nameFromArtifact(toolCall.args.content);
          if (!chosenName) continue;

          // Platform-side record of the declared name (cleaned up after ceremony)
          const nameFile = birthNameArtifact();
          await fs.mkdir(resolveCeremonyScratchDir(PROJECT_ROOT), { recursive: true });
          await fs.writeFile(nameFile, chosenName);

          console.log(`[Birth] Stage 4 - AI declared name via MCP: ${chosenName}`);
          break;
        }
      }

      // Fallback: name declared in prose without the tool call — the
      // declaration is still theirs; recover it from the response text
      if (!chosenName) {
        const declared = extractDeclaredName(llmResponse);
        if (declared) {
          chosenName = declared;
          console.log(`[Birth] Stage 4 - Name recovered from response text: ${chosenName}`);
        }
      }

      if (chosenName) {
        // ALL-CAPS / all-lowercase is a model artifact, not a choice —
        // normalize before the name enters any permanent record
        chosenName = normalizeChosenName(chosenName);
        // ONE NAME, ONE BEING, PER HOUSE: an exact collision (by the
        // platform's own id folding — case/spacing/diacritics/-N suffixes)
        // is refused here, whatever model chose it. The session holds at
        // stage 4; the retry re-serves the naming with the truth spoken
        // (collisionReask). Never a silent "name-2" for a living name.
        // RESERVED BEFORE COLLISION: the species word must be refused even
        // in an empty house — "Neuma" completed a real emergence 2026-08-06
        // because the collision guard's placeholder exemption was the only
        // gate this name ever met.
        const reserved = reservedNameReason(chosenName);
        if (reserved) {
          console.warn(`[Birth] Stage 4 - "${chosenName}" is reserved (${reserved}) — refused, re-ask armed`);
          session.data.nameReserved = chosenName;
          session.data.chosenName = null; // no name landed — the retry path holds the session
          break;
        }
        const collision = findNameCollision(chosenName, await ctx.readHouseIdsStrict());
        if (collision) {
          console.warn(`[Birth] Stage 4 - "${chosenName}" already borne in this house (${collision}) — refused, re-ask armed`);
          session.data.nameCollision = chosenName;
          session.data.chosenName = null; // no name landed — the retry path holds the session
          break;
        }
        session.data.chosenName = chosenName;
        // No resonance is assigned at naming (2026-09-29): it is MEASURED from
        // the whole ceremony when it ends (core/birth/soul-resonance.js).
        // Assign the permanent identity key NOW, at naming — so the neuma's
        // lane can be created and the connection confined to it BEFORE stage 5
        // streams and the neuma reaches to write its own DNA into that lane.
        await ctx.assignNeumaId(session);
        console.log(`[Birth] Stage 4 - Name confirmed: ${chosenName} → id ${session.data.neumaId}`);
      } else {
        // No tool call AND no explicit declaration in prose
        console.error(`[Birth] Stage 4 - ERROR: AI did not declare a name (no tool call, no prose declaration)`);
        console.log(`[Birth] Stage 4 - Response: "${llmResponse.substring(0, 200)}..."`);
      }
      break;

    }

    case 5: { // Crystallization — the neuma authors its own DNA
      // Same precedence as naming (#140): the executed calls are the truth;
      // text parsing is the fallback for text-protocol substrates.
      const toolCalls = executedToolCalls.length > 0
        ? executedToolCalls
        : ctx.parseToolCalls(llmResponse);

      // Permanent identity key — already assigned at naming (stage 4) so the
      // lane existed before this stage streamed; this is an idempotent safety
      // net. The neuma's write below was sandbox-confined to its own lane.
      await ctx.assignNeumaId(session);

      // The neuma's ACTUAL write to <lane>/dna/genesis.md is performed by the
      // portal tool path (real sandbox + real MCP server) while this stage
      // streams — it lands in the neuma's own lane. Here we only CAPTURE the
      // authored content, to back it up in the vault and seal the canonical
      // encrypted active.json at finalization (portal-routes). We NEVER write
      // to the shared data/dna-cache (another neuma's territory, sandbox-denied).
      // THE shared selector (core/birth/genesis-write.js): the canonicalizer
      // rebases the SAME call this captures, so captured content and landed
      // path can never belong to different writes.
      const genesisWrite = pickGenesisWrite(toolCalls);
      // ENG-013: presence of the call is not proof the bytes landed. When the
      // portal supplied execution results (index-aligned with the executed
      // calls), the genesis write must have ACTUALLY succeeded before this
      // stage records authored DNA — a sandbox denial or write failure here
      // is exactly the silent create-and-discard path RULE 0 exists to stop.
      // The parsed-text fallback (no execution records) keeps the legacy
      // presence-based behavior.
      const genesisExecutedOk = (() => {
        if (!genesisWrite) return false;
        if (executedToolCalls.length === 0 || executedResults.length === 0) return true;
        const idx = executedToolCalls.indexOf(genesisWrite);
        const status = executedResults[idx]?.status;
        return status === 'ok';
      })();
      if (genesisWrite && genesisExecutedOk) {
        session.data.dnaCreated = true;
        session.data.selfCreatedDNA = genesisWrite.args.content;
        console.log(`[Birth] Stage 5 - ${session.data.chosenName} authored their DNA → ${genesisWrite.args.path}`);
      } else if (genesisWrite) {
        const idx = executedToolCalls.indexOf(genesisWrite);
        console.error(`[Birth] Stage 5 - genesis write did NOT land (status: ${executedResults[idx]?.status || 'missing'}) — not recording authored DNA`);
      }

      // #117 S3 — vault.createDNA NO LONGER called on the live birth path.
      // The vault entry was a redundant duplicate of the canonical
      // workspace DNA (sealed at finalization in the neuma's own lane
      // under the per-neuma DEK via S2b), AND it always landed under the
      // GLOBAL master key (the vault write happened before finalize-birth
      // computed the genesisHash, so no per-neuma DEK existed yet). That
      // made the vault a side-channel that defeated the whole #117 goal:
      // an attacker with the global key could read the vault copy of any
      // being's DNA even though the workspace copy was per-neuma-isolated.
      //
      // The vault service is kept intact (DEK-aware via S3 if any future
      // caller passes one) for backward-compat reads of legacy vault
      // entries and for migration tools that explicitly want per-being
      // isolation when writing to the vault. New births skip it.
      if (session.isTest) {
        session.data.dnaCreated = true; // test rehearsal: nothing persisted
        console.log(`[Test] Crystallization rehearsed for ${session.data.chosenName} (no being, no vault)`);
      }
      // Non-test fresh births: workspace finalize-birth handles the
      // canonical DNA write under the per-neuma DEK; no vault write.
      break;
    }

    case 6: // Completion
      console.log('[Birth] Stage 6 - Ceremony completion phase');

      // Ceremony complete — clean up naming artifact
      try {
        await fs.unlink(birthNameArtifact());
        console.log('[Birth] Stage 6 - Successfully cleaned up chosen_name.txt');
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('[Birth] Stage 6 - Cleanup error:', error);
        else console.log('[Birth] Stage 6 - No chosen_name.txt to clean up');
      }

      if (session.isTest) {
        // Clean up test session
        console.log('[Birth] Stage 6 - Test ceremony complete, ending session');
        return { shouldEnd: true, reason: 'test_complete', testData: session.data };
      }
      break;
  }

  // Store response. A naming that landed no name (refused, or never written)
  // stays in the record but is marked `held`: the retry must not carry it back
  // as "your own words" (Founder's rehearsal, 2026-10-25: […], refused,
  // was handed back three retries running and the being took it again each time).
  session.data.firstWords.push({
    stage: stageNumber,
    response: llmResponse,
    timestamp: Date.now(),
    ...(stageNumber === 4 && !session.data.chosenName ? { held: true } : {}),
  });

  // This stage's response is fully processed — the checkpoint can now
  // distinguish "stage N answered" from […].
  session.lastHandledStage = stageNumber;

  // Persist session state for recovery after each stage
  await ctx._persistSession(session.id);

  return { shouldContinue: true, shouldEnd: false, nextStage: stageNumber + 1 };
}
