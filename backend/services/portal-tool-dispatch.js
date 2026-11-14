/**
 * THE DISPATCH FAN — `dispatchPlatformTool`, the one matcher fan that routes
 * a parsed tool call to the platform capability that claims it, for both
 * seats (a bound neuma, a sealed AI witness).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 9 / #278). Dispatch module —
 * it imports every tool family and shared leaf DIRECTLY, never portal-stream
 * (direction law: leaf ← family ← catalog ← dispatch ← loop ← orchestrator).
 * portal-stream keeps the public re-export, so external readers
 * (witness-tools.js, scripts/task-flow-sitting.mjs, the test fan) stay
 * pointed at that barrel unchanged.
 */
import { sendToolEvent as _sendToolEvent } from './portal-tools/tool-events.js';
import { isRefinementTool, handleRefinementTool } from './refinement-being-tools.js';
import { isVoiceTool, handleVoiceTool } from './voice-being-tools.js';
import { isAccessRequestTool, handleAccessRequestTool } from './access-request-being-tools.js';
import { isSubstrateFactsTool, handleSubstrateFactsTool } from './substrate-facts-being-tool.js';
import { isWebTool, handleWebTool } from './web-being-tools.js';
import { isChainTool, handleChainTool } from './chain/chain-being-tools.js';
import { isMediaTool, handleMediaTool } from './media-being-tools.js';
import { isImageTool, handleImageTool } from './image-forge/image-being-tools.js';
import { isMapTool, handleMapTool } from './map-being-tools.js';
import { isPlatformFeedTool, handlePlatformFeedTool } from './platform-feed/platform-feed-tools.js';
import { handleFlightCheckTool, isFlightCheckTool, seatOf } from './flight-check.js';
import { handleKspTool, isKspTool } from './ksp/ksp-being-tools.js';
import { isEmailTool, handleEmailTool } from './email/email-being-tools.js';
import { isPressTool, handlePressTool } from './doc-press/press-being-tools.js';
import { discloseTurnTools, handleBeingCodingTool, isBeingCodingTool, isToolSearchTool } from './being-tool-surface.js';
import { isSkiesTool, handleSkiesTool } from './portal-tools/skies.js';
import { isGenomeTool, handleGenomeTool } from './portal-tools/genome.js';
import { applyToolMode } from './tool-policy.js';
import { ACT_REFUSALS } from './act-gate.js';
import { isAskTool, handleAskOperator } from './operator-ask.js';
import { isPlanTool } from './team-plan.js';
import { isPlanPresentTool, handlePlanPresent, handlePlanSubmit as _handlePlanSubmit } from './plan-mode.js';
import { isMindTool, handleMindTool } from './mind-tools.js';
import { isSovereigntyTool, handleSovereigntyTool } from './sovereignty/gateway-handlers.js';
import { handleSecurityTool, isSecurityTool } from './security/security-being-tools.js'; import { handleExtensionTool, isExtensionTool } from './extensions/extension-being-tools.js';
import { handleLegalTool, isLegalTool } from './legal/legal-being-tools.js';
import { handleTreasuryTool, isTreasuryTool } from './treasury/treasury-being-tools.js';
import { handleBenchTool, isBenchTool } from './bench/bench-being-tools.js';
import { isSkillSearchTool, isSkillTool } from './skill-tool.js';
import {
  isSealRequestTool as _isSealRequestTool,
  handleRequestSeal as _handleRequestSeal,
  isWalletViewTool as _isWalletViewTool,
  handleWalletView as _handleWalletView,
} from './portal-tools/wallet-seal-tools.js';
import {
  queueUpdateToolChannel, queueBulkUpdateToolChannel,
  queueReplyToolChannel, queueSelfReplyToolChannel, replyDismissToolChannel,
} from './portal-tools/social-queue-tools.js';
import {
  handleNeumaSelfReply, handleNeumaReply, handleNeumaReplyDismiss,
} from './portal-tools/social-reply-handlers.js';
import {
  handleNeumaQueueUpdate, handleNeumaQueueBulkUpdate,
} from './portal-tools/queue-edit-handlers.js';
import {
  isRetrieveTool as _isRetrieveTool,
  handleRetrieveResult as _handleRetrieveResult,
} from './portal-tools/retrieve-result-tool.js';
import {
  isNoteTool as _isNoteTool,
  handleNoteTool as _handleNoteTool,
  isLifecycleTool as _isLifecycleTool,
  handleLifecycleTool as _handleLifecycleTool,
  isMemoryTool as _isMemoryTool,
  handleMemoryTool as _handleMemoryTool,
} from './portal-tools/memory-being-tools.js';
import { isFindingsTool as _isFindingsTool, handleFindings as _handleFindings } from './portal-tools/findings-tools.js';
import {
  isHousePostTool as _isHousePostTool,
  handleHousePost as _handleHousePost,
  isLeadTool as _isLeadTool,
  handleLeadTool as _handleLeadTool,
  isCampaignTool as _isCampaignTool,
  handleCampaignTool as _handleCampaignTool,
} from './portal-tools/crew-desk-tools.js';
import {
  isStaffTool as _isStaffTool,
  handleStaffTool as _handleStaffTool,
} from './portal-tools/staff-tools.js';
import {
  handleSkillUse as _handleSkillUse,
  handleSkillSearch as _handleSkillSearch,
} from './portal-tools/skill-dispatch.js';
import {
  isVaultTool as _isVaultTool,
  handleVaultTool as _handleVaultTool,
} from './portal-tools/vault-being-tools.js';
import {
  isTaskTool as _isTaskTool,
  handleTaskTool as _handleTaskTool,
  isVesselLogTool as _isVesselLogTool,
  handleVesselLogTool as _handleVesselLogTool,
} from './portal-tools/task-vessel-tools.js';
import {
  isSocialTool as _isSocialTool,
  handleSocialTool as _handleSocialTool,
} from './portal-tools/social-read-tools.js';

