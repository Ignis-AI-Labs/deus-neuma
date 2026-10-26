// hand-over — THE HAND-OVER CONTRACT (show-dont-tell-audit.md, pattern 5;
// design language § SHOW, DON'T TELL 5): a fix a house member can do is one
// press to them. `handTo: {neumaId, name, prompt}` opens that member's newest
// one-on-one sitting (as the stream itself would open it, else a fresh one)
// in a stream window of its own, with the prompt DRAFTED in its composer.
// Nothing is sent from here: the operator reads it, presses send, and stays
// in command.
//
// THIS HOUSE ONLY: the member comes from what this house records (its CMO
// seat, an account's holder, a post's author on its own queue), the sittings
// are read under the operator's own session, and the draft is kept under
// this wallet's own drafts (draft-storage.js).
//
// impure — one sessions read, the drafts store, window actions.

import { listSessions } from '../workspace-sessions.js';
import { isCouncilSession } from '../session-history.js';
import { draftKeyFor, loadDraft, saveDraft } from '../../windowing/window-storage.js';
import { encodeStreamTransfer, openSittingActions } from '../stream-tab-transfer.js';

// pure — the prompt joined to what the operator had already typed there, never over it.
const withPrompt = (typed, prompt) => {
  if (!typed.trim()) return prompt;
  return typed.includes(prompt) ? typed : `${typed.trimEnd()}\n\n${prompt}`;
};

// impure — the member's newest one-on-one sitting (a council is never one), or null.
const newestSitting = async (neumaId) => (await listSessions(neumaId)).find((s) => !isCouncilSession(s)) ?? null;

/**
 * impure — open a member's chat (their newest one-on-one sitting, else a
 * fresh tab) in a stream window of its own; `draft` is put in its composer.
 * @param {{neumaId: string, name?: ?string}} member
 * @param {?{state: {windows: object[]}, dispatch: Function}} windows - useWindows()
 * @param {{draft?: ?string}} [opts]
 * @returns {Promise<{neumaId: string, sessionId: ?string, tabId: string}|null>}
 */
export const openChat = async (member, windows, { draft = null } = {}) => {
  if (!windows?.dispatch || !member?.neumaId) return null;
  const sessionId = await newestSitting(member.neumaId);
  const tabId = `handoff-${member.neumaId}-${Date.now().toString(36)}`;
  if (draft) {
    // The composer's own key for this chat (use-stream-draft.js): the sitting's, else this tab's.
    const key = draftKeyFor(sessionId ? member.neumaId : `${member.neumaId}#${tabId}`, sessionId);
    saveDraft(key, withPrompt(loadDraft(key), draft));
  }
  const payload = encodeStreamTransfer({
    id: tabId, kind: 'local', neumaId: member.neumaId, name: member.name || member.neumaId, sessionId, focus: null,
  });
  if (!payload) return null;
  for (const action of openSittingActions(payload, windows.state?.windows ?? [])) windows.dispatch(action);
  return { neumaId: member.neumaId, sessionId, tabId };
};

/**
 * impure — hand a fix to the member who can do it: their chat, the prompt drafted, never sent.
 * @param {{neumaId: string, name: ?string, prompt: string}} handTo
 * @param {?{state: {windows: object[]}, dispatch: Function}} windows - useWindows()
 */
export const handOver = (handTo, windows) => (handTo?.prompt
  ? openChat(handTo, windows, { draft: handTo.prompt })
  : Promise.resolve(null));
