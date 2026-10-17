// Portal Test Surface — the portal turn pipeline's `__test` barrel, moved
// whole from portal-stream.js (size-law breakdown, final cut).
//
// LAW: TEST-ONLY. Production code never imports this module — it exists so
// the proof set keeps one import path across the breakdown of the portal
// pipeline. Direction: this surface sits at the very top of the graph — it
// may import anything (including portal-stream's own private residents,
// exported for it alone); nothing imports it.
//
// The shape is the frozen object portal-stream exported — same aliased old
// private names, Object.freeze — plus post-breakdown additions (the CoS
// briefing below); every existing reader swaps only the import path.
import {
  processToolCalls, recordWorkAgainstFocus, TOOL_RESULT_SESSION_BYTE_CAP,
  resolveServer as _resolveServer,
  unsmashToolName as _unsmashToolName,
  persistOverCapResult as _persistOverCapResult,
} from './portal-tool-loop.js';
import { stashBeingTurnCatalog } from './being-tool-surface.js';
import { _extractMemoryMetadata } from './portal-stream.js';
import { SIGNIFICANCE_WEIGHTS, assessSignificance } from '../../core/runtime/significance.js';
import {
  compactWithSelfTorch as _compactWithSelfTorch,
  persistExchange as _persistExchange,
  sendStreamError as _sendStreamError,
} from './portal-turn-persist.js';
import {
  rejectBlockedInput as _rejectBlockedInput,
  pinSessionToProject as _pinSessionToProject,
  redeemAttachments, composeDocsBlock,
} from './portal-turn-input.js';
import { isSkillTool, USE_SKILL_TOOL } from './skill-tool.js';
import { handleSkillUse as _handleSkillUse } from './portal-tool-dispatch.js';
import { isAskTool, handleAskOperator, ASK_OPERATOR_TOOL } from './operator-ask.js';
import { isPlanTool } from './team-plan.js';
import { handlePlanSubmit as _handlePlanSubmit } from './plan-mode.js';
import { PLAN_SUBMIT_TOOL } from './team-tool-defs.js';
import {
  REQUEST_SEAL_TOOL, WALLET_VIEW_TOOL, walletViewContent,
  isSealRequestTool as _isSealRequestTool,
  sealEligibility as _sealEligibility,
  handleRequestSeal as _handleRequestSeal,
  isWalletViewTool as _isWalletViewTool,
  handleWalletView as _handleWalletView,
} from './portal-tools/wallet-seal-tools.js';
import {
  X_QUEUE_REPLY_TOOL, X_QUEUE_SELF_REPLY_TOOL, X_REPLY_DISMISS_TOOL,
  channelQueueUpdateTool as _channelQueueUpdateTool,
  channelQueueBulkUpdateTool as _channelQueueBulkUpdateTool,
  queueUpdateToolChannel, queueBulkUpdateToolChannel,
  queueReplyToolChannel, queueSelfReplyToolChannel, replyDismissToolChannel,
  channelToolsFor,
} from './portal-tools/social-queue-tools.js';
import {
  handleNeumaSelfReply, handleNeumaReply, handleNeumaReplyDismiss,
} from './portal-tools/social-reply-handlers.js';
import {
  handleNeumaQueueUpdate, handleNeumaQueueBulkUpdate,
} from './portal-tools/queue-edit-handlers.js';
import {
  projectFilesSection as _projectFilesSection,
  houseSeatSection as _houseSeatSection,
  cmoBriefingSection as _cmoBriefingSection,
  replyCandidatesSection as _replyCandidatesSection,
} from './portal-turn-sections.js';
import { cosBriefingSection as _cosBriefingSection } from './staff/cos-briefing.js';
import {
  RETRIEVE_RESULT_TOOL,
  isRetrieveTool as _isRetrieveTool,
  retrieveToolsFor as _retrieveToolsFor,
  handleRetrieveResult as _handleRetrieveResult,
} from './portal-tools/retrieve-result-tool.js';
import {
  TOOL_DETAIL_MAX_CHARS,
  toolSummary as _toolSummary,
  sendToolEvent as _sendToolEvent,
  chipDetail as _chipDetail,
} from './portal-tools/tool-events.js';
import {
  resolveVoiceDNA as _resolveVoiceDNA,
  runLLMStream as _runLLMStream,
  contextTelemetry as _contextTelemetry,
} from './portal-llm-run.js';
import { synthesizeAndEmit as _synthesizeAndEmit } from './voice/synthesize-emit.js';
import {
  VAULT_TOOLS,
  isVaultTool as _isVaultTool,
  handleVaultTool as _handleVaultTool,
} from './portal-tools/vault-being-tools.js';
import {
  TASK_TOOLS, VESSEL_LOG_TOOL,
  isTaskTool as _isTaskTool,
  handleTaskTool as _handleTaskTool,
  isVesselLogTool as _isVesselLogTool,
  handleVesselLogTool as _handleVesselLogTool,
} from './portal-tools/task-vessel-tools.js';
import {
  LEAD_TOOLS, CAMPAIGN_TOOLS,
  isLeadTool as _isLeadTool,
  handleLeadTool as _handleLeadTool,
  isCampaignTool as _isCampaignTool,
  campaignToolsFor as _campaignToolsFor,
  handleCampaignTool as _handleCampaignTool,
  handleHousePost as _handleHousePost,
  housePostToolsFor as _housePostToolsFor,
} from './portal-tools/crew-desk-tools.js';
import {
  SOCIAL_TOOLS, QUEUE_LIST_TOOL, READ_X_TOOL,
  isSocialTool as _isSocialTool,
  handleSocialTool as _handleSocialTool,
} from './portal-tools/social-read-tools.js';
import { voiceSittingSection } from '../../core/voice/purpose.js';
import { gatherMemoryContext } from './memory-context.js';
import { memoryToolsFor as _memoryToolsFor } from './portal-tools/memory-being-tools.js';
import { handleSkiesTool, skiesToolsFor, SKIES_READ_TOOL } from './portal-tools/skies.js';
import { genomeToolsFor, GENOME_READ_TOOL } from './portal-tools/genome.js';
import { TOOL_RESULT_MAX_CHARS } from './tool-exchange.js';