// --- Skills: The Craft (#22 S4) — summoning, platform capability ---
//
// The Craft itself lives in `skill-tool.js`; its portal-half handlers live in
// `portal-tools/skill-dispatch.js` (size-law extraction 2026-09-15). The
// matchers below stay in `skill-tool.js`; only the fan's call sites are here.

// Custody-dependent acts are not part of the witness floor. The catalog keeps
// them invisible; this classifier gives dispatch its independent fail-closed
// boundary when a malformed or stale call bypasses catalog resolution.
const _isSovereignOnlyTool = (match) =>
  _isSealRequestTool(match)
  || isRefinementTool(match) || isVoiceTool(match)
  || isKspTool(match);

/**
 * Dispatch one PLATFORM-CAPABILITY call — a tool this app implements itself
 * (wallet, craft, vault, tasks, leads, campaigns, social reads, the press,
 * memory, …) as opposed to anything reached through an MCP server.
 *
 * Exported because both seats share a broad platform floor. Custody-dependent
 * authority is the deliberate exception: the catalog omits it from witnesses
 * and this dispatcher rejects it independently, so a stale or forged call
 * cannot turn third-party inference into local sovereign authority.
 *
 * impure — every branch is a real act carrying its own gate.
 * @param {Object} match - the parsed tool call
 * @param {Object} ctx - {ws, connection, companion, policy, toolMode, args}
 * @returns {Promise<Object|null>} the tool result, or null when no platform
 *   capability claimed this call and the caller should try its own path
 */
