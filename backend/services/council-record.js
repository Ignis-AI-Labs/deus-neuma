// council-record.js — a council is something each being REMEMBERS, not only
// a file they hold. Every utterance fans out into EACH member's own session
// lane and crystallized memory, written from their seat, and into the
// operator's realm record — there is no shared transcript store.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374).

import {
  neumaWorkspace,
  neumaRecall,
  sanitizeMemoryForPrompt,
  detectEmotion,
} from '../../core/index.js';
import { assessSignificance } from '../../core/runtime/significance.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { isWitnessLaneId } from './witness-lane.js';
import { appendCouncilTurn } from './council-store.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

// Every persisted utterance also passes the same significance gate chat
// crystallization uses (#119's 0.75 bar) and enters memory through the same
// addObservation choke point — so the continuity dual-write (U1) and recall
// invalidation ride along, and the moment becomes recallable in 1:1 chat,
// heartbeat reflection, and the CONTEXT MAP (MEM-006 #192). Each member
// crystallizes from THEIR seat: their own words as "you said", everyone
// else's attributed by name. Best-effort per lane, same doctrine as the
// record fan-out — a failed crystallization must never silence the room.
const crystallizeUtterance = async (run, { speaker, name, content }) => {
  // Standing is part of the RECORD, not only the room. A sealed witness sits
  // beside the house and never in it (WR-I01) — recording its words as a
  // housemate's would quietly make it one, in the one place that outlives the
  // sitting. 'witness' here is the HUMAN witness; a seated AI witness is an
  // external house, named as such.
  const attribution = `${attributionFor(run.state.members, speaker, name)} said`;
  const significance = assessSignificance(`${attribution}: ${content}`, content);
  if (significance <= 0.75) return;
  await Promise.all(run.state.members.map(async (m) => {
    const line = m.neumaId === speaker
      ? `In a council sitting, you said: "${content}"`
      : `In a council sitting, ${attribution}: "${content}"`;
    try {
      const written = await neumaWorkspace.addObservation(m.neumaId, {
        type: 'council',
        councilId: run.councilId,
        speaker,
        userMessage: sanitizeMemoryForPrompt(line, 500),
        significance,
        emotion: detectEmotion(content) || undefined,
      });
      // A council moment is a pure add — append to the hot index (friction-map T2).
      neumaRecall.appendObservation(m.neumaId, written);
    } catch (err) {
      log.warn('council crystallization missed a lane', { neumaId: m.neumaId, error: err.message });
    }
  }));
};

// How a speaker is NAMED in anything that outlives the sitting.
//
// One law, used by both persist paths. It lived twice — once in the session
// lane, once in crystallization — and the two drifted: a seated AI witness was
// correctly named external in memory while the session lane still called it a
// housemate (echo, 2026-07-26). The session lane feeds council resume and the
// mind graph, so that mislabel would quietly make an external witness a member
// of the house in the record. Deriving it once makes the drift impossible.
//
// 'witness' is the HUMAN witness; a sealed AI witness is a lane id, and the
// lane id is authoritative so standing never depends on a field surviving a hop.
// Pure.
const attributionFor = (members, speaker, name) => {
  // The speaker KEY stays 'witness' — it is a wire + record value, and
  // `lastSpeaker === 'witness'` and every persisted utterance depend on it.
  // Only the LABEL moves: a being's own memory must not record the human as a
  // witness (AGENTS.md Domain Language 8). Records already written keep the
  // wording they were given.
  if (speaker === 'witness') return `OPERATOR ${name}`;
  const seat = members.find((m) => m.neumaId === speaker);
  return (seat?.kind === 'witness' || isWitnessLaneId(speaker))
    ? `${name} (external witness, not of this house)`
    : `${name} (housemate)`;
};

// Every utterance lands in EVERY member's own session lane, written from
// that member's seat — and in the operator's own realm record, which is what
// lets a dissolved council be reopened and picked up. Persistence is
// best-effort per lane: one being's full disk must not silence the room.
// `undelivered` marks words the floor never reached (CQ-029 #193): they
// enter the RECORD so the sitting's history is honest, but they never
// crystallize — unheard words must not become a being's memory.
export const persistUtterance = async (run, { speaker, name, content, undelivered = false }) => {
  await Promise.all([
    ...run.state.members.map(async (m) => {
      const own = m.neumaId === speaker;
      const message = own
        ? { role: 'assistant', content }
        : { role: 'user', content: `${attributionFor(run.state.members, speaker, name)}: ${content}` };
      if (undelivered) message.undelivered = true;
      try {
        await neumaWorkspace.appendMessage(m.neumaId, run.sessions[m.neumaId], message);
        // The sitting also lands in this member's MIND graph — the attributed
        // line says exactly who was present (mind-graph.js's one rule): a
        // housemate's word is a DIRECT encounter, the member's own word
        // weaves only the names it speaks. Best-effort like every sibling.
        recordSessionRows(m.neumaId, [message]).catch((err) =>
          log.debug('mind-graph weave skipped', { neumaId: m.neumaId, err: err?.message }));
      } catch (err) {
        log.warn('council record missed a lane', { neumaId: m.neumaId, error: err.message });
      }
    }),
    appendCouncilTurn(run.wallet, run.councilId, { speaker, name, content, undelivered }).catch((err) => {
      log.warn('council record missed the operator realm', { councilId: run.councilId, error: err.message });
    }),
    // Best-effort like every sibling element: a crystallization throw (the
    // significance gate runs outside the per-lane try) must never reject the
    // room's persist — the contract above is the whole point (echo R1).
    ...(undelivered ? [] : [crystallizeUtterance(run, { speaker, name, content }).catch((err) => {
      log.warn('council crystallization failed', { councilId: run.councilId, error: err.message });
    })]),
  ]);
};