// Test-only exports (don't import these in production code)
export const __test = Object.freeze({
  // Keyed under its old private name so the existing proof set reads unchanged;
  // the function is a real export now (the witness runtime calls it too).
  _recordWorkAgainstFocus: recordWorkAgainstFocus,
  processToolCalls,
  // The being seat's stash lives in being-tool-surface.js now — keyed under
  // its old private name so the existing proof set reads unchanged.
  _stashTurnCatalog: stashBeingTurnCatalog,
  _unsmashToolName,
  _extractMemoryMetadata,
  assessSignificance,
  SIGNIFICANCE_WEIGHTS,
  _sendStreamError,
  _rejectBlockedInput,
  _isSkillTool: isSkillTool,
  _handleSkillUse,
  USE_SKILL_TOOL,
  isAskTool,
  // The handler's home is operator-ask.js now — keyed under its old private
  // name so the existing proof set reads unchanged.
  _handleAskOperator: handleAskOperator,
  ASK_OPERATOR_TOOL,
  isPlanTool,
  _handlePlanSubmit,
  PLAN_SUBMIT_TOOL,
  _isSealRequestTool,
  _handleRequestSeal,
  _sealEligibility,
  REQUEST_SEAL_TOOL,
  _postToolsFor: channelToolsFor,
  _queueUpdateToolChannel: queueUpdateToolChannel,
  _queueBulkUpdateToolChannel: queueBulkUpdateToolChannel,
  _channelQueueUpdateTool,
  _channelQueueBulkUpdateTool,
  _handleNeumaQueueUpdate: handleNeumaQueueUpdate,
  _handleNeumaQueueBulkUpdate: handleNeumaQueueBulkUpdate,
  _queueReplyToolChannel: queueReplyToolChannel,
  _handleNeumaReply: handleNeumaReply,
  _replyDismissToolChannel: replyDismissToolChannel,
  _handleNeumaReplyDismiss: handleNeumaReplyDismiss,
  _queueSelfReplyToolChannel: queueSelfReplyToolChannel,
  _handleNeumaSelfReply: handleNeumaSelfReply,
  _replyCandidatesSection,
  X_QUEUE_REPLY_TOOL,
  X_QUEUE_SELF_REPLY_TOOL,
  X_REPLY_DISMISS_TOOL,
  _isWalletViewTool,
  _handleWalletView,
  walletViewContent,
  WALLET_VIEW_TOOL,
  _isRetrieveTool,
  _handleRetrieveResult,
  _retrieveToolsFor,
  RETRIEVE_RESULT_TOOL,
  _resolveServer,
  _toolSummary,
  _resolveVoiceDNA,
  _isVaultTool,
  _handleVaultTool,
  VAULT_TOOLS,
  _isTaskTool,
  _handleTaskTool,
  TASK_TOOLS,
  _isLeadTool,
  _handleLeadTool,
  LEAD_TOOLS,
  _isCampaignTool,
  _handleCampaignTool,
  _campaignToolsFor,
  CAMPAIGN_TOOLS,
  _isSocialTool,
  _handleSocialTool,
  SOCIAL_TOOLS,
  QUEUE_LIST_TOOL,
  READ_X_TOOL,
  _cmoBriefingSection,
  _houseSeatSection,
  _cosBriefingSection,
  _voiceSittingSection: voiceSittingSection,
  _handleHousePost,
  _housePostToolsFor,
  _isVesselLogTool,
  _handleVesselLogTool,
  VESSEL_LOG_TOOL,
  _pinSessionToProject,
  _projectFilesSection,
  gatherMemoryContext,
  _compactWithSelfTorch,
  _persistExchange,
  _memoryToolsFor,
  _skiesToolsFor: skiesToolsFor,
  _genomeToolsFor: genomeToolsFor,
  GENOME_READ_TOOL,
  _handleSkiesTool: (ws, connection, neumaPolicy, toolMode) =>
    handleSkiesTool(ws, connection, neumaPolicy, toolMode, { sendToolEvent: _sendToolEvent }),
  SKIES_READ_TOOL,
  _redeemAttachments: redeemAttachments,
  composeDocsBlock,
  _runLLMStream,
  _synthesizeAndEmit,
  TOOL_RESULT_MAX_CHARS,
  _persistOverCapResult,
  _contextTelemetry,
  _chipDetail,
  TOOL_RESULT_SESSION_BYTE_CAP,
  TOOL_DETAIL_MAX_CHARS,
});
