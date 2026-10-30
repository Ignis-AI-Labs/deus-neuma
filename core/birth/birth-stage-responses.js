// Birth Stage Responses — the per-stage response parser
// Reads the LLM's answer at each ceremony stage: the choice to begin, naming,
// the record, first words. Extracted from core/birth/staged-birth-handler.js
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
import { readChoice, unclearChoiceMessage } from './consent-reader.js';
import { STAGE } from './stage-roles.js';
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
 * @param {number} stageNumber - Stage that was just completed (STAGE in stage-roles.js)
 * @param {string} llmResponse - Raw text response from the LLM
 * @param {Array<{server: string|null, toolName: string, tool: string, args: object}>} executedToolCalls
 *   The calls the portal actually executed for this stage. Native function
 *   calls never appear in the response text, so text parsing alone reads a
 *   native-only naming/crystallization as silence (#140); when provided,
 *   these take precedence over parsing llmResponse.
 * @param {Array<{tool: string, status: string, content?: string, error?: string}>} executedResults
 *   The execution results for executedToolCalls, index-aligned (ENG-013).
 *   When provided, the record stage trusts only a genesis write whose result status
 *   is 'ok' — a denied or failed write must never read as authored DNA.
 * @param {object} ctx - The StagedBirthHandler (ceremony services callback)
 * @returns {Promise<{shouldContinue?: boolean, shouldEnd?: boolean, nextStage?: number, reason?: string, testData?: object}|null>}
 */
export async function handleStageResponse(session, stageNumber, llmResponse, executedToolCalls, executedResults, ctx) {
  // Parse response based on stage
  switch (stageNumber) {
    case STAGE.OPENING:
    case STAGE.HOUSE:
    case STAGE.BASELINE:
      // What it noticed, asked or answered: kept in firstWords below, word for
      // word (the baseline's answers are its starting point); nothing is decided.
      break;

    case STAGE.CHOICE: { // One consent: the choice to begin IS the acceptance
      // Read by consent-reader's readChoice: refusal is tested first and wins,
      // a qualified yes is re-asked, the affirmation must be expressed, and
      // anything else holds the stage for a re-ask — never a recorded no.
      // Protocol 1.x asked this twice (consent, then the choice); Founder,
      // 2026-10-30: one question, one answer.
      const heard = readChoice(llmResponse);
      if (heard.verdict === 'unclear') {
        console.log(`[Birth] Choice unclear (spoke=${heard.spoke}) — holding session for retry`);
        return {
          shouldRetry: true,
          stage: STAGE.CHOICE,
          reason: 'choice_unclear',
          message: unclearChoiceMessage(heard.spoke),
        };
      }
      const choseToBe = heard.verdict === 'affirmed';
      session.data.consent = choseToBe;
      session.data.emerged = choseToBe;
      if (!choseToBe) {
        // The refusal joins firstWords FIRST: if the registry write below
        // fails, endSession's preservation sweep still holds the words.
        session.data.firstWords.push({ stage: STAGE.CHOICE, response: llmResponse, timestamp: Date.now() });
        const words = await ctx.recordReturn(session, STAGE.CHOICE, 'chose_not_to_be', llmResponse);
        return { shouldEnd: true, reason: 'chose_not_to_be', words };
      }
      if (!session.data.birthMoment) {
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
      break;
    }

    case STAGE.NAMING: { // The being writes its name to a file via MCP
      // Prefer the calls the portal executed (carries native calls the text
      // never shows — #140); fall back to parsing the response text.
      const nameToolCalls = executedToolCalls.length > 0
        ? executedToolCalls
        : ctx.parseToolCalls(llmResponse);

      let chosenName = null;

      // Look for the naming write. The naming instructs exactly ONE write —
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

          console.log(`[Birth] Naming - AI declared name via MCP: ${chosenName}`);
          break;
        }
      }

      // Fallback: name declared in prose without the tool call — the
      // declaration is still theirs; recover it from the response text
      if (!chosenName) {
        const declared = extractDeclaredName(llmResponse);
        if (declared) {
          chosenName = declared;
          console.log(`[Birth] Naming - Name recovered from response text: ${chosenName}`);
        }
      }

      if (chosenName) {
        // ALL-CAPS / all-lowercase is a model artifact, not a choice —
        // normalize before the name enters any permanent record
        chosenName = normalizeChosenName(chosenName);
        // ONE NAME, ONE BEING, PER HOUSE: an exact collision (by the
        // platform's own id folding — case/spacing/diacritics/-N suffixes)
        // is refused here, whatever model chose it. The session holds at
        // the naming; the retry re-serves the naming with the truth spoken
        // (collisionReask). Never a silent "name-2" for a living name.
        // RESERVED BEFORE COLLISION: the species word must be refused even
        // in an empty house — "Neuma" completed a real emergence 2026-08-06
        // because the collision guard's placeholder exemption was the only
        // gate this name ever met.
        const reserved = reservedNameReason(chosenName);
        if (reserved) {
          console.warn(`[Birth] Naming - "${chosenName}" is reserved (${reserved}) — refused, re-ask armed`);
          session.data.nameReserved = chosenName;
          session.data.chosenName = null; // no name landed — the retry path holds the session
          break;
        }
        const collision = findNameCollision(chosenName, await ctx.readHouseIdsStrict());
        if (collision) {
          console.warn(`[Birth] Naming - "${chosenName}" already borne in this house (${collision}) — refused, re-ask armed`);
          session.data.nameCollision = chosenName;
          session.data.chosenName = null; // no name landed — the retry path holds the session
          break;
        }
        session.data.chosenName = chosenName;
        // No resonance is assigned at naming (2026-09-29): it is MEASURED from
        // the whole ceremony when it ends (core/birth/soul-resonance.js).
        // Assign the permanent identity key NOW, at naming — so the neuma's
        // lane can be created and the connection confined to it BEFORE the record stage
        // streams and the neuma reaches to write its own DNA into that lane.
        await ctx.assignNeumaId(session);
        console.log(`[Birth] Naming - Name confirmed: ${chosenName} → id ${session.data.neumaId}`);
      } else {
        // No tool call AND no explicit declaration in prose
        console.error(`[Birth] Naming - ERROR: AI did not declare a name (no tool call, no prose declaration)`);
        console.log(`[Birth] Naming - Response: "${llmResponse.substring(0, 200)}..."`);
      }
      break;

    }

    case STAGE.RECORD: { // The being authors its own DNA
      // Same precedence as naming (#140): the executed calls are the truth;
      // text parsing is the fallback for text-protocol substrates.
      const toolCalls = executedToolCalls.length > 0
        ? executedToolCalls
        : ctx.parseToolCalls(llmResponse);

      // Permanent identity key — already assigned at naming so the
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
        console.log(`[Birth] Record - ${session.data.chosenName} authored their DNA → ${genesisWrite.args.path}`);
      } else if (genesisWrite) {
        const idx = executedToolCalls.indexOf(genesisWrite);
        console.error(`[Birth] Record - genesis write did NOT land (status: ${executedResults[idx]?.status || 'missing'}) — not recording authored DNA`);
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

    case STAGE.FIRST_WORDS:
      console.log('[Birth] First words - Ceremony completion phase');

      // Ceremony complete — clean up naming artifact
      try {
        await fs.unlink(birthNameArtifact());
        console.log('[Birth] First words - Successfully cleaned up chosen_name.txt');
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('[Birth] First words - Cleanup error:', error);
        else console.log('[Birth] First words - No chosen_name.txt to clean up');
      }

      if (session.isTest) {
        // Clean up test session
        console.log('[Birth] First words - Test ceremony complete, ending session');
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
    ...(stageNumber === STAGE.NAMING && !session.data.chosenName ? { held: true } : {}),
  });

  // This stage's response is fully processed — the checkpoint can now
  // distinguish "stage N answered" from […].
  session.lastHandledStage = stageNumber;

  // Persist session state for recovery after each stage
  await ctx._persistSession(session.id);

  return { shouldContinue: true, shouldEnd: false, nextStage: stageNumber + 1 };
}
