/**
 * team/post — a word to the team that is working right now: to the whole
 * team, or to one teammate (Design note, 2026-10-12: […]).
 *
 * Filed by a MEMBER from inside its part, or by the LEAD from its own chat
 * while its team works. The post joins the run's channel (team-channel.js):
 * kept on the run and its record, written to the team room
 * (<team workspace>/.team/channel.md) where every member reads it with its
 * own file tools, and shown in the operator's WORKFLOW window. Nothing is
 * pushed into a teammate's turn — it reads the channel when it chooses.
 *
 * The tier is `allowed`: the approved plan of record IS the consent for the
 * team's work, and word between the members of one approved run is never
 * egress (house.post's grant, narrowed to one run).
 */
import { runForMember, runLedBy } from '../team-run-live.js';
import { postToChannel, roomOf } from '../team-channel.js';

// impure — the live run this connection may speak in, and as whom: a member
// working its part, or the lead of a run that is working.
const seatIn = (connection) => {
  const member = connection._teamRun ? runForMember(connection._teamRun.runId) : null;
  if (member) {
    const row = (member.board || []).find((e) => e.id === connection._teamRun.stepId);
    return { entry: member, fromStep: connection._teamRun.stepId, from: `${row?.member || connection.companion?.name || 'a member'} (${connection._teamRun.stepId})` };
  }
  const led = connection.companion?.neumaId ? runLedBy(connection.companion.neumaId, connection.walletAddress) : null;
  return led ? { entry: led, fromStep: null, from: `${connection.companion.name || connection.companion.neumaId} (lead)` } : null;
};

export const teamPostIntent = Object.freeze({
  name: 'team/post',
  policyTool: 'team.post',
  fieldsForPrompt: '{text, to?}',
  descriptionForPrompt: 'Post to your working team — to everyone, or to one teammate by name (to). Use it for what a teammate needs: a finding that changes their part, a question, a handoff. Teammates read it in the team channel when they look; keep it under 2000 characters — put longer work in a file and post where it is.',

  availableFor: async ({ connection }) => (seatIn(connection) ? {} : null),

  validate: async (payload, { connection }) => {
    const seat = seatIn(connection);
    if (!seat) return { ok: false, status: 'denied', reason: 'no team of yours is working right now — team/post speaks only inside a working run' };
    if (typeof payload?.text !== 'string' || !payload.text.trim()) {
      return { ok: false, status: 'invalid', reason: 'a team post needs {text} — your words to the team (and to, for one teammate)' };
    }
    return { ok: true, value: { seat, text: payload.text, to: typeof payload?.to === 'string' ? payload.to : null } };
  },

  summarize: (payload) => `team post → ${payload?.to || 'everyone'}`,

  // impure — the post joins the channel, the room and every desk.
  execute: async ({ seat, text, to }) => {
    const posted = postToChannel(seat.entry, { fromStep: seat.fromStep, from: seat.from, to, text });
    if (!posted.ok) return { ok: false, reason: posted.reason };
    const root = seat.entry.room?.root ?? null;
    return {
      ok: true,
      detail: `Posted to ${posted.message.to}. Your team reads it in the team channel${root ? ` (${roomOf(root)}/channel.md)` : ''}.`,
    };
  },
});