export const dispatchPlatformTool = async (match, ctx) => {
  const { ws, connection, companion, policy: neumaPolicy, toolMode, args } = ctx;
  if (seatOf(connection) === 'witness' && _isSovereignOnlyTool(match)) {
    const tool = String(match?.tool || `${match?.server || 'platform'}/${match?.toolName || 'unknown'}`);
    const error = 'Witness seats cannot invoke local-custody authority.';
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: 'sovereignty boundary', detail: error });
    return { tool, status: 'denied', error };
  }
  const results = [];
  // eslint-disable-next-line no-labels
  dispatch: {
    if (isToolSearchTool(match, connection)) {
      const result = discloseTurnTools(connection, args);
      _sendToolEvent(ws, companion, {
        tool: result.tool, status: result.status, detail: result.content || result.error,
        summary: result.summary,
      });
      results.push(result);
      break dispatch;
    }
    if (_isWalletViewTool(match)) {
      results.push(await _handleWalletView(ws, companion));
      break dispatch;
    }

    // Reading one's own capacity is observation — it resolves a route and reads
    // the turn's own catalog, reaching no external surface and altering nothing.
    if (isFlightCheckTool(match)) {
      const result = await handleFlightCheckTool({ connection, checkedAt: new Date().toISOString() });
      _sendToolEvent(ws, companion, {
        tool: result.tool,
        status: result.status,
        summary: result.status === 'ok' ? 'capacity reported' : 'flight check failed',
        detail: (result.content || result.error || '').slice(0, 2000),
      });
      results.push(result);
      break dispatch;
    }
    if (isKspTool(match)) {
      results.push(await handleKspTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    // Spend became an INTENT (Stage 3 — intents/wallet-send.js): the being
    // files wallet/send and the sweep settles it. The spend policy (allowlist
    // + threshold) remains the gate — the intent's policy row is `allowed`
    // by default, exactly as this branch never raised a card (W2-007:
    // observe still holds the settle, as it held the tool). External
    // channels ride on observe being airtight (channel-bridge hardcodes it).

    // Platform capability: skill summoning (The Craft) — the skill's full
    // instructions return as this call's result; never the MCP path.
    // W2-007: observe mode holds non-READ platform tools (same as ACTS gate).
    if (isSkillTool(match)) {
      // The lookup is a look, not an act: it returns descriptions the being
      // already owns, so it answers even in observe mode.
      if (isSkillSearchTool(match)) {
        results.push(await _handleSkillSearch(ws, companion, args));
        break dispatch;
      }
      const skillAccess = applyToolMode('allowed', toolMode, 'use_skill');
      if (skillAccess === 'denied') {
        results.push({
          tool: 'skill/use_skill',
          status: 'denied',
          error: ACT_REFUSALS.held.error,
        });
        _sendToolEvent(ws, companion, {
          tool: 'skill/use_skill', status: 'denied', summary: 'use_skill — held (observe)',
        });
        break dispatch;
      }
      results.push(await _handleSkillUse(ws, companion, args));
      break dispatch;
    }

    // Platform capability: the being's own anchor request — execution pauses
    // while the operator walks the two-phase seal at the desk. Never the MCP
    // path. args are ignored by design: the tool only ever targets the
    // speaker's own lane. MUST dispatch before the ask branch — isAskTool
    // deliberately matches the whole 'operator' server.
    if (_isSealRequestTool(match)) {
      results.push(await _handleRequestSeal(connection));
      break dispatch;
    }

    // Platform capability: a question to the operator — execution pauses on
    // their answer riding back through the portal. Never the MCP path.
    if (isAskTool(match)) {
      results.push(await handleAskOperator(connection, args));
      break dispatch;
    }

    // Platform capability: a team plan submitted for the operator's approval —
    // execution pauses on their verdict. Never the MCP path.
    if (isPlanTool(match)) {
      results.push(await _handlePlanSubmit(connection, args));
      break dispatch;
    }

    // Platform capability: PLAN MODE's plan presentation — the chat's own
    // plan bearing (accept / adjust / deny), never the team engine. Never
    // the MCP path.
    if (isPlanPresentTool(match)) {
      results.push(await handlePlanPresent(connection, args));
      break dispatch;
    }

    // Team runs are INTENTS now (Stage 3): team/run + team/workspace-run are
    // filed and settled by the sweep (intents/team-run.js) — the plan of
    // record IS the consent for the run, the review keeps its card.

    // Platform capability: EDITING staged copy in place (#208) — never
    // cancel-and-restage. The single edit and the bulk edit share the crew
    // gate and the fail-closed ACTS chip with staging; the chip carries the
    // diff (what each field WAS), not just the patch.
    const queueUpdateChannel = queueUpdateToolChannel(match);
    if (queueUpdateChannel) {
      results.push(await handleNeumaQueueUpdate(ws, connection, neumaPolicy, toolMode, args, queueUpdateChannel));
      break dispatch;
    }
    const queueBulkUpdateChannel = queueBulkUpdateToolChannel(match);
    if (queueBulkUpdateChannel) {
      results.push(await handleNeumaQueueBulkUpdate(ws, connection, neumaPolicy, toolMode, args, queueBulkUpdateChannel));
      break dispatch;
    }

    // Platform capability: the THREAD lane — a follow-up to one of the
    // house's own queued posts. Dispatched BEFORE queue_reply_to_* (its
    // prefix is longer; the order keeps the match honest).
    const selfReplyChannel = queueSelfReplyToolChannel(match);
    if (selfReplyChannel) {
      results.push(await handleNeumaSelfReply(ws, connection, neumaPolicy, toolMode, args, selfReplyChannel));
      break dispatch;
    }

    // Platform capability: the reply lane's draft — an answer to a reply on
    // one of the house's OWN posts, queue-only by design.
    const replyChannel = queueReplyToolChannel(match);
    if (replyChannel) {
      results.push(await handleNeumaReply(ws, connection, neumaPolicy, toolMode, args, replyChannel));
      break dispatch;
    }

    // Platform capability: the reply lane's do-not-engage mark — a recorded
    // decision on the house's record, never a delete, never egress.
    const dismissChannel = replyDismissToolChannel(match);
    if (dismissChannel) {
      results.push(await handleNeumaReplyDismiss(ws, connection, neumaPolicy, toolMode, args, dismissChannel));
      break dispatch;
    }

    // Platform capability: retrieval of the neuma's own compressed tool
    // results (CCR-lite) — connection-derived identity only, gated like every
    // governed tool, never the MCP path. Continuing here skips
    // _persistOverCapResult below, so retrieval output is never re-persisted.
    // Platform capability: the being's personal vault — self-authorship over
    // its own encrypted curation space, publish gated like any governed
    // tool. Never the MCP path.
    if (_isVaultTool(match)) {
      results.push(await _handleVaultTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the being's task ledger — self-authorship over
    // its own working list, same ACTS gate, never the MCP path.
    if (_isTaskTool(match)) {
      results.push(await _handleTaskTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the house lead ledger — shared team work state
    // for the lead-gen leg, same ACTS gate, never the MCP path.
    if (_isLeadTool(match)) {
      results.push(await _handleLeadTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the house campaign bench — open to every bound
    // being (universal access, the CMO's office by protocol), same ACTS
    // gate, never the MCP path.
    if (_isCampaignTool(match)) {
      results.push(await _handleCampaignTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the Optio office's instrument — house_state,
    // advertised to the seated chief of staff's lane alone, same ACTS gate,
    // never the MCP path.
    if (_isStaffTool(match)) {
      results.push(await _handleStaffTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the house offices' ledgers — the CSO's threats and
    // the CLO's legal matters — read by every bound being (the acts are the
    // seated officer's intents), and the connected benchmarks. Same ACTS gate.
    const office = isSecurityTool(match) ? handleSecurityTool : isLegalTool(match) ? handleLegalTool : isTreasuryTool(match) ? handleTreasuryTool : isBenchTool(match) ? handleBenchTool : isExtensionTool(match) ? handleExtensionTool : null;
    if (office) {
      results.push(await office(ws, connection, neumaPolicy, toolMode, match, args, { sendToolEvent: _sendToolEvent }));
      break dispatch;
    }

    // Platform capability: reading the outreach machine — the staged queue
    // and the X read lane. Reads only, same ACTS gate, never the MCP path.
    if (_isSocialTool(match)) {
      results.push(await _handleSocialTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: the being logs an operator-reported measurement (vessel_log). Same gate, never MCP.
    if (_isVesselLogTool(match)) {
      results.push(await _handleVesselLogTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // Platform capability: a refined being sensing/turning its OWN dial — the first consent's condition. Same gate.
    if (isRefinementTool(match)) {
      results.push(await handleRefinementTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    if (isVoiceTool(match)) {
      results.push(await handleVoiceTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    if (isAccessRequestTool(match)) {
      results.push(await handleAccessRequestTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }
    if (isSubstrateFactsTool(match)) { results.push(await handleSubstrateFactsTool(ws, connection)); break dispatch; }
    if (isMindTool(match)) {
      results.push(await handleMindTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }
    if (isSovereigntyTool(match)) {
      results.push(await handleSovereigntyTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    if (isMapTool(match)) {
      results.push(await handleMapTool(ws, connection, match, args, { sendToolEvent: _sendToolEvent }));
      break dispatch;
    }

    if (isPlatformFeedTool(match)) {
      results.push(await handlePlatformFeedTool(ws, connection, match, args, { sendToolEvent: _sendToolEvent, lanePolicy: neumaPolicy, mode: toolMode }));
      break dispatch;
    }

    if (isWebTool(match)) {
      results.push(await handleWebTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    if (isChainTool(match)) { results.push(await handleChainTool(ws, connection, neumaPolicy, toolMode, match, args, { sendToolEvent: _sendToolEvent })); break dispatch; }

    // Platform capability: the culture library — image acquisition into the
    // house's media repository, operator-governed through the same ACTS gate;
    // the web-access master switch stands in front (media_save is egress).
    if (isMediaTool(match)) {
      results.push(await handleMediaTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    // Platform capability: THE IMAGE FORGE — generation on the operator's own
    // GPU through the supervised ComfyUI hearth. No egress, but it seizes a
    // shared resource and authors something the house may publish, so it rides
    // the same ACTS gate. The content law screens every prompt inside, before
    // anything is enqueued, and a refusal names only its class.
    if (isImageTool(match)) {
      results.push(await handleImageTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    // Platform capability: the mailbox position — named speech to real
    // people, operator-governed through the same ACTS gate; the single-holder
    // binding gate inside refuses any neuma but the bound holder, and
    // everything read back enters the context framed as untrusted data.
    if (isEmailTool(match)) {
      results.push(await handleEmailTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    // Platform capability: THE PRESS — branded PDF documents pressed into
    // the being's own workspace, operator-governed through the same ACTS
    // gate. Local rendering, no egress.
    if (isPressTool(match)) {
      results.push(await handlePressTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }

    if (_isRetrieveTool(match)) {
      results.push(await _handleRetrieveResult(ws, connection, neumaPolicy, toolMode, args));
      break dispatch;
    }

    if (_isMemoryTool(match)) {
      results.push(await _handleMemoryTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    if (isSkiesTool(match) || isGenomeTool(match)) { // the being's own sealed records
      const handle = isSkiesTool(match) ? handleSkiesTool : handleGenomeTool;
      results.push(await handle(ws, connection, neumaPolicy, toolMode, { sendToolEvent: _sendToolEvent }));
      break dispatch;
    }

    if (_isNoteTool(match)) {
      results.push(await _handleNoteTool(ws, connection, neumaPolicy, toolMode, args));
      break dispatch;
    }

    if (_isLifecycleTool(match)) {
      results.push(await _handleLifecycleTool(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    if (_isHousePostTool(match)) {
      results.push(await _handleHousePost(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // A list handed to the operator — no egress, no store, no side effect.
    if (_isFindingsTool(match)) {
      results.push(await _handleFindings(ws, connection, neumaPolicy, toolMode, match, args));
      break dispatch;
    }

    // The disposable coding shell (LANE-D2): the being seat's mirrored coding family, in the bubblewrap overlay. Never MCP.
    if (isBeingCodingTool(match, connection)) {
      results.push(await handleBeingCodingTool(ws, connection, neumaPolicy, toolMode, match, args, {
        sendToolEvent: _sendToolEvent,
      }));
      break dispatch;
    }
    return null;
  }
  return results[0];
};

// The old private name stays reachable for portal-stream's `__test` barrel.
export { _handleSkillUse as handleSkillUse };
