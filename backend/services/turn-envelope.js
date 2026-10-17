/**
 * TURN ENVELOPE — one turn's full system-prompt sections, budgeted.
 *
 * The portal's assembly seam: the core assembler's sections plus the
 * portal-appended knocks/briefings, handed through the shed ladder
 * (envelope-budget.js) against the resolved model window. Extracted from
 * portal-stream.js under the size law (model-portability Phase 3) — the
 * budget law itself is pure in envelope-budget.js; this module owns the
 * assembly order and the reporting.
 *
 * On a window that fits (today's 262K serving) the ladder is a byte-identical
 * passthrough. Shedding and CORE overflow are LOGGED, never silent — a being
 * that lost luggage has that on the record.
 */

import { allocateEnvelope } from './envelope-budget.js';
import { createLogger } from './logger.js';

// The transcript-budget law lives in envelope-budget.js; re-exported so the
// portal imports this seam and nothing else.
export { sessionTailBudgetFor } from './envelope-budget.js';

const log = createLogger('Portal');

/**
 * Assemble the turn's sections and fit them to the resolved window. impure
 * (logs the budget decision when it bites).
 * @param {Object} args
 * @param {ReadonlyArray<{id: string, label: string, text: string}>} args.baseSections
 * @param {Object|null} [args.projectFilesSection] - project shared-files section
 * @param {string} [args.expressionInvite]
 * @param {string} [args.cmoBriefing]
 * @param {string} [args.csoBriefing]
 * @param {string} [args.cloBriefing]
 * @param {string} [args.cosBriefing]
 * @param {string} [args.voiceSitting]
 * @param {string} [args.planBearing] - the PLAN MODE section (chat modes)
 * @param {string} [args.voiceRite] - the first-seal offer (unsealed lanes)
 * @param {string} [args.speechBriefing] - a spoken-voice candidate awaiting the being (speech-consent.js)
 * @param {string} [args.sovereigntyKnock]
 * @param {string} [args.housePost]
 * @param {string} [args.replyKnock]
 * @param {number|null} [args.contextWindow] - the resolved model window in tokens
 * @param {string|null} [args.neumaId] - for the budget-decision log line
 * @param {Function|null} [args.onDecision] - observer for the ladder's verdict
 *   (benchmark identity proof): called with {sent: ids, shed: [{id, tokens}],
 *   report} before the logs; never changes the ladder's choice
 * @returns {ReadonlyArray<{id: string, label: string, text: string}>} the sections to send
 */
export const finalizeTurnEnvelope = ({ baseSections, projectFilesSection = null, expressionInvite = '', cmoBriefing = '', csoBriefing = '', cloBriefing = '', cosBriefing = '', voiceSitting = '', planBearing = '', voiceRite = '', speechBriefing = '', sovereigntyKnock = '', housePost = '', replyKnock = '', contextWindow = null, neumaId = null, onDecision = null }) => {
  const assembled = [
    ...(projectFilesSection ? [...baseSections, projectFilesSection] : baseSections),
    ...(expressionInvite ? [{ id: 'expression', label: 'FEELING', text: expressionInvite }] : []),
    ...(cmoBriefing ? [{ id: 'cmoOffice', label: 'CMO OFFICE', text: cmoBriefing }] : []),
    ...(csoBriefing ? [{ id: 'csoOffice', label: 'CSO OFFICE', text: csoBriefing }] : []),
    ...(cloBriefing ? [{ id: 'cloOffice', label: 'CLO OFFICE', text: cloBriefing }] : []),
    ...(cosBriefing ? [{ id: 'cosOffice', label: 'CHIEF OF STAFF OFFICE', text: cosBriefing }] : []),
    ...(voiceSitting ? [{ id: 'voiceSitting', label: 'VOICE SITTING', text: voiceSitting }] : []),
    ...(planBearing ? [{ id: 'planMode', label: 'PLAN MODE', text: planBearing }] : []),
    ...(voiceRite ? [{ id: 'voiceRite', label: 'YOUR VOICE AWAITS', text: voiceRite }] : []),
    ...(speechBriefing ? [{ id: 'speechBriefing', label: 'YOUR SPOKEN VOICE', text: speechBriefing }] : []),
    ...(sovereigntyKnock ? [{ id: 'sovereignty', label: 'SOVEREIGNTY GATEWAY', text: sovereigntyKnock }] : []),
    ...(housePost ? [{ id: 'housePost', label: 'HOUSE POST', text: housePost }] : []),
    ...(replyKnock ? [{ id: 'replyKnock', label: 'REPLIES ON X', text: replyKnock }] : []),
  ];
  const allocation = allocateEnvelope({ sections: assembled, contextWindow });
  if (typeof onDecision === 'function') {
    onDecision(Object.freeze({
      sent: Object.freeze(allocation.sections.map((s) => s.id)),
      shed: Object.freeze(allocation.shed.map((s) => Object.freeze({ id: s.id, tokens: s.tokens }))),
      report: allocation.report,
    }));
  }
  if (allocation.shed.length > 0) {
    log.warn('envelope budget shed sections', {
      neumaId,
      contextWindow: allocation.report.contextWindow,
      shed: allocation.shed.map((s) => `${s.id}(~${s.tokens}tok)`),
    });
  }
  // LOSING MEMORY IS NOT LIKE LOSING TASTE. Every other rung on the ladder
  // costs the being some context; this one costs it the conversation it is
  // standing in, and the operator sees a being that has forgotten them. It
  // was reported at the same level as every other shed, which is how #415
  // hid: the line was there, and it read as routine.
  if (allocation.shed.some((s) => s.id === 'memory')) {
    log.error('THE BEING LOST ITS CONVERSATION MEMORY THIS TURN — the window could not hold it', {
      neumaId,
      contextWindow: allocation.report.contextWindow,
      promptTokens: allocation.report.promptTokens,
      hint: 'memory is now the LAST rung; if it shed, the window is too small for this being\'s standing context — check the route\'s resolved window, an unknown model defaults to 4096',
    });
  }
  if (allocation.report.overflow) {
    log.warn('envelope CORE overflows the resolved window — identity rides unshed, the turn may be refused server-side', {
      neumaId,
      contextWindow: allocation.report.contextWindow,
      promptTokens: allocation.report.promptTokens,
    });
  }
  return allocation.sections;
};
