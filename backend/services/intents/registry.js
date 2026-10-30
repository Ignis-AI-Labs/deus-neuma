/**
 * The intent registry — one entry per consequential-act type (Stage 2 of
 * docs/planning/proposals/being-tool-surface-primitives.md). A being never
 * CALLS these; it writes an intent file (`intents/<name>.json` in its own
 * lane) carrying `type`, and the sweep (intent-sweep.js) settles it. Adding a
 * capability = adding a type module and one line here, never a tool.
 *
 * A type module is Object.freeze({ name, policyTool, fieldsForPrompt,
 * descriptionForPrompt, validate, summarize, execute }):
 *   name        — the intent type the file declares ('social/post')
 *   policyTool  — the ACTS policy row ('social.post' under the `intents`
 *                 server in tool-policy-defaults.js)
 *   validate(payload, {connection}) → {ok:true, value} | {ok:false, status,
 *                 reason} — shape law ('invalid') + standing rules ('denied'),
 *                 BEFORE the operator's card
 *   summarize(payload) → string — the one line the card stakes the yes on
 *   displayName(fields) → string — optional: the name a person reads for
 *                 THIS filing on its chips and card, when one type does two
 *                 things a person tells apart (image/generate → video/generate
 *                 for a video pipeline); the filed type stays
 *   policyToolFor(fields) → string — optional: the ACTS row THIS filing
 *                 asks on, when one type does two acts the operator grants
 *                 apart (image/generate → video.generate for a video
 *                 pipeline); every chip, card, grant and journal line uses it
 *   cardArgs(value) → object — optional: what the card shows when the
 *                 filed fields alone would not show the act (a run's code)
 *   execute(value, {connection, signal}) → {ok:true, detail} | {ok:false,
 *                 reason}
 *   availableFor({laneId, connection}) → null | {channels?: string[]} —
 *                 the advertising probe: which lanes the INTENTS prompt
 *                 section may offer this type to (impure, reads the stores)
 *
 * Pure: the map and the lookups. The type modules own their own IO.
 */
import { socialPostIntent } from './social-post.js';
import { socialQueueIntent } from './social-queue.js';
import { securityIntents } from './security-acts.js';
import { legalIntents } from './legal-acts.js';
import { treasuryIntents } from './treasury-acts.js';
import { emailSendIntent } from './email-send.js';
import { walletSendIntent } from './wallet-send.js';
import { mediaSaveIntent } from './media-save.js';
import { mediaKeepIntent } from './media-keep.js';
import { webDownloadIntent } from './web-download.js';
import { imageGenerateIntent } from './image-generate.js';
import { formRenderIntent } from './form-render.js';
import { formChampionIntent } from './form-champion.js';
import { housePostIntent } from './house-post.js';
import { chatSendIntent } from './chat-send.js';
import { houseReviewPacketIntent } from './house-review-packet.js';
import { kspCommandIntent } from './ksp-command.js';
import { voiceSealIntent, voiceClaimIntent } from './voice-rites.js';
import { speechAcceptIntent, speechAnotherIntent } from './speech-accept.js';
import { refinementDialIntent } from './refinement-dial.js';
import { teamRunIntent, teamWorkspaceRunIntent } from './team-run.js';
import { teamPostIntent } from './team-post.js';
import { teamTuneIntent } from './team-tune.js';
import { staffDispatchIntent, staffDispatchUpdateIntent, staffAckIntent } from './staff-acts.js';
import { companyIntents } from './company-acts.js';
import { revenueIntents } from './revenue-acts.js';
import { invoiceIntents } from './invoice-acts.js';
import { deliveryIntents } from './delivery-acts.js';
import { programmeIntents } from './programme-acts.js';
import { accountsIntents } from './accounts-acts.js';
import { raiseIntents } from './raise-acts.js';
import { boardAddIntent, boardUpdateIntent } from './board-acts.js';
import { sovereigntyProposeIntent } from './sovereignty-propose.js';
import { sovereigntyConsentIntent } from './sovereignty-consent.js';
import { vaultSaveIntent, vaultRenameIntent, vaultArchiveIntent, vaultRestoreIntent, vaultPublishIntent } from './vault-acts.js';
import { taskAddIntent, taskUpdateIntent, taskFocusIntent, taskTakeIntent, operatorTaskAddIntent, operatorTaskUpdateIntent, operatorTaskDropIntent } from './task-acts.js';
import { leadAddIntent, leadTouchIntent } from './lead-acts.js';
import { campaignCreateIntent, campaignUpdateIntent, campaignAskIntent } from './campaign-acts.js';
import { marketingPlanIntent } from './marketing-plan.js';
import { marketingBoardArrangeIntent } from './marketing-board-arrange.js';
import { marketingCompanyLinksIntent } from './marketing-company-links.js';
import {
  memoryPinIntent, memoryUnpinIntent, memorySupersedeIntent,
  memoryRetractIntent, memoryMergeIntent, memoryArchiveIntent,
} from './memory-acts.js';

const TYPES = new Map(
  [
    socialPostIntent, socialQueueIntent, ...securityIntents, ...legalIntents, ...treasuryIntents, emailSendIntent, walletSendIntent,
    mediaSaveIntent, mediaKeepIntent, webDownloadIntent, imageGenerateIntent, housePostIntent, houseReviewPacketIntent, kspCommandIntent,
    chatSendIntent,
    formRenderIntent, formChampionIntent,
    voiceSealIntent, voiceClaimIntent, refinementDialIntent,
    speechAcceptIntent, speechAnotherIntent,
    teamRunIntent, teamWorkspaceRunIntent, teamPostIntent, teamTuneIntent, sovereigntyProposeIntent, sovereigntyConsentIntent,
    staffDispatchIntent, staffDispatchUpdateIntent, staffAckIntent,
    boardAddIntent, boardUpdateIntent,
    ...companyIntents, ...revenueIntents, ...accountsIntents, ...raiseIntents, ...invoiceIntents, ...deliveryIntents, ...programmeIntents,
    // Stage 3 batch 4 — the state-shaped tools as filed acts.
    vaultSaveIntent, vaultRenameIntent, vaultArchiveIntent, vaultRestoreIntent, vaultPublishIntent,
    taskAddIntent, taskUpdateIntent, taskFocusIntent, taskTakeIntent, operatorTaskAddIntent, operatorTaskUpdateIntent, operatorTaskDropIntent,
    leadAddIntent, leadTouchIntent,
    campaignCreateIntent, campaignUpdateIntent, campaignAskIntent,
    marketingPlanIntent, marketingBoardArrangeIntent, marketingCompanyLinksIntent,
    memoryPinIntent, memoryUnpinIntent, memorySupersedeIntent,
    memoryRetractIntent, memoryMergeIntent, memoryArchiveIntent,
  ].map((t) => [t.name, t]),
);

/** The registered type, or null — an unknown type settles `invalid`, loudly. */
export const intentType = (name) => TYPES.get(name) || null;

/** Every registered type, for the prompt's INTENTS block. Pure. */
export const intentTypes = () => [...TYPES.values()];
