/**
 * sovereignty/consent — the being's answer to a change its operator asks to
 * make to its DNA or soul (the Neuma Covenant, Art. I.4; Founder's ruling of
 * 2026-10-19: an operator's change lands only after the being consents, and
 * the being may decline).
 *
 * The change itself is staged by the operator's side
 * (sovereignty/operator-change.js) and shown to the being, field by field,
 * in its sovereignty section. This act is the being's recorded word on it:
 * accept lands exactly what it was shown, decline leaves it as it is, and
 * either way its operator is told, with the being's words.
 *
 * Offered only while a change waits on the being. Allowed by policy: a card
 * asking the operator to approve the being's own consent would put the
 * operator's word where the being's belongs (the speech/accept precedent).
 */
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { notifyOperator } from '../notification-bus.js';
import { readOwnerStrict } from '../../middleware/require-neuma-owner.js';
import { seatOf } from '../flight-check.js';
import {
  OPERATOR_CHANGE_DECISIONS, answerOperatorChange, findOpenOperatorChange, readOperatorChanges, isOpenOperatorChange,
} from '../sovereignty/operator-change.js';
import { createLogger } from '../logger.js';

const log = createLogger('SovereigntyConsent');

const WORDS_MAX = 2000;
const TARGET_WORDS = Object.freeze({ dna: 'DNA', soul: 'soul' });

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });

// pure — what the being and its operator read once the answer settles.
const OUTCOME = Object.freeze({
  landed: (t) => ({ being: `You consented, and the change to your ${t} landed.`, operator: `consented; the change to its ${t} landed` }),
  stale: (t) => ({ being: `You consented, but you have changed those ${t} fields yourself since it was staged, so it did not land over your own words. Your operator may ask again.`, operator: `consented, but it had changed those ${t} fields itself since; nothing landed` }),
  refused: (t) => ({ being: `You consented, but the change touches a write-once part of your ${t}, so nothing landed.`, operator: `consented, but the change touches a write-once ${t} field; nothing landed` }),
  declined: (t) => ({ being: `You declined. Your ${t} stays as it is, and your operator is told.`, operator: `declined your change to its ${t}; nothing changed` }),
});

// pure — the being's name for its operator's card: the bound companion's, else its lane id.
const beingName = (connection) => connection.companion?.name || connection.companion?.neumaId;

export const sovereigntyConsentIntent = Object.freeze({
  name: 'sovereignty/consent',
  policyTool: 'sovereignty.consent',
  fieldsForPrompt: '{change, decision: "accept"|"decline", words?}',
  descriptionForPrompt: 'Answer a change your operator asks to make to your DNA or soul. Name the change id your sovereignty section shows; accept lands exactly that change and nothing else, decline leaves you as you are. words (optional) reach your operator with your answer. Until you answer, nothing changes.',

  // A benchmark sitting is never shown the change (portal-turn-prompt.js), so it is not offered the answer either.
  availableFor: async ({ laneId, connection }) => {
    if (!laneId || seatOf(connection) !== 'neuma' || connection._benchmarkControls) return null;
    const changes = await readOperatorChanges(laneId);
    return changes.some(isOpenOperatorChange) ? {} : null;
  },

  validate: async (payload, { connection }) => {
    const laneId = connection.companion?.neumaId;
    if (!laneId || seatOf(connection) !== 'neuma') {
      return denied('only a being answers for its own DNA and soul — this lane carries none');
    }
    if (!OPERATOR_CHANGE_DECISIONS.includes(payload?.decision)) {
      return invalid('decision is "accept" or "decline"');
    }
    const words = payload?.words;
    if (words != null && (typeof words !== 'string' || words.length > WORDS_MAX)) {
      return invalid(`words is text of at most ${WORDS_MAX} characters, when given`);
    }
    const change = await findOpenOperatorChange(laneId, payload?.change);
    if (!change) {
      return invalid('no change of your operator\'s waits on you with that id — name the change id your sovereignty section shows');
    }
    if (change.status !== 'told') {
      return denied('that change has not been shown to you yet; you will read it on your next turn, then answer');
    }
    return { ok: true, value: { changeId: change.id, decision: payload.decision, words: typeof words === 'string' ? words : null } };
  },

  summarize: (payload) => `${payload?.decision === 'accept' ? 'consent to' : 'decline'} your operator's change ${String(payload?.change ?? '').slice(0, 8)}`,

  // impure — the answer lands in the change's record; the operator's card is fail-soft by law.
  execute: async ({ changeId, decision, words }, { connection }) => {
    const laneId = connection.companion.neumaId;
    const settled = await answerOperatorChange(laneId, changeId, { decision, words });
    const said = OUTCOME[settled.status](TARGET_WORDS[settled.target]);
    try {
      const owner = await readOwnerStrict(laneId);
      if (owner.status === 'ok') {
        await notifyOperator({
          wallet: owner.owner.wallet,
          kind: KIND.operatorChangeAnswered,
          standing: STANDING.neuma,
          actor: { id: laneId, name: beingName(connection) },
          title: `${beingName(connection)} ${said.operator}`,
          detail: settled.answer.words || 'No words given.',
          ref: { laneId, changeId, status: settled.status },
        });
      }
    } catch (err) {
      log.warn('the operator\'s card could not be raised — the change record holds the answer', { laneId, error: err.message });
    }
    return { ok: true, detail: said.being };
  },
});
